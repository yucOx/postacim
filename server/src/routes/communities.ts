import type { FastifyInstance } from 'fastify';
import crypto from 'node:crypto';
import argon2 from 'argon2';
import { db } from '../db.js';
import { NICK_REGEX } from '../schemas.js';
import {
  communityChannels,
  communityMembers,
  communityNeedsRekey,
  getCommunity,
  isStaff,
  memberRole,
} from '../lib/access.js';
import { evictFromRooms } from '../livekit.js';
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
const CHANNELS_MAX = 50;
const validName = (n: unknown): n is string =>
  typeof n === 'string' && n.trim().length >= 1 && n.trim().length <= NAME_MAX;
const validType = (t: unknown): t is 'text' | 'voice' => t === 'text' || t === 'voice';
const validWrapped = (w: unknown): w is string =>
  typeof w === 'string' && w.length >= 48 && w.length <= 1024 && /^[A-Za-z0-9+/]+={0,2}$/.test(w);

// Removal tail shared by kick and ban: freeze channels until rekey (the
// removed user holds the raw keys), kill outstanding invites (they hand out
// keys at the now-compromised version), evict live rooms, notify sockets.
function memberRemovedCleanup(communityId: string, userId: string, wasMember: boolean): void {
  if (!wasMember) return;
  const channels = communityChannels(communityId);
  db.prepare('UPDATE channels SET needs_rekey = 1 WHERE community_id = ?').run(communityId);
  // sealed sets on outstanding invites are keys at the compromised version
  db.prepare('DELETE FROM invites WHERE community_id = ?').run(communityId);
  void evictFromRooms(
    { id: userId },
    channels.filter((c) => c.type === 'voice').map((c) => c.id),
  );
}

export async function communityRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    '/communities',
    { config: { rateLimit: { max: 5, timeWindow: '1 hour' } } },
    async (req, reply) => {
    const body = req.body as CreateCommunityBody;
    if (!validName(body?.name)) return reply.code(400).send({ error: 'geçersiz topluluk adı' });
    if (!Array.isArray(body?.channels) || body.channels.length === 0) {
      return reply.code(400).send({ error: 'en az bir kanal gerekli' });
    }
    if (body.channels.length > CHANNELS_MAX) {
      return reply.code(400).send({ error: `en fazla ${CHANNELS_MAX} kanal` });
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
  app.post(
    '/communities/:id/channels',
    { config: { rateLimit: { max: 20, timeWindow: '1 hour' } } },
    async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as CreateChannelBody;
    const community = getCommunity(id);
    if (!community) return reply.code(404).send({ error: 'topluluk bulunamadı' });
    if (!isStaff(memberRole(id, req.user.id))) {
      return reply.code(403).send({ error: 'sadece sahip veya admin ekleyebilir' });
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

  app.post(
    '/communities/:id/members',
    { config: { rateLimit: { max: 20, timeWindow: '1 hour' } } },
    async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as AddMemberBody;
    if (!isStaff(memberRole(id, req.user.id))) {
      return reply.code(403).send({ error: 'sadece sahip veya admin ekleyebilir' });
    }
    // a rekey is pending: keys would be handed out at the compromised version
    if (communityNeedsRekey(id)) {
      return reply.code(409).send({ error: 'önce kanalların anahtarını yenile' });
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
    if (db.prepare('SELECT 1 FROM bans WHERE community_id = ? AND user_id = ?').get(id, target.id)) {
      return reply.code(409).send({ error: 'bu kullanıcı banlı' });
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
    const requesterRole = memberRole(id, req.user.id);
    if (!isStaff(requesterRole)) {
      return reply.code(403).send({ error: 'sadece sahip veya admin çıkarabilir' });
    }
    if (uid === req.user.id) {
      return reply.code(400).send({ error: 'kendini çıkaramazsın' });
    }
    const targetRole = memberRole(id, uid);
    if (!targetRole) return reply.code(404).send({ error: 'üye bulunamadı' });
    if (targetRole === 'owner') {
      return reply.code(400).send({ error: 'sahip çıkarılamaz' });
    }
    if (requesterRole === 'admin' && targetRole === 'admin') {
      return reply.code(403).send({ error: 'admin başka admini çıkaramaz' });
    }
    const channels = communityChannels(id);
    const tx = db.transaction(() => {
      db.prepare('DELETE FROM members WHERE community_id = ? AND user_id = ?').run(id, uid);
      db.prepare(
        `DELETE FROM wrapped_channel_keys
         WHERE user_id = ? AND channel_id IN (SELECT id FROM channels WHERE community_id = ?)`,
      ).run(uid, id);
    });
    tx();
    memberRemovedCleanup(id, uid, true);
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

  // --- self-leave ---
  // The leaver keeps the raw channel keys, so the kick tail applies: channels
  // freeze until staff rotate, outstanding invites die with them, live voice
  // rooms are evicted. The leaver's own socket receives the member_removed
  // broadcast before it is parted from the room.
  app.post('/communities/:id/leave', async (req, reply) => {
    const { id } = req.params as { id: string };
    const role = memberRole(id, req.user.id);
    if (!role) return reply.code(404).send({ error: 'üye değilsin' });
    if (role === 'owner') {
      return reply.code(400).send({ error: 'sahip ayrılamaz — topluluğu sil' });
    }
    const channels = communityChannels(id);
    const tx = db.transaction(() => {
      db.prepare('DELETE FROM members WHERE community_id = ? AND user_id = ?').run(id, req.user.id);
      db.prepare(
        `DELETE FROM wrapped_channel_keys
         WHERE user_id = ? AND channel_id IN (SELECT id FROM channels WHERE community_id = ?)`,
      ).run(req.user.id, id);
    });
    tx();
    memberRemovedCleanup(id, req.user.id, true);
    const affected = channels.map((c) => c.id);
    hub.broadcast(id, {
      type: 'community:member_removed',
      community_id: id,
      user_id: req.user.id,
      affected_channel_ids: affected,
    });
    hub.leaveCommunity(req.user.id, id);
    return { affected_channel_ids: affected };
  });

  // --- delete ---
  // Owner-only. Every related row (members, channels, messages, wrapped keys,
  // invites, bans, join requests) goes via FK ON DELETE CASCADE. Members are
  // evicted from live rooms and told the community is gone.
  app.delete('/communities/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const community = getCommunity(id);
    if (!community) return reply.code(404).send({ error: 'topluluk bulunamadı' });
    if (community.owner_id !== req.user.id) {
      return reply.code(403).send({ error: 'sadece sahip silebilir' });
    }
    const members = communityMembers(id);
    const voiceChannels = communityChannels(id).filter((c) => c.type === 'voice').map((c) => c.id);
    // kanal mesajları cascade ile gider ama tepkiler message_id FK'suz —
    // bu topluluğun mesajlarına takılı tepkileri açıkça temizle
    const tx = db.transaction(() => {
      db.prepare(
        `DELETE FROM reactions WHERE scope = 'channel'
         AND message_id IN (
           SELECT m.id FROM messages m
           JOIN channels c ON c.id = m.channel_id
           WHERE c.community_id = ?)`,
      ).run(id);
      db.prepare('DELETE FROM communities WHERE id = ?').run(id);
    });
    tx();
    // sockets still sit in the room: they get the notice, then we part them
    hub.broadcast(id, { type: 'community:deleted', community_id: id });
    for (const m of members) {
      void evictFromRooms({ id: m.id }, voiceChannels);
      hub.leaveCommunity(m.id, id);
    }
    return reply.code(204).send();
  });

  // --- roles ---
  app.post('/communities/:id/admins', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (memberRole(id, req.user.id) !== 'owner') {
      return reply.code(403).send({ error: 'sadece sahip admin atayabilir' });
    }
    const { user_id } = (req.body ?? {}) as { user_id?: string };
    const targetRole = user_id ? memberRole(id, user_id) : null;
    if (!targetRole) return reply.code(404).send({ error: 'üye bulunamadı' });
    if (targetRole === 'owner') return reply.code(400).send({ error: 'sahip zaten en yüksek rol' });
    if (targetRole === 'admin') return reply.code(409).send({ error: 'zaten admin' });
    db.prepare('UPDATE members SET role = ? WHERE community_id = ? AND user_id = ?').run(
      'admin',
      id,
      user_id,
    );
    hub.broadcast(id, { type: 'community:roles_updated', community_id: id });
    return reply.code(204).send();
  });

  app.delete('/communities/:id/admins/:uid', async (req, reply) => {
    const { id, uid } = req.params as { id: string; uid: string };
    if (memberRole(id, req.user.id) !== 'owner') {
      return reply.code(403).send({ error: 'sadece sahip admin kaldırabilir' });
    }
    if (memberRole(id, uid) !== 'admin') return reply.code(404).send({ error: 'admin bulunamadı' });
    db.prepare('UPDATE members SET role = ? WHERE community_id = ? AND user_id = ?').run(
      'member',
      id,
      uid,
    );
    hub.broadcast(id, { type: 'community:roles_updated', community_id: id });
    return reply.code(204).send();
  });

  // --- bans ---
  // Ban also removes membership + wrapped keys (rekey responsibility stays client-side).
  app.post('/communities/:id/bans', async (req, reply) => {
    const { id } = req.params as { id: string };
    const requesterRole = memberRole(id, req.user.id);
    if (!isStaff(requesterRole)) {
      return reply.code(403).send({ error: 'sadece sahip veya admin banlayabilir' });
    }
    const { user_id } = (req.body ?? {}) as { user_id?: string };
    if (!user_id || !db.prepare('SELECT 1 FROM users WHERE id = ?').get(user_id)) {
      return reply.code(404).send({ error: 'kullanıcı bulunamadı' });
    }
    if (memberRole(id, user_id) === 'owner') {
      return reply.code(400).send({ error: 'sahip banlanamaz' });
    }
    if (requesterRole === 'admin' && memberRole(id, user_id) === 'admin') {
      return reply.code(403).send({ error: 'admin başka admini banlayamaz' });
    }
    if (db.prepare('SELECT 1 FROM bans WHERE community_id = ? AND user_id = ?').get(id, user_id)) {
      return reply.code(409).send({ error: 'zaten banlı' });
    }
    const wasMember = memberRole(id, user_id) !== null;
    const channels = communityChannels(id);
    const tx = db.transaction(() => {
      if (wasMember) {
        db.prepare('DELETE FROM members WHERE community_id = ? AND user_id = ?').run(id, user_id);
        db.prepare(
          `DELETE FROM wrapped_channel_keys
           WHERE user_id = ? AND channel_id IN (SELECT id FROM channels WHERE community_id = ?)`,
        ).run(user_id, id);
      }
      db.prepare('INSERT INTO bans(community_id, user_id, banned_by, created_at) VALUES (?, ?, ?, ?)').run(
        id,
        user_id,
        req.user.id,
        Date.now(),
      );
    });
    tx();
    memberRemovedCleanup(id, user_id, wasMember);
    const affected = wasMember ? channels.map((c) => c.id) : [];
    if (wasMember) {
      hub.broadcast(id, {
        type: 'community:member_removed',
        community_id: id,
        user_id,
        affected_channel_ids: affected,
      });
      hub.leaveCommunity(user_id, id);
    }
    return { affected_channel_ids: affected };
  });

  app.get('/communities/:id/bans', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!isStaff(memberRole(id, req.user.id))) {
      return reply.code(403).send({ error: 'yetkin yok' });
    }
    const rows = db
      .prepare(
        `SELECT b.user_id, u.nick, b.created_at
         FROM bans b JOIN users u ON u.id = b.user_id
         WHERE b.community_id = ? ORDER BY b.created_at DESC`,
      )
      .all(id) as { user_id: string; nick: string; created_at: number }[];
    return { bans: rows };
  });

  app.delete('/communities/:id/bans/:uid', async (req, reply) => {
    const { id, uid } = req.params as { id: string; uid: string };
    if (!isStaff(memberRole(id, req.user.id))) {
      return reply.code(403).send({ error: 'yetkin yok' });
    }
    const info = db
      .prepare('DELETE FROM bans WHERE community_id = ? AND user_id = ?')
      .run(id, uid);
    if (info.changes === 0) return reply.code(404).send({ error: 'ban bulunamadı' });
    return reply.code(204).send();
  });

  // --- join requests ---
  app.post('/communities/:id/join-requests', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!getCommunity(id)) return reply.code(404).send({ error: 'topluluk bulunamadı' });
    if (db.prepare('SELECT 1 FROM bans WHERE community_id = ? AND user_id = ?').get(id, req.user.id)) {
      return reply.code(403).send({ error: 'bu topluluktan banlısın' });
    }
    if (memberRole(id, req.user.id)) {
      return reply.code(409).send({ error: 'zaten üyesin' });
    }
    const existing = db
      .prepare('SELECT status FROM join_requests WHERE community_id = ? AND user_id = ?')
      .get(id, req.user.id) as { status: string } | undefined;
    if (existing?.status === 'pending') {
      return reply.code(409).send({ error: 'başvurun zaten beklemede' });
    }
    if (existing) {
      db.prepare(
        "UPDATE join_requests SET status = 'pending', created_at = ? WHERE community_id = ? AND user_id = ?",
      ).run(Date.now(), id, req.user.id);
    } else {
      db.prepare(
        "INSERT INTO join_requests(community_id, user_id, status, created_at) VALUES (?, ?, 'pending', ?)",
      ).run(id, req.user.id, Date.now());
    }
    hub.broadcast(id, {
      type: 'join_request:new',
      community_id: id,
      user: { id: req.user.id, nick: req.user.nick },
    });
    return reply.code(204).send();
  });

  app.get('/communities/:id/join-requests', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!isStaff(memberRole(id, req.user.id))) {
      return reply.code(403).send({ error: 'yetkin yok' });
    }
    const rows = db
      .prepare(
        `SELECT r.user_id, u.nick, u.public_key, r.created_at
         FROM join_requests r JOIN users u ON u.id = r.user_id
         WHERE r.community_id = ? AND r.status = 'pending' ORDER BY r.created_at`,
      )
      .all(id);
    return { requests: rows };
  });

  // Approve: the approver's client supplies keys sealed to the applicant.
  app.post('/communities/:id/join-requests/:uid/approve', async (req, reply) => {
    const { id, uid } = req.params as { id: string; uid: string };
    if (!getCommunity(id)) return reply.code(404).send({ error: 'topluluk bulunamadı' });
    if (!isStaff(memberRole(id, req.user.id))) {
      return reply.code(403).send({ error: 'sadece sahip veya admin onaylayabilir' });
    }
    const row = db
      .prepare("SELECT * FROM join_requests WHERE community_id = ? AND user_id = ? AND status = 'pending'")
      .get(id, uid) as { community_id: string; user_id: string } | undefined;
    if (!row) return reply.code(404).send({ error: 'bekleyen başvuru yok' });
    if (communityNeedsRekey(id)) {
      return reply.code(409).send({ error: 'önce kanalların anahtarını yenile' });
    }
    const channels = communityChannels(id);
    const wrapped = (req.body as { wrapped_keys?: { channel_id: string; key_version: number; wrapped_key: string }[] })
      ?.wrapped_keys;
    if (
      !Array.isArray(wrapped) ||
      new Set(wrapped.map((w) => w.channel_id)).size !== channels.length ||
      !channels.every((ch) =>
        wrapped.some(
          (w) => w.channel_id === ch.id && w.key_version === ch.key_version && validWrapped(w.wrapped_key),
        ),
      )
    ) {
      return reply.code(400).send({ error: 'sarılı anahtar seti eksik veya sürümü eski' });
    }
    const applicant = db
      .prepare('SELECT id, nick, public_key FROM users WHERE id = ?')
      .get(uid) as { id: string; nick: string; public_key: string };
    const tx = db.transaction(() => {
      db.prepare(
        'INSERT INTO members(community_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)',
      ).run(id, uid, 'member', Date.now());
      for (const w of wrapped) {
        db.prepare(
          'INSERT INTO wrapped_channel_keys(channel_id, user_id, key_version, wrapped_key) VALUES (?, ?, ?, ?)',
        ).run(w.channel_id, uid, w.key_version, w.wrapped_key);
      }
      db.prepare('DELETE FROM join_requests WHERE community_id = ? AND user_id = ?').run(id, uid);
    });
    tx();
    hub.joinCommunity(applicant.id, id);
    const payload = {
      type: 'community:member_added',
      community_id: id,
      user: { id: applicant.id, nick: applicant.nick },
      public_key: applicant.public_key,
    };
    hub.broadcast(id, payload);
    hub.sendToUser(applicant.id, payload);
    return reply.code(204).send();
  });

  app.post('/communities/:id/join-requests/:uid/deny', async (req, reply) => {
    const { id, uid } = req.params as { id: string; uid: string };
    if (!isStaff(memberRole(id, req.user.id))) {
      return reply.code(403).send({ error: 'sadece sahip veya admin reddedebilir' });
    }
    const info = db
      .prepare("UPDATE join_requests SET status = 'denied' WHERE community_id = ? AND user_id = ? AND status = 'pending'")
      .run(id, uid);
    if (info.changes === 0) return reply.code(404).send({ error: 'bekleyen başvuru yok' });
    return reply.code(204).send();
  });

  // --- join password (second factor for invite redemption) ---
  // Client derives proof + JW from the password (Argon2id); channel keys arrive
  // XChaCha-encrypted under JW — the server stores only the verifier and blobs.
  app.post(
    '/communities/:id/join-password',
    { config: { rateLimit: { max: 5, timeWindow: '1 hour' } } },
    async (req, reply) => {
    const { id } = req.params as { id: string };
    if (memberRole(id, req.user.id) !== 'owner') {
      return reply.code(403).send({ error: 'sadece sahip şifre kurabilir' });
    }
    const body = req.body as {
      kdf_salt?: string;
      verifier_input?: string;
      wrapped_keys?: { channel_id: string; key_version: number; wrapped_key: string }[];
    };
    const channels = communityChannels(id);
    const wrapped = body?.wrapped_keys;
    if (
      typeof body?.kdf_salt !== 'string' ||
      !/^[0-9a-f]{32}$/.test(body.kdf_salt) ||
      typeof body?.verifier_input !== 'string' ||
      body.verifier_input.length !== 44 ||
      !Array.isArray(wrapped) ||
      new Set(wrapped.map((w) => w.channel_id)).size !== channels.length ||
      !channels.every((ch) =>
        wrapped.some(
          (w) => w.channel_id === ch.id && w.key_version === ch.key_version && validWrapped(w.wrapped_key),
        ),
      )
    ) {
      return reply.code(400).send({ error: 'geçersiz şifre verisi (kapsam/sürüm eksik olabilir)' });
    }
    const verifier = await argon2.hash(body.verifier_input);
    const tx = db.transaction(() => {
      db.prepare('UPDATE communities SET join_kdf_salt = ?, join_verifier = ? WHERE id = ?').run(
        body.kdf_salt,
        verifier,
        id,
      );
      db.prepare(
        'DELETE FROM join_pw_keys WHERE channel_id IN (SELECT id FROM channels WHERE community_id = ?)',
      ).run(id);
      for (const w of wrapped) {
        db.prepare(
          'INSERT INTO join_pw_keys(channel_id, key_version, wrapped_key) VALUES (?, ?, ?)',
        ).run(w.channel_id, w.key_version, w.wrapped_key);
      }
    });
    tx();
    hub.broadcast(id, { type: 'community:join_password', community_id: id });
    return reply.code(204).send();
  });

  app.delete(
    '/communities/:id/join-password',
    { config: { rateLimit: { max: 5, timeWindow: '1 hour' } } },
    async (req, reply) => {
    const { id } = req.params as { id: string };
    if (memberRole(id, req.user.id) !== 'owner') {
      return reply.code(403).send({ error: 'sadece sahip kaldırabilir' });
    }
    const tx = db.transaction(() => {
      db.prepare('UPDATE communities SET join_kdf_salt = NULL, join_verifier = NULL WHERE id = ?').run(id);
      db.prepare(
        'DELETE FROM join_pw_keys WHERE channel_id IN (SELECT id FROM channels WHERE community_id = ?)',
      ).run(id);
    });
    tx();
    hub.broadcast(id, { type: 'community:join_password', community_id: id });
    return reply.code(204).send();
  });

  app.get('/communities/:id/public-keys', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!memberRole(id, req.user.id)) return reply.code(403).send({ error: 'üye değilsin' });
    const keys: Record<string, string> = {};
    for (const m of communityMembers(id)) keys[m.id] = m.public_key;
    return { public_keys: keys };
  });

  // Minimal handle so a user can apply by knowing the community's name.
  // Names are not listed anywhere; knowing the name is the entry signal.
  app.get(
    '/communities/by-name/:name',
    { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const { name } = req.params as { name: string };
      if (!validName(name)) return reply.code(400).send({ error: 'geçersiz ad' });
      const row = db
        .prepare('SELECT id, name FROM communities WHERE name = ? COLLATE NOCASE')
        .get(name.trim()) as { id: string; name: string } | undefined;
      if (!row) return reply.code(404).send({ error: 'topluluk bulunamadı' });
      return row;
    },
  );
}
