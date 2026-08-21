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
),
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
];
