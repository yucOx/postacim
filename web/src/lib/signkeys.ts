// Gönderen atfı — doğrulanmış anahtar defterinden Ed25519 imza anahtarı
// dağıtımı. Sign key'ler key_log zincirinden gelir: yalnız zincir bütünlüğü
// kanıtlanmış kayıtlar (syncKeyLog/refresh) güven kaynağıdır, bootstrap'tan
// gelen düz kolon DEĞİL. Bir kullanıcının birden çok kaydı olabilir (imza
// anahtarı yenilenmesi) — hepsi saklanır, doğrulamada herhangi biri geçerli.
import { fetchKeyLogPage, entryHash } from './keytransparency';
import { unb64 } from '../crypto/bytes';

// userId → published sign public key'leri (b64)
const byUser = new Map<string, string[]>();
// zincir başı takibi: incremental doğrulama önceki kayda bağlanır
let lastId = 0;
let lastHash: string | null = null;

/** zincir doğrulaması geçmiş tam senkronların kayıtlarını besler */
export function ingestSignKeys(entries: { id: number; user_id: string; sign_public_key: string | null }[]): void {
  for (const e of entries) {
    if (!e.sign_public_key) continue;
    const list = byUser.get(e.user_id) ?? [];
    if (!list.includes(e.sign_public_key)) list.push(e.sign_public_key);
    byUser.set(e.user_id, list);
    lastId = Math.max(lastId, e.id);
  }
}

/** göndericinin published imza anahtarları — bilinmiyorsa null (imzalı mesaj reddedilir) */
export function getSignKeys(userId: string): Uint8Array[] | null {
  const list = byUser.get(userId);
  if (!list || list.length === 0) return null;
  return list.map(unb64);
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
