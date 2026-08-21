import type { FastifyInstance } from 'fastify';
import crypto from 'node:crypto';
import { db } from '../db.js';
import { NICK_REGEX } from '../schemas.js';
import {
  communityChannels,
  communityMembers,
  getCommunity,
  memberRole,
} from '../lib/access.js';
import { hub } from '../ws/hub.js';

interface CreateCommunityBody {
  name: string;
  channels: { name: string; type: 'text' | 'voice'; wrapped_key: string }[];
}
interface CreateChannelBody {
  name: string;
  type: 'text' | 'voice';
  wrapped_keys: { user_id: string; wrapped_key: string }[];
}
interface AddMemberBody {
  user_id: string;
  wrapped_keys: { channel_id: string; wrapped_key: string }[];
}

const NAME_MAX = 64;
const validName = (n: unknown): n is string =>
  typeof n === 'string' && n.trim().length >= 1 && n.trim().length <= NAME_MAX;
const validType = (t: unknown): t is 'text' | 'voice' => t === 'text' || t === 'voice';
const validWrapped = (w: unknown): w is string =>
  typeof w === 'string' && w.length >= 48 && w.length <= 1024 && /^[A-Za-z0-9+/]+={0,2}$/.test(w);

export async function communityRoutes(app: FastifyInstance): Promise<void> {
  app.post('/communities', async (req, reply) => {
    const body = req.body as CreateCommunityBody;
    if (!validName(body?.name)) return reply.code(400).send({ error: 'geçersiz topluluk adı' });
    if (!Array.isArray(body?.channels) || body.channels.length === 0) {
      return reply.code(400).send({ error: 'en az bir kanal gerekli' });
    }
    for (const ch of body.channels) {
      if (!validName(ch?.name) || !validType(ch?.type) || !validWrapped(ch?.wrapped_key)) {
        return reply.code(400).send({ error: 'geçersiz kanal verisi' });
      }
    }
    const id = crypto.randomUUID();
    const now = Date.now();
    const insert = db.transaction(() => {
      db.prepare(
        'INSERT INTO communities(id, name, owner_id, created_at) VALUES (?, ?, ?, ?)',
      ).run(id, body.name.trim(), req.user.id, now);
      db.prepare(
        'INSERT INTO members(community_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)',
      ).run(id, req.user.id, 'owner', now);
      const channels = body.channels.map((ch) => {
        const chId = crypto.randomUUID();
        db.prepare(
          'INSERT INTO channels(id, community_id, name, type, key_version, created_at) VALUES (?, ?, ?, ?, 1, ?)',
        ).run(chId, id, ch.name.trim(), ch.type, now);
        db.prepare(
          'INSERT INTO wrapped_channel_keys(channel_id, user_id, key_version, wrapped_key) VALUES (?, ?, 1, ?)',
        ).run(chId, req.user.id, ch.wrapped_key);
        return { id: chId, name: ch.name.trim(), type: ch.type, key_version: 1 };
      });
      return channels;
    });
    const channels = insert();
    hub.joinCommunity(req.user.id, id);
    return reply.code(201).send({
      community: { id, name: body.name.trim(), role: 'owner' },
      channels,
    });
  });

  // wrapped_keys must cover every current member — the owner client wraps the
  // new channel key for everyone so no one is left keyless.
  app.post('/communities/:id/channels', async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as CreateChannelBody;
    const community = getCommunity(id);
    if (!community) return reply.code(404).send({ error: 'topluluk bulunamadı' });
    if (memberRole(id, req.user.id) !== 'owner') {
      return reply.code(403).send({ error: 'sadece sahip ekleyebilir' });
    }
    if (!validName(body?.name) || !validType(body?.type)) {
      return reply.code(400).send({ error: 'geçersiz kanal verisi' });
    }
    const members = communityMembers(id);
    if (
      !Array.isArray(body?.wrapped_keys) ||
      new Set(body.wrapped_keys.map((w) => w.user_id)).size !== members.length ||
      !body.wrapped_keys.every((w) => members.some((m) => m.id === w.user_id) && validWrapped(w.wrapped_key))
    ) {
      return reply.code(400).send({ error: 'sarılı anahtarlar tüm üyeleri kapsamalı' });
    }
    const chId = crypto.randomUUID();
    const tx = db.transaction(() => {
      db.prepare(
        'INSERT INTO channels(id, community_id, name, type, key_version, created_at) VALUES (?, ?, ?, ?, 1, ?)',
      ).run(chId, id, body.name.trim(), body.type, Date.now());
      for (const w of body.wrapped_keys) {
        db.prepare(
          'INSERT INTO wrapped_channel_keys(channel_id, user_id, key_version, wrapped_key) VALUES (?, ?, 1, ?)',
        ).run(chId, w.user_id, w.wrapped_key);
      }
    });
    try {
      tx();
    } catch (err) {
      if (err instanceof Error && err.message.includes('UNIQUE')) {
        return reply.code(409).send({ error: 'aynı adda kanal zaten var' });
      }
      throw err;
    }
    const channel = { id: chId, name: body.name.trim(), type: body.type, key_version: 1 };
    hub.broadcast(id, { type: 'channel:created', community_id: id, channel });
    return reply.code(201).send({ channel });
  });

  app.get(
    '/users/lookup',
    { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const nick = (req.query as { nick?: string }).nick;
      if (typeof nick !== 'string' || !NICK_REGEX.test(nick)) {
        return reply.code(400).send({ error: 'geçersiz nick' });
      }
      const row = db
        .prepare('SELECT id, nick, public_key FROM users WHERE nick = ?')
        .get(nick) as { id: string; nick: string; public_key: string } | undefined;
      if (!row) return reply.code(404).send({ error: 'kullanıcı bulunamadı' });
      return row;
    },
  );

  app.post('/communities/:id/members', async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as AddMemberBody;
    if (memberRole(id, req.user.id) !== 'owner') {
      return reply.code(403).send({ error: 'sadece sahip ekleyebilir' });
    }
    const target = body?.user_id
      ? (db.prepare('SELECT id, nick, public_key FROM users WHERE id = ?').get(body.user_id) as
          | { id: string; nick: string; public_key: string }
          | undefined)
      : undefined;
    if (!target) return reply.code(404).send({ error: 'kullanıcı bulunamadı' });
    if (memberRole(id, target.id)) {
      return reply.code(409).send({ error: 'zaten üye' });
    }
    const channels = communityChannels(id);
    const wrapped = body?.wrapped_keys;
    if (
      !Array.isArray(wrapped) ||
      new Set(wrapped.map((w) => w.channel_id)).size !== channels.length ||
      !channels.every((ch) => wrapped.some((w) => w.channel_id === ch.id && validWrapped(w.wrapped_key)))
    ) {
      return reply.code(400).send({ error: 'sarılı anahtarlar tüm kanalları kapsamalı' });
    }
    const tx = db.transaction(() => {
      db.prepare(
        'INSERT INTO members(community_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)',
      ).run(id, target.id, 'member', Date.now());
      for (const w of wrapped) {
        const ch = channels.find((c) => c.id === w.channel_id)!;
        db.prepare(
          'INSERT INTO wrapped_channel_keys(channel_id, user_id, key_version, wrapped_key) VALUES (?, ?, ?, ?)',
        ).run(w.channel_id, target.id, ch.key_version, w.wrapped_key);
      }
    });
    tx();
    // target sockets join the room BEFORE broadcast so the invitee gets the event too
    hub.joinCommunity(target.id, id);
    hub.broadcast(id, {
      type: 'community:member_added',
      community_id: id,
      user: { id: target.id, nick: target.nick },
      public_key: target.public_key,
    });
    return reply.code(204).send();
  });

  app.delete('/communities/:id/members/:uid', async (req, reply) => {
    const { id, uid } = req.params as { id: string; uid: string };
    if (memberRole(id, req.user.id) !== 'owner') {
      return reply.code(403).send({ error: 'sadece sahip çıkarabilir' });
    }
    if (uid === req.user.id) {
      return reply.code(400).send({ error: 'sahip kendini çıkaramaz' });
    }
    if (!memberRole(id, uid)) return reply.code(404).send({ error: 'üye bulunamadı' });
    const channels = communityChannels(id);
    const tx = db.transaction(() => {
      db.prepare('DELETE FROM members WHERE community_id = ? AND user_id = ?').run(id, uid);
      db.prepare(
        `DELETE FROM wrapped_channel_keys
         WHERE user_id = ? AND channel_id IN (SELECT id FROM channels WHERE community_id = ?)`,
      ).run(uid, id);
    });
    tx();
    const affected = channels.map((c) => c.id);
    // target sockets still sit in the community room: they receive the event, then we part them
    hub.broadcast(id, {
      type: 'community:member_removed',
      community_id: id,
      user_id: uid,
      affected_channel_ids: affected,
    });
    hub.leaveCommunity(uid, id);
    return { affected_channel_ids: affected };
  });

  app.get('/communities/:id/public-keys', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!memberRole(id, req.user.id)) return reply.code(403).send({ error: 'üye değilsin' });
    const keys: Record<string, string> = {};
    for (const m of communityMembers(id)) keys[m.id] = m.public_key;
    return { public_keys: keys };
  });
}
