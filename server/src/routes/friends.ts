import type { FastifyInstance } from 'fastify';
import { db } from '../db.js';
import { NICK_REGEX } from '../schemas.js';
import { addFriend, areFriends, friendIds, removeFriend } from '../lib/social.js';
import { hub } from '../ws/hub.js';

export function friendsPayload(userId: string): {
  friends: { id: string; nick: string; public_key: string }[];
  incoming: { id: string; nick: string }[];
  outgoing: { id: string; nick: string }[];
} {
  const friends = friendIds(userId).map((id) => {
    const u = db
      .prepare('SELECT nick, public_key FROM users WHERE id = ?')
      .get(id) as { nick: string; public_key: string };
    return { id, nick: u.nick, public_key: u.public_key };
  });
  const incoming = (
    db
      .prepare(
        `SELECT f.from_user AS id, u.nick FROM friend_requests f
         JOIN users u ON u.id = f.from_user WHERE f.to_user = ? ORDER BY f.created_at`,
      )
      .all(userId) as { id: string; nick: string }[]
  ).map((r) => ({ id: r.id, nick: r.nick }));
  const outgoing = (
    db
      .prepare(
        `SELECT f.to_user AS id, u.nick FROM friend_requests f
         JOIN users u ON u.id = f.to_user WHERE f.from_user = ? ORDER BY f.created_at`,
      )
      .all(userId) as { id: string; nick: string }[]
  ).map((r) => ({ id: r.id, nick: r.nick }));
  return { friends, incoming, outgoing };
}

export async function friendRoutes(app: FastifyInstance): Promise<void> {
  app.post('/friends/requests', async (req, reply) => {
    const { nick } = (req.body ?? {}) as { nick?: string };
    if (typeof nick !== 'string' || !NICK_REGEX.test(nick)) {
      return reply.code(400).send({ error: 'geçersiz nick' });
    }
    const target = db
      .prepare('SELECT id, nick FROM users WHERE nick = ?')
      .get(nick) as { id: string; nick: string } | undefined;
    if (!target) return reply.code(404).send({ error: 'kullanıcı bulunamadı' });
    if (target.id === req.user.id) return reply.code(400).send({ error: 'kendine arkadaş olamazsın' });
    if (areFriends(req.user.id, target.id)) {
      return reply.code(409).send({ error: 'zaten arkadaşsınız' });
    }
    const existing = db
      .prepare('SELECT 1 FROM friend_requests WHERE (from_user = ? AND to_user = ?) OR (from_user = ? AND to_user = ?)')
      .get(req.user.id, target.id, target.id, req.user.id);
    if (existing) return reply.code(409).send({ error: 'bekleyen istek zaten var' });
    db.prepare('INSERT INTO friend_requests(from_user, to_user, created_at) VALUES (?, ?, ?)').run(
      req.user.id,
      target.id,
      Date.now(),
    );
    hub.sendToUser(target.id, {
      type: 'friend_request:new',
      user: { id: req.user.id, nick: req.user.nick },
    });
    return reply.code(204).send();
  });

  app.get('/friends', async (req) => friendsPayload(req.user.id));

  app.post('/friends/requests/:uid/accept', async (req, reply) => {
    const { uid } = req.params as { uid: string };
    const info = db
      .prepare('DELETE FROM friend_requests WHERE from_user = ? AND to_user = ?')
      .run(uid, req.user.id);
    if (info.changes === 0) return reply.code(404).send({ error: 'istek bulunamadı' });
    addFriend(uid, req.user.id);
    // her tarafa karşı tarafın nick'ini gönder — istemci toast'ında isim
    // göstermek için kullanıyor (payload boşsa "?" görünür)
    const other = db.prepare('SELECT id, nick FROM users WHERE id = ?').get(uid) as
      | { id: string; nick: string }
      | undefined;
    hub.sendToUser(uid, { type: 'friend:new', user: { id: req.user.id, nick: req.user.nick } });
    hub.sendToUser(req.user.id, { type: 'friend:new', user: { id: uid, nick: other?.nick ?? '?' } });
    return reply.code(204).send();
  });

  app.post('/friends/requests/:uid/decline', async (req, reply) => {
    const { uid } = req.params as { uid: string };
    const info = db
      .prepare('DELETE FROM friend_requests WHERE from_user = ? AND to_user = ?')
      .run(uid, req.user.id);
    if (info.changes === 0) return reply.code(404).send({ error: 'istek bulunamadı' });
    return reply.code(204).send();
  });

  app.delete('/friends/:uid', async (req, reply) => {
    const { uid } = req.params as { uid: string };
    if (!areFriends(req.user.id, uid)) return reply.code(404).send({ error: 'arkadaş değil' });
    removeFriend(req.user.id, uid);
    hub.sendToUser(uid, { type: 'friend:removed', user_id: req.user.id });
    return reply.code(204).send();
  });
}
