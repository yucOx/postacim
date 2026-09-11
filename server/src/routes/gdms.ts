import type { FastifyInstance } from 'fastify';
import crypto from 'node:crypto';
import { db } from '../db.js';
import { areFriends } from '../lib/social.js';
import { hub } from '../ws/hub.js';

const B64_RE = /^[A-Za-z0-9+/]+={0,2}$/;
// replay hardening: client UUID + timestamp bound into the AAD; the server
// only stores/echoes them. Both-or-neither — a half-bound row could never
// decrypt on the client.
const CLIENT_ID_RE = /^[0-9a-f-]{36}$/;
const SENT_AT_CLIENT_MAX = 4_102_444_800_000; // 2100-01-01
const validBinding = (clientId: unknown, sentAtClient: unknown): boolean =>
  typeof clientId === 'string' &&
  CLIENT_ID_RE.test(clientId) &&
  typeof sentAtClient === 'number' &&
  Number.isInteger(sentAtClient) &&
  sentAtClient >= 0 &&
  sentAtClient <= SENT_AT_CLIENT_MAX;
const validWrapped = (w: unknown): w is string =>
  typeof w === 'string' && w.length >= 48 && w.length <= 1024 && B64_RE.test(w);

interface GdmRow {
  id: string;
  name: string;
  creator_id: string;
  key_version: number;
}

export function getGdm(channelId: string, userId: string): GdmRow | null {
  const row = db.prepare('SELECT * FROM gdm_channels WHERE id = ?').get(channelId) as GdmRow | undefined;
  if (!row) return null;
  const member = db
    .prepare('SELECT 1 FROM gdm_members WHERE channel_id = ? AND user_id = ?')
    .get(channelId, userId);
  return member ? row : null;
}

export function gdmMemberIds(channelId: string): string[] {
  return (
    db
      .prepare('SELECT user_id FROM gdm_members WHERE channel_id = ? ORDER BY added_at')
      .all(channelId) as { user_id: string }[]
  ).map((r) => r.user_id);
}

export function gdmPayload(userId: string): {
  id: string;
  name: string;
  key_version: number;
  members: { id: string; nick: string; public_key: string }[];
  my_wrapped_key: string | null;
  last_message_at: number | null;
}[] {
  const rows = db
    .prepare(
      `SELECT g.id, g.name, g.key_version,
        (SELECT MAX(sent_at) FROM gdm_messages m WHERE m.channel_id = g.id) AS last_at
       FROM gdm_channels g
       JOIN gdm_members mem ON mem.channel_id = g.id AND mem.user_id = ?
       ORDER BY last_at DESC, g.created_at DESC`,
    )
    .all(userId) as { id: string; name: string; key_version: number; last_at: number | null }[];
  return rows.map((r) => {
    const members = db
      .prepare(
        `SELECT u.id, u.nick, u.public_key FROM gdm_members m JOIN users u ON u.id = m.user_id
         WHERE m.channel_id = ? ORDER BY m.added_at`,
      )
      .all(r.id) as { id: string; nick: string; public_key: string }[];
    const key = db
      .prepare('SELECT wrapped_key FROM gdm_keys WHERE channel_id = ? AND user_id = ? AND key_version = ?')
      .get(r.id, userId, r.key_version) as { wrapped_key: string } | undefined;
    return {
      id: r.id,
      name: r.name,
      key_version: r.key_version,
      members,
      my_wrapped_key: key?.wrapped_key ?? null,
      last_message_at: r.last_at,
    };
  });
}

// a full-version wrapped-key set: every expected user exactly once, given version
function fullKeySet(
  wrapped: { user_id: string; wrapped_key: string }[] | undefined,
  expected: string[],
  version: number,
): boolean {
  if (!Array.isArray(wrapped) || wrapped.length !== expected.length) return false;
  const seen = new Set(wrapped.map((w) => w.user_id));
  if (seen.size !== expected.length || !expected.every((u) => seen.has(u))) return false;
  return wrapped.every((w) => validWrapped(w.wrapped_key)) && Number.isInteger(version);
}

const gdmNick = (id: string): string =>
  (db.prepare('SELECT nick FROM users WHERE id = ?').get(id) as { nick: string }).nick;

export async function gdmRoutes(app: FastifyInstance): Promise<void> {
  app.post('/gdms', async (req, reply) => {
    const body = (req.body ?? {}) as {
      name?: string;
      member_ids?: string[];
      wrapped_keys?: { user_id: string; wrapped_key: string }[];
    };
    const name = typeof body.name === 'string' ? body.name.trim().slice(0, 64) : '';
    const members = Array.isArray(body.member_ids)
      ? [...new Set(body.member_ids.filter((m) => typeof m === 'string' && m !== req.user.id))]
      : [];
    if (!name) return reply.code(400).send({ error: 'grup adı gerekli' });
    if (members.length === 0) return reply.code(400).send({ error: 'en az bir arkadaş seç' });
    if (members.length > 20) return reply.code(400).send({ error: 'en fazla 20 üye' });
    for (const m of members) {
      if (!db.prepare('SELECT 1 FROM users WHERE id = ?').get(m)) {
        return reply.code(404).send({ error: 'kullanıcı bulunamadı' });
      }
      if (!areFriends(req.user.id, m)) {
        return reply.code(403).send({ error: `${gdmNick(m)} arkadaşın değil` });
      }
    }
    const all = [req.user.id, ...members];
    if (!fullKeySet(body.wrapped_keys, all, 1)) {
      return reply.code(400).send({ error: 'sarılı anahtarlar tüm üyeleri kapsamalı' });
    }
    const id = `gdm_${crypto.randomUUID()}`;
    const tx = db.transaction(() => {
      db.prepare(
        'INSERT INTO gdm_channels(id, name, creator_id, key_version, created_at) VALUES (?, ?, ?, 1, ?)',
      ).run(id, name, req.user.id, Date.now());
      for (const u of all) {
        db.prepare('INSERT INTO gdm_members(channel_id, user_id, added_at) VALUES (?, ?, ?)').run(
          id,
          u,
          Date.now(),
        );
      }
      for (const w of body.wrapped_keys!) {
        db.prepare(
          'INSERT INTO gdm_keys(channel_id, user_id, key_version, wrapped_key) VALUES (?, ?, 1, ?)',
        ).run(id, w.user_id, w.wrapped_key);
      }
    });
    tx();
    for (const m of members) {
      hub.sendToUser(m, { type: 'gdm:new', channel_id: id, name });
    }
    return reply.code(201).send({ channel: { id } });
  });

  app.get('/gdms', async (req) => ({ gdms: gdmPayload(req.user.id) }));

  // add member + rekey: new member starts from the new version only
  app.post('/gdms/:id/members', async (req, reply) => {
    const { id } = req.params as { id: string };
    const gdm = getGdm(id, req.user.id);
    if (!gdm) return reply.code(404).send({ error: 'grup bulunamadı' });
    const body = (req.body ?? {}) as {
      user_id?: string;
      wrapped_keys?: { user_id: string; wrapped_key: string }[];
      key_version?: number;
    };
    const newMember = body.user_id;
    if (!newMember || !db.prepare('SELECT 1 FROM users WHERE id = ?').get(newMember)) {
      return reply.code(404).send({ error: 'kullanıcı bulunamadı' });
    }
    if (!areFriends(req.user.id, newMember)) {
      return reply.code(403).send({ error: 'sadece arkadaşını ekleyebilirsin' });
    }
    const current = gdmMemberIds(id);
    if (current.includes(newMember)) return reply.code(409).send({ error: 'zaten üye' });
    const next = current.length + 1;
    if (next > 21) return reply.code(400).send({ error: 'en fazla 21 üye' });
    if (body.key_version !== gdm.key_version + 1 || !fullKeySet(body.wrapped_keys, [...current, newMember], body.key_version)) {
      return reply.code(400).send({ error: 'yeni sürüm anahtarlar tüm üyeleri kapsamalı' });
    }
    const tx = db.transaction(() => {
      db.prepare('UPDATE gdm_channels SET key_version = ? WHERE id = ?').run(body.key_version, id);
      for (const w of body.wrapped_keys!) {
        db.prepare(
          'INSERT INTO gdm_keys(channel_id, user_id, key_version, wrapped_key) VALUES (?, ?, ?, ?)',
        ).run(id, w.user_id, body.key_version!, w.wrapped_key);
      }
      db.prepare('INSERT INTO gdm_members(channel_id, user_id, added_at) VALUES (?, ?, ?)').run(
        id,
        newMember,
        Date.now(),
      );
    });
    tx();
    for (const m of current) {
      if (m !== req.user.id) {
        hub.sendToUser(m, { type: 'gdm:updated', channel_id: id });
      }
    }
    hub.sendToUser(newMember, { type: 'gdm:new', channel_id: id, name: gdm.name });
    return reply.code(204).send();
  });

  // leave + rekey by the leaver: they seal the next key for those staying,
  // so they cannot decrypt anything sent after they left
  app.post('/gdms/:id/leave', async (req, reply) => {
    const { id } = req.params as { id: string };
    const gdm = getGdm(id, req.user.id);
    if (!gdm) return reply.code(404).send({ error: 'grup bulunamadı' });
    const body = (req.body ?? {}) as {
      wrapped_keys?: { user_id: string; wrapped_key: string }[];
      key_version?: number;
    };
    const current = gdmMemberIds(id);
    const remaining = current.filter((m) => m !== req.user.id);
    const tx = db.transaction(() => {
      db.prepare('DELETE FROM gdm_members WHERE channel_id = ? AND user_id = ?').run(id, req.user.id);
      db.prepare('DELETE FROM gdm_keys WHERE channel_id = ? AND user_id = ?').run(id, req.user.id);
      if (remaining.length === 0) {
        db.prepare('DELETE FROM gdm_channels WHERE id = ?').run(id);
        return;
      }
      if (body.key_version === gdm.key_version + 1 && fullKeySet(body.wrapped_keys, remaining, body.key_version)) {
        db.prepare('UPDATE gdm_channels SET key_version = ? WHERE id = ?').run(body.key_version, id);
        for (const w of body.wrapped_keys!) {
          db.prepare(
            'INSERT INTO gdm_keys(channel_id, user_id, key_version, wrapped_key) VALUES (?, ?, ?, ?)',
          ).run(id, w.user_id, body.key_version!, w.wrapped_key);
        }
      }
      // without a valid rekey set the group stays on the old key — the leaver
      // keeps the old key but is no longer a member: cannot post or fetch
    });
    tx();
    for (const m of remaining) {
      hub.sendToUser(m, { type: 'gdm:updated', channel_id: id });
    }
    return reply.code(204).send();
  });

  app.get('/gdms/:id/messages', async (req, reply) => {
    const { id } = req.params as { id: string };
    const gdm = getGdm(id, req.user.id);
    if (!gdm) return reply.code(404).send({ error: 'grup bulunamadı' });
    const q = req.query as { before?: string; limit?: string };
    const before = q.before && /^\d+$/.test(q.before) ? Number(q.before) : Number.MAX_SAFE_INTEGER;
    const limit = Math.min(Math.max(Number(q.limit) || 50, 1), 100);
    const rows = db
      .prepare(
        `SELECT m.id, m.channel_id, m.sender_id, u.nick, m.key_version, m.nonce, m.ciphertext, m.sent_at, m.client_id, m.sent_at_client
         FROM gdm_messages m JOIN users u ON u.id = m.sender_id
         WHERE m.channel_id = ? AND m.id < ? ORDER BY m.id DESC LIMIT ?`,
      )
      .all(id, before, limit);
    return { messages: rows.reverse(), has_more: rows.length === limit };
  });

  app.post(
    '/gdms/:id/messages',
    { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const gdm = getGdm(id, req.user.id);
      if (!gdm) return reply.code(404).send({ error: 'grup bulunamadı' });
      const body = (req.body ?? {}) as {
        key_version?: number;
        nonce?: string;
        ciphertext?: string;
        client_id?: string;
        sent_at_client?: number;
      };
      const nonceOk =
        typeof body.nonce === 'string' && body.nonce.length === 32 && B64_RE.test(body.nonce);
      const ctOk =
        typeof body.ciphertext === 'string' &&
        body.ciphertext.length >= 16 &&
        body.ciphertext.length <= 87_484 &&
        B64_RE.test(body.ciphertext);
      if (!Number.isInteger(body.key_version) || body.key_version !== gdm.key_version || !nonceOk || !ctOk) {
        return reply.code(400).send({ error: 'geçersiz mesaj verisi' });
      }
      // sender must hold the current key (leaver without rekey is gone from keys)
      const hasKey = db
        .prepare('SELECT 1 FROM gdm_keys WHERE channel_id = ? AND user_id = ? AND key_version = ?')
        .get(id, req.user.id, gdm.key_version);
      if (!hasKey) return reply.code(403).send({ error: 'anahtarın yok' });
      const hasBinding = body.client_id !== undefined || body.sent_at_client !== undefined;
      if (hasBinding && !validBinding(body.client_id, body.sent_at_client)) {
        return reply.code(400).send({ error: 'geçersiz mesaj verisi' });
      }
      const clientId = hasBinding ? body.client_id ?? null : null;
      const sentAtClient = hasBinding ? body.sent_at_client ?? null : null;
      const now = Date.now();
      const info = db
        .prepare(
          'INSERT INTO gdm_messages(channel_id, sender_id, key_version, nonce, ciphertext, sent_at, client_id, sent_at_client) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        )
        .run(id, req.user.id, body.key_version, body.nonce, body.ciphertext, now, clientId, sentAtClient);
      const message = {
        id: Number(info.lastInsertRowid),
        channel_id: id,
        sender_id: req.user.id,
        nick: req.user.nick,
        key_version: body.key_version,
        nonce: body.nonce,
        ciphertext: body.ciphertext,
        sent_at: now,
        client_id: clientId,
        sent_at_client: sentAtClient,
      };
      hub.sendToUsers(gdmMemberIds(id), { type: 'gdm:message', message });
      return reply.code(201).send({ id: message.id, sent_at: now });
    },
  );
}
