import crypto from 'node:crypto';
import { db } from '../db.js';

export interface DmChannelRow {
  id: string;
  user_a: string;
  user_b: string;
  key_version: number;
}

export function areFriends(a: string, b: string): boolean {
  const [x, y] = a < b ? [a, b] : [b, a];
  return !!db.prepare('SELECT 1 FROM friends WHERE user_a = ? AND user_b = ?').get(x, y);
}

export function addFriend(a: string, b: string): void {
  const [x, y] = a < b ? [a, b] : [b, a];
  db.prepare('INSERT OR IGNORE INTO friends(user_a, user_b, created_at) VALUES (?, ?, ?)').run(
    x,
    y,
    Date.now(),
  );
}

export function removeFriend(a: string, b: string): void {
  const [x, y] = a < b ? [a, b] : [b, a];
  db.prepare('DELETE FROM friends WHERE user_a = ? AND user_b = ?').run(x, y);
}

export function friendIds(userId: string): string[] {
  return (
    db
      .prepare('SELECT user_b AS id FROM friends WHERE user_a = ? UNION SELECT user_a FROM friends WHERE user_b = ?')
      .all(userId, userId) as { id: string }[]
  ).map((r) => r.id);
}

export function findDmByPair(a: string, b: string): DmChannelRow | undefined {
  const [x, y] = a < b ? [a, b] : [b, a];
  return db
    .prepare('SELECT * FROM dm_channels WHERE user_a = ? AND user_b = ?')
    .get(x, y) as DmChannelRow | undefined;
}

export function getDm(channelId: string, userId: string): DmChannelRow | null {
  const row = db.prepare('SELECT * FROM dm_channels WHERE id = ?').get(channelId) as
    | DmChannelRow
    | undefined;
  if (!row) return null;
  if (row.user_a !== userId && row.user_b !== userId) return null;
  return row;
}

export function dmPeer(dm: DmChannelRow, userId: string): string {
  return dm.user_a === userId ? dm.user_b : dm.user_a;
}

export function newDmChannelId(): string {
  return `dm_${crypto.randomUUID()}`;
}
