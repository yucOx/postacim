import { db } from '../db.js';

// tepki kapsamları — mesaj id'leri tablo başına AUTOINCREMENT olduğundan
// hangi tabloya ait olduğu scope'ta taşınır
export type ReactionScope = 'channel' | 'dm' | 'gdm';

export interface ReactionGroup {
  emoji: string;
  count: number;
  me: boolean;
}

/** history GET için: verilen mesajların tepkilerini emoji'ye göre grupla.
 *  me = isteği atan kullanıcı o emojiyle tepki vermiş mi.
 *  placeholder listesi id sayısından üretilir — dış veri SQL'e girmez. */
export function reactionsFor(
  scope: ReactionScope,
  messageIds: number[],
  me: string,
): Map<number, ReactionGroup[]> {
  const out = new Map<number, ReactionGroup[]>();
  if (messageIds.length === 0) return out;
  const rows = db
    .prepare(
      `SELECT message_id, emoji, user_id FROM reactions
       WHERE scope = ? AND message_id IN (${messageIds.map(() => '?').join(',')})`,
    )
    .all(scope, ...messageIds) as { message_id: number; emoji: string; user_id: string }[];
  const byMessage = new Map<number, Map<string, ReactionGroup>>();
  for (const r of rows) {
    let byEmoji = byMessage.get(r.message_id);
    if (!byEmoji) {
      byEmoji = new Map();
      byMessage.set(r.message_id, byEmoji);
    }
    const g = byEmoji.get(r.emoji) ?? { emoji: r.emoji, count: 0, me: false };
    g.count += 1;
    if (r.user_id === me) g.me = true;
    byEmoji.set(r.emoji, g);
  }
  for (const [mid, byEmoji] of byMessage) out.set(mid, [...byEmoji.values()]);
  return out;
}