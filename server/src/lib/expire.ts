import { db } from '../db.js';

// Kaybolan mesajlar — saatlik janitor süpürmesi. Süresi geçen satırlar v12
// tombstone mekanizmasına çevrilir: deleted=1, nonce/ciphertext NULL. deleted_by
// bilinçli olarak NULL kalır (insan silmedi); satır ve id kalır — history
// sayfalama ve tepki/yanıt çapaları bozulmaz. Yayın (WS message:deleted)
// YOK: çevrimiçi istemciler süreyi kendi render süpürmesiyle uygular,
// çevrimdışılar bir sonraki history çekiminde tombstone'u görür.
const TABLES = ['messages', 'dm_messages', 'gdm_messages'] as const;

const expireStmts = TABLES.map((t) =>
  db.prepare(
    `UPDATE ${t} SET deleted = 1, deleted_by = NULL, deleted_at = ?, nonce = NULL, ciphertext = NULL
     WHERE expires_at IS NOT NULL AND expires_at < ? AND deleted = 0`,
  ),
);

export function expireExpiredMessages(): number {
  const now = Date.now();
  let changed = 0;
  for (const st of expireStmts) changed += st.run(now, now).changes;
  return changed;
}