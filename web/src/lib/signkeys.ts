// Gönderen atfı — doğrulanmış anahtar defterinden Ed25519 imza anahtarı
// dağıtımı. Sign key'ler key_log zincirinden gelir: yalnız zincir bütünlüğü
// kanıtlanmış kayıtlar (syncKeyLog/refresh) güven kaynağıdır, bootstrap'tan
// gelen düz kolon DEĞİL. Bir kullanıcının birden çok kaydı olabilir (imza
// anahtarı yenilenmesi) — hepsi saklanır, doğrulamada herhangi biri geçerli.
import { fetchKeyLogPage, entryHash } from './keytransparency';
import { b64, unb64 } from '../crypto/bytes';

// userId → published sign public key'leri (b64)
const byUser = new Map<string, string[]>();
// Çözümlenmiş anahtar önbelleği: her mesaj decode'unda b64/unb64 ve Set döngüsünü engeller
const resolvedCache = new Map<string, Uint8Array[] | null>();
// zincir başı takibi: incremental doğrulama önceki kayda bağlanır
let lastId = 0;
let lastHash: string | null = null;

/** zincir doğrulaması geçmiş tam senkronların kayıtlarını besler */
export function ingestSignKeys(entries: { id: number; user_id: string; sign_public_key: string | null }[]): void {
  let changed = false;
  for (const e of entries) {
    if (!e.sign_public_key) continue;
    const list = byUser.get(e.user_id) ?? [];
    if (!list.includes(e.sign_public_key)) {
      list.push(e.sign_public_key);
      changed = true;
    }
    byUser.set(e.user_id, list);
    lastId = Math.max(lastId, e.id);
  }
  if (changed) resolvedCache.clear();
}

/** göndericinin published imza anahtarları — bilinmiyorsa null (imzalı mesaj reddedilir) */
export function getSignKeys(userId: string): Uint8Array[] | null {
  const list = byUser.get(userId);
  if (!list || list.length === 0) return null;
  return list.map(unb64);
}

/**
 * Gönderen atfı için "kendi mesajımı kendim açar" kısayolu. Keytransparency
 * defteri yalnız BAŞKALARININ imza anahtarları için güven kaynağı — kendi
 * anahtarımız RAM'de zaten KDF/password ile korunan KEK'ten türediği için
 * syncKeyLog tamamlanmadan da güvenli kabul edilir. Harita yine de
 * birleştirilir: birden çok sign_public_key yayınladıysak (eski hesap
 * kurtarma sonrası) hepsi geçerli sayılır.
 */
export function resolveSignKeys(
  userId: string,
  myUserId: string | undefined,
  mySignPublicKey: Uint8Array | null | undefined,
): Uint8Array[] | null {
  const cacheKey = `${userId}:${myUserId ?? ''}:${mySignPublicKey ? b64(mySignPublicKey) : ''}`;
  if (resolvedCache.has(cacheKey)) {
    return resolvedCache.get(cacheKey)!;
  }

  const out: Uint8Array[] = [];
  const seen = new Set<string>();
  if (userId === myUserId && mySignPublicKey) {
    const k = b64(mySignPublicKey);
    if (!seen.has(k)) {
      seen.add(k);
      out.push(mySignPublicKey);
    }
  }
  const list = byUser.get(userId);
  if (list) {
    for (const k of list) {
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(unb64(k));
    }
  }
  const res = out.length === 0 ? null : out;
  resolvedCache.set(cacheKey, res);
  return res;
}

/**
 * Artımlı tazeleme: son görülen kayıttan sonrasını çekip zincire bağlılığı
 * ve her kaydın hash'ini doğrular. Kopukluk/false değer — tam boot senkronu
 * (syncKeyLog) çelişkiyi zaten kırmızı bantla raporlar; burada sessiz geçilir.
 */
export async function refreshSignKeys(): Promise<void> {
  try {
    for (;;) {
      const { entries } = await fetchKeyLogPage(lastId);
      if (entries.length === 0) return;
      for (const e of entries) {
        if (e.prev_hash !== (lastHash ?? '0'.repeat(64))) return; // kopuk — güvenme
        if ((await entryHash(e.prev_hash, e.user_id, e.public_key, e.sign_public_key)) !== e.entry_hash) return;
        lastHash = e.entry_hash;
        if (e.id > lastId) lastId = e.id;
      }
      ingestSignKeys(entries);
      if (entries.length < 500) return;
    }
  } catch {
    // ağ hatası — mevcut harita kullanılır, sonraki çağrı yeniden dener
  }
}

/** testler için: bellek içi haritayı sıfırla */
export function resetSignKeys(): void {
  byUser.clear();
  lastId = 0;
  lastHash = null;
}
