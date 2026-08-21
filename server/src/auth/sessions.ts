import crypto from 'node:crypto';
import { config } from '../config.js';
import { db } from '../db.js';

export interface SessionUser {
  id: string;
  nick: string;
}

/** name of the httpOnly session cookie set on login */
export const SESSION_COOKIE = 'pgv_session';

const sha256 = (token: string): string =>
  crypto.createHash('sha256').update(token).digest('hex');

export function issueSession(userId: string): string {
  const token = crypto.randomBytes(48).toString('base64url');
  const now = Date.now();
  db.prepare(
    'INSERT INTO sessions(token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)',
  ).run(sha256(token), userId, now + config.sessionTtlDays * 86_400_000, now);
  return token;
}

export function verifySession(token: string): SessionUser | null {
  const hash = sha256(token);
  const row = db
    .prepare(
      `SELECT s.expires_at, u.id, u.nick
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ?`,
    )
    .get(hash) as { expires_at: number; id: string; nick: string } | undefined;
  if (!row) return null;
  if (row.expires_at < Date.now()) {
    db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hash);
    return null;
  }
  return { id: row.id, nick: row.nick };
}

export function revokeSession(token: string): void {
  db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
}

/** kill every session of a user — used after a password change so a stolen
 *  token cannot outlive the credential rotation */
export function revokeAllSessions(userId: string): void {
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
}
