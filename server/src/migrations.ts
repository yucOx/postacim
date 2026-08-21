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
];
