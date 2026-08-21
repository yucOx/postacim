import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { MIGRATIONS } from './migrations.js';

fs.mkdirSync(config.dataDir, { recursive: true, mode: 0o700 });

export const db = new Database(path.join(config.dataDir, 'posta.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');

db.exec('CREATE TABLE IF NOT EXISTS schema_version(version INTEGER PRIMARY KEY)');
const row = db.prepare('SELECT MAX(version) AS v FROM schema_version').get() as {
  v: number | null;
};
const applied = row.v ?? 0;

MIGRATIONS.forEach((sql, i) => {
  const version = i + 1;
  if (version <= applied) return;
  const apply = db.transaction(() => {
    db.exec(sql);
    db.prepare('INSERT INTO schema_version(version) VALUES (?)').run(version);
  });
  apply();
});
