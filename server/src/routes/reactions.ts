import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { db } from '../db.js';
import { getChannel, memberRole } from '../lib/access.js';
import { getDm } from '../lib/social.js';
import { getGdm, gdmMemberIds } from './gdms.js';
import { hub } from '../ws/hub.js';
import type { ReactionScope } from '../lib/reactions.js';

// Tepki ekle/sil — üç kapsam (channel/dm/gdm) tek tabloda scope ile ayrıştığı
// için rota da tek yerde. Tombstone'a tepki eklenebilir: satır kalır, istemci
// "silindi" çizer. Kimlik denetimi mevcut kanal/DM/grup rotalarıyla aynı
// (dm/gdm'de katılımcı olmayan 404 alır — varlık sızmaz).

const chMsg = db.prepare('SELECT 1 FROM messages WHERE id = ? AND channel_id = ?');
const dmMsg = db.prepare('SELECT 1 FROM dm_messages WHERE id = ? AND channel_id = ?');
const gdmMsg = db.prepare('SELECT 1 FROM gdm_messages WHERE id = ? AND channel_id = ?');
const msgCheck: Record<ReactionScope, typeof chMsg> = { channel: chMsg, dm: dmMsg, gdm: gdmMsg };
const insert = db.prepare(
  'INSERT OR IGNORE INTO reactions(scope, message_id, user_id, emoji, created_at) VALUES (?, ?, ?, ?, ?)',
);
const del = db.prepare(
  'DELETE FROM reactions WHERE scope = ? AND message_id = ? AND user_id = ? AND emoji = ?',
);

const validEmoji = (e: unknown): e is string =>
  typeof e === 'string' && e.length > 0 && Buffer.byteLength(e, 'utf8') <= 16;

const RATE = { config: { rateLimit: { max: 30, timeWindow: '10 seconds' } } };

// kapsam başına: erişim denetimi + olayı kimlere yayan
type Access =
  | { ok: false; code: number; error: string }
  | { ok: true; send: (payload: unknown) => void };
const access: Record<ReactionScope, (channelId: string, userId: string) => Access> = {
  channel: (channelId, userId) => {
    const channel = getChannel(channelId);
    if (!channel) return { ok: false, code: 404, error: 'kanal bulunamadı' };
    if (!memberRole(channel.community_id, userId)) {
      return { ok: false, code: 403, error: 'üye değilsin' };
    }
    return { ok: true, send: (p) => hub.broadcast(channel.community_id, p) };
  },
  dm: (channelId, userId) => {
    const dm = getDm(channelId, userId);
    if (!dm) return { ok: false, code: 404, error: 'DM bulunamadı' };
    const peer = dm.user_a === userId ? dm.user_b : dm.user_a;
    return { ok: true, send: (p) => hub.sendToUser(peer, p) };
  },
  gdm: (channelId, userId) => {
    const gdm = getGdm(channelId, userId);
    if (!gdm) return { ok: false, code: 404, error: 'grup bulunamadı' };
    return {
      ok: true,
      send: (p) => {
        for (const m of gdmMemberIds(channelId)) {
          if (m !== userId) hub.sendToUser(m, p);
        }
      },
    };
  },
};

async function handle(
  req: FastifyRequest,
  reply: FastifyReply,
  scope: ReactionScope,
  action: 'add' | 'remove',
): Promise<unknown> {
  const { id, mid } = req.params as { id: string; mid: string };
  const ctx = access[scope](id, req.user.id);
  if (!ctx.ok) return reply.code(ctx.code).send({ error: ctx.error });
  const emoji =
    action === 'add'
      ? (req.body as { emoji?: unknown } | undefined)?.emoji
      : (req.query as { emoji?: unknown }).emoji;
  if (!validEmoji(emoji)) return reply.code(400).send({ error: 'geçersiz emoji' });
  const msgId = /^\d+$/.test(mid) ? Number(mid) : 0;
  if (!msgId || !msgCheck[scope].get(msgId, id)) {
    return reply.code(404).send({ error: 'mesaj bulunamadı' });
  }
  const info =
    action === 'add'
      ? insert.run(scope, msgId, req.user.id, emoji, Date.now())
      : del.run(scope, msgId, req.user.id, emoji);
  // ekleme idempotent: zaten varsa 204, ikinci broadcast yok;
  // silmede olmayan tepki 404
  if (info.changes === 0) {
    if (action === 'add') return reply.code(204).send();
    return reply.code(404).send({ error: 'tepki bulunamadı' });
  }
  ctx.send({
    type: 'reaction:update',
    scope,
    channel_id: id,
    message_id: msgId,
    emoji,
    action,
    user_id: req.user.id,
    nick: req.user.nick,
  });
  return reply.code(204).send();
}

export async function reactionRoutes(app: FastifyInstance): Promise<void> {
  const scopes: [ReactionScope, string][] = [
    ['channel', '/channels/:id'],
    ['dm', '/dms/:id'],
    ['gdm', '/gdms/:id'],
  ];
  for (const [scope, base] of scopes) {
    app.post(`${base}/messages/:mid/reactions`, RATE, (req, reply) =>
      handle(req, reply, scope, 'add'),
    );
    app.delete(`${base}/messages/:mid/reactions`, RATE, (req, reply) =>
      handle(req, reply, scope, 'remove'),
    );
  }
}