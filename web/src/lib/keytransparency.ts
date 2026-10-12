// Anahtar şeffaflığı (key transparency) — istemci tarafı doğrulama.
// Sunucu her public key'i append-only bir hash zincirine yazar
// (server/src/routes/keys.ts); burada zinciri baştan doğrular, head'i
// saklar ve kendi kaydımızın key ile eşleştiğini kontrol ederiz.
// Zinciri sessizce geri almak / yeniden yazmak sunucu için imkânsız değil
// ama KANITSIZ değil: aynı id'de farklı hash = yeniden yazım kanıtı.
//
// DÜRÜST SINIR: tam anti-forking (view-splitting'e karşı) istemciler arası
// gossip gerektirir — bu bir 'denetim kanalı'dır: zincir bütünlüğü + head
// parmak izinin bant dışı karşılaştırması + kendi kaydı kontrolü.
import { api } from '../api/client';
import { toHex, unb64 } from '../crypto/bytes';
import { ingestSignKeys } from './signkeys';

export interface KeyLogEntry {
  id: number;
  user_id: string;
  public_key: string;
  /** Ed25519 imza anahtarı (gönderen atfı) — v15 sonrası kayıtlarda var */
  sign_public_key: string | null;
  prev_hash: string;
  entry_hash: string;
  created_at: number;
}
export interface KeyLogHead {
  id: number;
  entry_hash: string;
}

export const GENESIS_HASH = '0'.repeat(64);
const STORAGE_KEY = 'pgv.keylog.head';
const PAGE_LIMIT = 500;

/** sunucuyla aynı formül: sha256(prev_hash || '\x00' || user_id || '\x00' || public_key)
 *  — imza anahtarı varsa sonuna '\x00' ‖ sign_public eklenir */
export async function entryHash(
  prevHash: string,
  userId: string,
  publicKey: string,
  signPublicKey?: string | null,
): Promise<string> {
  let data = `${prevHash}\x00${userId}\x00${publicKey}`;
  if (signPublicKey) data += `\x00${signPublicKey}`;
  const digest = new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(data)),
  );
  return toHex(digest);
}

export async function fetchKeyLogPage(
  after: number,
): Promise<{ entries: KeyLogEntry[]; head: KeyLogHead | null }> {
  return api(`/keys/log?after=${after}&limit=${PAGE_LIMIT}`);
}

/** defterin tamamı — after=0'dan sayfa sayfa sonuna kadar */
export async function fetchFullLog(): Promise<{ entries: KeyLogEntry[]; head: KeyLogHead | null }> {
  const entries: KeyLogEntry[] = [];
  let head: KeyLogHead | null = null;
  let after = 0;
  for (;;) {
    const page = await fetchKeyLogPage(after);
    head = page.head;
    if (page.entries.length === 0) break;
    entries.push(...page.entries);
    // kötü sunucu `after`'ı yok sayıp aynı sayfayı döndürürse döngüye girmesin
    if (page.entries[0]!.id <= after) break;
    if (page.entries.length < PAGE_LIMIT) break;
    after = page.entries[page.entries.length - 1]!.id;
  }
  return { entries, head };
}

export type VerifyResult =
  | { ok: true; head: KeyLogHead | null }
  | { ok: false; error: string };

/**
 * Zincir doğrulaması: her entry'ın hash'i yeniden hesaplanır, prev_hash
 * kopmaz, id'ler 1'er artar (tam defter 1'den başlar), bilinen son head ile
 * çelişki yok — aynı id'de farklı hash yeniden yazımdır.
 */
export async function verifyChain(
  entries: KeyLogEntry[],
  lastKnown: KeyLogHead | null,
): Promise<VerifyResult> {
  let prevHash = GENESIS_HASH;
  let prevId = 0;
  let head: KeyLogHead | null = null;
  for (const e of entries) {
    if (e.id !== prevId + 1) return { ok: false, error: 'anahtar defteri kayıt numaraları kopuk — atlama var' };
    if (e.prev_hash !== prevHash) return { ok: false, error: 'anahtar defteri zinciri kopuk' };
    if ((await entryHash(e.prev_hash, e.user_id, e.public_key, e.sign_public_key)) !== e.entry_hash) {
      return { ok: false, error: "anahtar defteri kaydının hash'i doğrulanamıyor" };
    }
    prevHash = e.entry_hash;
    prevId = e.id;
    head = { id: e.id, entry_hash: e.entry_hash };
  }
  if (lastKnown && lastKnown.id > 0) {
    if (head && lastKnown.id > head.id) {
      return { ok: false, error: 'anahtar defteri bilinen son kayıttan geride — geri alınmış olabilir' };
    }
    const at = entries.find((e) => e.id === lastKnown.id);
    if (at && at.entry_hash !== lastKnown.entry_hash) {
      return { ok: false, error: 'anahtar defteri bilinen head ile çelişiyor — yeniden yazılmış olabilir' };
    }
  }
  return { ok: true, head };
}

export type OwnEntryStatus = 'match' | 'mismatch' | 'missing';

/** log'da kendi satırımız: en son bizim user_id'li entry (key değişimi
 *  desteklenirse en güncel olanı) eldeki key ile aynı mı? */
export function checkOwnEntry(
  entries: KeyLogEntry[],
  userId: string,
  publicKeyB64: string,
): OwnEntryStatus {
  let own: KeyLogEntry | undefined;
  for (const e of entries) if (e.user_id === userId) own = e;
  if (!own) return 'missing';
  return own.public_key === publicKeyB64 ? 'match' : 'mismatch';
}

/** damga — head entry_hash'inin ilk 16 hex'i, 4'lü gruplu (bant dışı karşılaştırma için) */
export function headFingerprint(head: KeyLogHead): string {
  return head.entry_hash.slice(0, 16).replace(/(.{4})(?=.)/g, '$1 ');
}

/** Bant dışı denetim noktası: CI günlük repoya yazar (keylog-checkpoint.yml),
 *  istemci açılışta karşılaştırır. Geri dönüş null = kanal yok (offline /
 *  erişilemedi) — sessiz atlanır, mevcut zincir doğrulaması aynen sürer. */
const CHECKPOINT_URL = 'https://raw.githubusercontent.com/yucOx/postacim/main/keylog-checkpoint.json';

export interface CheckpointFile {
  head: { id: number; entry_hash: string } | null;
  count: number;
  checked_at: number;
}

export type CheckpointResult = { ok: true } | { ok: false; warning: string } | null;

export async function verifyAgainstCheckpoint(entries: KeyLogEntry[]): Promise<CheckpointResult> {
  let cp: CheckpointFile;
  try {
    const r = await fetch(`${CHECKPOINT_URL}?t=${Date.now()}`, { cache: 'no-store' });
    if (!r.ok) return null;
    cp = (await r.json()) as CheckpointFile;
  } catch {
    return null;
  }
  if (!cp || !cp.head || typeof cp.count !== 'number' || cp.count <= 0) return null;
  // istemci checkpoint'ten az satır görüyorsa sunucu satır gizliyor olabilir;
  // (fetchFullLog sona kadar çeker — meşru 'geride kalma' durumu yok)
  if (entries.length < cp.count) {
    return {
      ok: false,
      warning: 'anahtar defteri bant dışı denetim noktasından geride — sunucu kayıt gizliyor olabilir',
    };
  }
  const at = entries[cp.count - 1];
  if (!at || at.entry_hash !== cp.head.entry_hash) {
    return {
      ok: false,
      warning: 'anahtar defteri bant dışı denetim noktasıyla çelişiyor — sunucu size başka bir defter gösteriyor olabilir',
    };
  }
  return { ok: true };
}

export function loadHead(): KeyLogHead | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as KeyLogHead) : null;
  } catch {
    return null; // bozuk JSON / kapalı storage — 'hiç bilinmiyor' gibi davran
  }
}

export function saveHead(head: KeyLogHead): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(head));
  } catch {
    // private mode / kota — bu oturumda kalıcılık yok, doğrulama yine çalışır
  }
}

export type SyncResult =
  | { ok: true; head: KeyLogHead }
  | { ok: false; warning: string };

/**
 * Boot akışı: defterin tamamını çek, doğrula, head'i sakla, kendi kaydını
 * kontrol et. Ağ/sunucu hatası fırlar — güvenlik çelişkisi değildir, çağıran
 * sessizce geçer. Çelişkide uyarı döner; head yalnız doğrulanmışsa saklanır.
 */
export async function syncKeyLog(opts: {
  myUserId: string;
  myPublicKeyB64: string;
}): Promise<SyncResult> {
  const stored = loadHead();
  const { entries, head: serverHead } = await fetchFullLog();
  const v = await verifyChain(entries, stored);
  if (!v.ok) return { ok: false, warning: v.error };
  // bant dışı checkpoint (repo'ya CI'nin yazdığı defter ucu) — view-splitting
  // kanıtı: kanal yoksa (offline) sessiz atlanır
  const cp = await verifyAgainstCheckpoint(entries);
  if (cp && !cp.ok) return { ok: false, warning: cp.warning };
  // doğrulanmış zincirdeki imza anahtarları gönderen doğrulamasına beslenir —
  // yalnız zincir bütünlüğü kanıtlanmış kayıtlar güven kaynağıdır
  ingestSignKeys(entries);
  // doğrulanan zincirin ucu ile sunucunun beyan ettiği head aynı olmalı
  const chainHead = v.head;
  if (
    (chainHead === null) !== (serverHead === null) ||
    (chainHead && serverHead && (chainHead.id !== serverHead.id || chainHead.entry_hash !== serverHead.entry_hash))
  ) {
    return { ok: false, warning: "sunucunun bildirdiği defter ucu zincirle uyuşmuyor" };
  }
  // boş defter + 'match' aynı anda imkânsız (kendi kaydımız bir satırdır);
  // buraya boş defter düşerse own kontrolü zaten 'missing' ile uyarı verir —
  // kalan daraltma TypeScript için
  if (!serverHead) return { ok: false, warning: 'anahtar defteri boş görünüyor' };
  saveHead(serverHead);
  const own = checkOwnEntry(entries, opts.myUserId, opts.myPublicKeyB64);
  if (own === 'mismatch') {
    return { ok: false, warning: 'sunucu kimliğinizi başka bir anahtarla yayınlıyor' };
  }
  if (own === 'missing') {
    return { ok: false, warning: 'anahtar defterinde sizin kaydınız yok — sunucu kaydınızı gizliyor olabilir' };
  }
  return { ok: true, head: serverHead };
}