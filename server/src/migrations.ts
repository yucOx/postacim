// Ordered migration scripts; index+1 = schema version. Never edit applied ones.
export const MIGRATIONS: string[] = [
  // v1 — initial schema
  `
CREATE TABLE users(
  id TEXT PRIMARY KEY,
  nick TEXT NOT NULL UNIQUE COLLATE NOCASE,
  kdf_salt TEXT NOT NULL,
  verifier TEXT NOT NULL,
  public_key TEXT NOT NULL,
  key_blob TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE sessions(
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE communities(
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  owner_id TEXT NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL
);
CREATE TABLE members(
  community_id TEXT NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member' CHECK(role IN('owner','member')),
  joined_at INTEGER NOT NULL,
  PRIMARY KEY(community_id, user_id)
);
CREATE TABLE channels(
  id TEXT PRIMARY KEY,
  community_id TEXT NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN('text','voice')),
  key_version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  UNIQUE(community_id, name, type)
);
CREATE TABLE wrapped_channel_keys(
  channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key_version INTEGER NOT NULL,
  wrapped_key TEXT NOT NULL,
  PRIMARY KEY(channel_id, user_id, key_version)
);
CREATE TABLE messages(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  sender_id TEXT NOT NULL REFERENCES users(id),
  key_version INTEGER NOT NULL,
  nonce TEXT NOT NULL,
  ciphertext TEXT NOT NULL,
  sent_at INTEGER NOT NULL
);
CREATE INDEX idx_messages_channel ON messages(channel_id, id DESC);
CREATE INDEX idx_wck_user ON wrapped_channel_keys(user_id);
`,
  // v2 — roles (owner/admin/member) + bans
  // members.role CHECK rebuilt: SQLite cannot alter CHECK constraints
  `
CREATE TABLE members_v2(
  community_id TEXT NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member' CHECK(role IN('owner','admin','member')),
  joined_at INTEGER NOT NULL,
  PRIMARY KEY(community_id, user_id)
);
INSERT INTO members_v2 SELECT community_id, user_id, role, joined_at FROM members;
DROP TABLE members;
ALTER TABLE members_v2 RENAME TO members;
CREATE TABLE bans(
  community_id TEXT NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  banned_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY(community_id, user_id)
);
`,
  // v3 — invites (open + targeted); join-password columns land here too (used in v4)
  `
CREATE TABLE invites(
  id TEXT PRIMARY KEY,
  community_id TEXT NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  code TEXT NOT NULL UNIQUE,
  target_user_id TEXT,
  max_uses INTEGER,
  uses INTEGER NOT NULL DEFAULT 0,
  expires_at INTEGER,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE invite_keys(
  invite_id TEXT NOT NULL REFERENCES invites(id) ON DELETE CASCADE,
  channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  key_version INTEGER NOT NULL,
  wrapped_key TEXT NOT NULL,
  PRIMARY KEY(invite_id, channel_id)
);
ALTER TABLE communities ADD COLUMN join_kdf_salt TEXT;
ALTER TABLE communities ADD COLUMN join_verifier TEXT;
`,
  // v4 — join requests
  `
CREATE TABLE join_requests(
  community_id TEXT NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK(status IN('pending','denied')),
  created_at INTEGER NOT NULL,
  PRIMARY KEY(community_id, user_id)
);
`,
  // v5 — join-password wrapped key set (columns since v3)
  `
CREATE TABLE join_pw_keys(
  channel_id TEXT PRIMARY KEY REFERENCES channels(id) ON DELETE CASCADE,
  key_version INTEGER NOT NULL,
  wrapped_key TEXT NOT NULL
);
`,
  // v6 — friends + DMs
  `
CREATE TABLE friend_requests(
  from_user TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  to_user TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY(from_user, to_user)
);
CREATE TABLE friends(
  user_a TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_b TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY(user_a, user_b)
);
CREATE TABLE dm_channels(
  id TEXT PRIMARY KEY,
  user_a TEXT NOT NULL REFERENCES users(id),
  user_b TEXT NOT NULL REFERENCES users(id),
  key_version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  UNIQUE(user_a, user_b)
);
CREATE TABLE dm_keys(
  channel_id TEXT NOT NULL REFERENCES dm_channels(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id),
  key_version INTEGER NOT NULL,
  wrapped_key TEXT NOT NULL,
  PRIMARY KEY(channel_id, user_id, key_version)
);
CREATE TABLE dm_messages(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  channel_id TEXT NOT NULL REFERENCES dm_channels(id) ON DELETE CASCADE,
  sender_id TEXT NOT NULL,
  key_version INTEGER NOT NULL,
  nonce TEXT NOT NULL,
  ciphertext TEXT NOT NULL,
  sent_at INTEGER NOT NULL
);
CREATE INDEX idx_dm_messages ON dm_messages(channel_id, id DESC);
`,
  // v7 — group DMs (member add/leave forces a rekey: new members can't read
  // history, leavers can't read the future)
  `
CREATE TABLE gdm_channels(
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  creator_id TEXT NOT NULL REFERENCES users(id),
  key_version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);
CREATE TABLE gdm_members(
  channel_id TEXT NOT NULL REFERENCES gdm_channels(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id),
  added_at INTEGER NOT NULL,
  PRIMARY KEY(channel_id, user_id)
);
CREATE TABLE gdm_keys(
  channel_id TEXT NOT NULL REFERENCES gdm_channels(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id),
  key_version INTEGER NOT NULL,
  wrapped_key TEXT NOT NULL,
  PRIMARY KEY(channel_id, user_id, key_version)
);
CREATE TABLE gdm_messages(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  channel_id TEXT NOT NULL REFERENCES gdm_channels(id) ON DELETE CASCADE,
  sender_id TEXT NOT NULL,
  key_version INTEGER NOT NULL,
  nonce TEXT NOT NULL,
  ciphertext TEXT NOT NULL,
  sent_at INTEGER NOT NULL
);
CREATE INDEX idx_gdm_messages ON gdm_messages(channel_id, id DESC);
`,
  // v8 — pending rekey: a removed member still holds the raw channel key, so
  // the channel is frozen (no writes, no key handout) until staff rotate it
  `
ALTER TABLE channels ADD COLUMN needs_rekey INTEGER NOT NULL DEFAULT 0;
`,
  // v9 — recovery phrase: a second wrap of the identity private key under an
  // Argon2id key derived from a BIP-39 phrase, so a lost password does not
  // mean a lost account. Server stores blobs + verifier, never the phrase.
  `
ALTER TABLE users ADD COLUMN recovery_salt TEXT;
ALTER TABLE users ADD COLUMN recovery_blob TEXT;
ALTER TABLE users ADD COLUMN recovery_verifier TEXT;
`,
  // v10 — low-res avatar: client downsizes to 64x64 JPEG q=0.5 (~3-8KB) before
  // upload. Server stores the raw blob and serves via /users/:id/avatar with a
  // cache-busting ?v=updatedAt. Keeping it in-row keeps the deploy self-contained.
  `
ALTER TABLE users ADD COLUMN avatar_data BLOB;
ALTER TABLE users ADD COLUMN avatar_updated_at INTEGER;
`,
  // v11 — channel-internal replay hardening: AAD binds a client UUID +
  // client timestamp; server stores them so clients can recompute the AAD
  `
ALTER TABLE messages ADD COLUMN client_id TEXT;
ALTER TABLE messages ADD COLUMN sent_at_client INTEGER;
ALTER TABLE dm_messages ADD COLUMN client_id TEXT;
ALTER TABLE dm_messages ADD COLUMN sent_at_client INTEGER;
ALTER TABLE gdm_messages ADD COLUMN client_id TEXT;
ALTER TABLE gdm_messages ADD COLUMN sent_at_client INTEGER;
`,
  // v12 — message tombstones ("delete for everyone"): the row stays as a
  // placeholder clients render as "silindi", but nonce/ciphertext are wiped —
  // the server never needs the content again. SQLite cannot ALTER a NOT NULL
  // column, so each message table is rebuilt with nullable content columns +
  // the tombstone fields, copying every existing row. "delete for me" is
  // client-local and never reaches the server.
  `
CREATE TABLE messages_v12(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  sender_id TEXT NOT NULL REFERENCES users(id),
  key_version INTEGER NOT NULL,
  nonce TEXT,
  ciphertext TEXT,
  sent_at INTEGER NOT NULL,
  client_id TEXT,
  sent_at_client INTEGER,
  deleted INTEGER NOT NULL DEFAULT 0,
  deleted_by TEXT,
  deleted_at INTEGER
);
INSERT INTO messages_v12(id, channel_id, sender_id, key_version, nonce, ciphertext, sent_at, client_id, sent_at_client)
  SELECT id, channel_id, sender_id, key_version, nonce, ciphertext, sent_at, client_id, sent_at_client FROM messages;
DROP TABLE messages;
ALTER TABLE messages_v12 RENAME TO messages;
CREATE INDEX idx_messages_channel ON messages(channel_id, id DESC);

CREATE TABLE dm_messages_v12(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  channel_id TEXT NOT NULL REFERENCES dm_channels(id) ON DELETE CASCADE,
  sender_id TEXT NOT NULL,
  key_version INTEGER NOT NULL,
  nonce TEXT,
  ciphertext TEXT,
  sent_at INTEGER NOT NULL,
  client_id TEXT,
  sent_at_client INTEGER,
  deleted INTEGER NOT NULL DEFAULT 0,
  deleted_by TEXT,
  deleted_at INTEGER
);
INSERT INTO dm_messages_v12(id, channel_id, sender_id, key_version, nonce, ciphertext, sent_at, client_id, sent_at_client)
  SELECT id, channel_id, sender_id, key_version, nonce, ciphertext, sent_at, client_id, sent_at_client FROM dm_messages;
DROP TABLE dm_messages;
ALTER TABLE dm_messages_v12 RENAME TO dm_messages;
CREATE INDEX idx_dm_messages ON dm_messages(channel_id, id DESC);

CREATE TABLE gdm_messages_v12(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  channel_id TEXT NOT NULL REFERENCES gdm_channels(id) ON DELETE CASCADE,
  sender_id TEXT NOT NULL,
  key_version INTEGER NOT NULL,
  nonce TEXT,
  ciphertext TEXT,
  sent_at INTEGER NOT NULL,
  client_id TEXT,
  sent_at_client INTEGER,
  deleted INTEGER NOT NULL DEFAULT 0,
  deleted_by TEXT,
  deleted_at INTEGER
);
INSERT INTO gdm_messages_v12(id, channel_id, sender_id, key_version, nonce, ciphertext, sent_at, client_id, sent_at_client)
  SELECT id, channel_id, sender_id, key_version, nonce, ciphertext, sent_at, client_id, sent_at_client FROM gdm_messages;
DROP TABLE gdm_messages;
ALTER TABLE gdm_messages_v12 RENAME TO gdm_messages;
CREATE INDEX idx_gdm_messages ON gdm_messages(channel_id, id DESC);
`,
  // v13 — key transparency: her public key ilk yayınlandığında (register)
  // append-only bir hash zincirine yazılır. entry_hash = sha256(prev_hash ||
  // '\x00' || user_id || '\x00' || public_key); genesis prev_hash = 64 adet '0'.
  // UPDATE/DELETE yolunun olmaması esas özellik: sunucu bir key'i sessizce
  // değiştiremez — değişse zincir kopar/çelişir ve kanıt kalır. Hesap silinse
  // bile satır kalır (denetim); user_id bilinçli olarak FK değil — FK silince
  // cascade kanıtı da silerdi.
  `
CREATE TABLE key_log(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  public_key TEXT NOT NULL,
  prev_hash TEXT NOT NULL,
  entry_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_key_log_user ON key_log(user_id);
`,
  // v14 — tepkiler + cevaplar. Mesaj id'leri tablo başına AUTOINCREMENT
  // olduğundan üç tabloda çakışabilir; bu yüzden tepkiler tek tablada scope
  // ile ayrıştırılır. message_id bilinçli olarak FK değil (cross-table FK
  // olamaz); mesaj satırı hard-silinen yerlerde (topluluk silme, hesap silme,
  // boş GDM) tepkiler rota katmanında açıkça temizlenir — tombstone satırı
  // tuttuğu için tepki kalır, sorun değil. reply_to hedef mesajın id'si;
  // reply_nick istemciye JOIN ile verilir.
  `
CREATE TABLE reactions(
  scope TEXT NOT NULL CHECK(scope IN('channel','dm','gdm')),
  message_id INTEGER NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  emoji TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY(scope, message_id, user_id, emoji)
);
CREATE INDEX idx_reactions_user ON reactions(user_id);
ALTER TABLE messages ADD COLUMN reply_to INTEGER;
ALTER TABLE dm_messages ADD COLUMN reply_to INTEGER;
ALTER TABLE gdm_messages ADD COLUMN reply_to INTEGER;
`,
  // v15 — gönderen atfı: Ed25519 imza anahtarı. users.sign_public_key dağıtım
  // kolonu (public key — plaintext invariant'ına aykırı değil); private yarısı
  // istemcide key_blob v2 payload'ına eklenir (eski v1 blob'lar aynen açılır).
  // key_log kayıtları da imza anahtarını taşır — yeni kayıtların entry_hash'i
  // imza anahtarını kapsar, eski tek-key satırlar eski formülle doğrulanır.
  `
ALTER TABLE users ADD COLUMN sign_public_key TEXT;
ALTER TABLE key_log ADD COLUMN sign_public_key TEXT;
`,
  // v16 — kaybolan mesajlar: göndericinin seçtiği TTL, satır başına
  // `expires_at` (ms epoch; NULL = TTL kapalı). Sunucu için bilinçli olarak
  // görünür metadata — imza/AAD kapsamı DIŞI (değişken metadata; bkz.
  // README "Bilinen sınırlar"). Yaşam döngüsü: canlı dağıtımda süresi geçmiş
  // frame reddedilir + saatlik janitor süresi geçen satırı tombstone'a çevirir
  // (nonce/ciphertext NULL); v12 tombstone mekanizmasını aynen kullanır.
  `
ALTER TABLE messages ADD COLUMN expires_at INTEGER;
ALTER TABLE dm_messages ADD COLUMN expires_at INTEGER;
ALTER TABLE gdm_messages ADD COLUMN expires_at INTEGER;
`,
];
