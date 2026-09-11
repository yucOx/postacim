import type { FastifyInstance } from 'fastify';
import { config } from '../config.js';
import { db } from '../db.js';
import { areFriends, findDmByPair, getDm, newDmChannelId } from '../lib/social.js';
import { hub } from '../ws/hub.js';
import { mintVoiceToken } from '../livekit.js';

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

export function dmsPayload(userId: string): {
  id: string;
  peer: { id: string; nick: string };
  key_version: number;
  my_wrapped_key: string | null;
  last_message_at: number | null;
}[] {
  const rows = db
    .prepare(
      `SELECT d.id, d.key_version,
        (CASE WHEN d.user_a = ? THEN d.user_b ELSE d.user_a END) AS peer_id,
        u.nick AS peer_nick,
        (SELECT MAX(sent_at) FROM dm_messages m WHERE m.channel_id = d.id) AS last_at
       FROM dm_channels d
       JOIN users u ON u.id = (CASE WHEN d.user_a = ? THEN d.user_b ELSE d.user_a END)
       WHERE d.user_a = ? OR d.user_b = ?
       ORDER BY last_at DESC, d.created_at DESC`,
    )
    .all(userId, userId, userId, userId) as {
    id: string;
    key_version: number;
    peer_id: string;
    peer_nick: string;
    last_at: number | null;
  }[];
  const keys = db
    .prepare(
      `SELECT k.channel_id, k.wrapped_key FROM dm_keys k
       JOIN dm_channels d ON d.id = k.channel_id
       WHERE k.user_id = ? AND k.key_version = d.key_version`,
    )
    .all(userId) as { channel_id: string; wrapped_key: string }[];
  const keyByDm = new Map(keys.map((k) => [k.channel_id, k.wrapped_key]));
  return rows.map((r) => ({
    id: r.id,
    peer: { id: r.peer_id, nick: r.peer_nick },
    key_version: r.key_version,
    my_wrapped_key: keyByDm.get(r.id) ?? null,
    last_message_at: r.last_at,
  }));
}

export async function dmRoutes(app: FastifyInstance): Promise<void> {
  // Open (or get) a DM. Idempotent: existing pair returns without touching keys.
  app.post('/dms', async (req, reply) => {
    const body = (req.body ?? {}) as {
      user_id?: string;
      wrapped_keys?: { user_id: string; wrapped_key: string }[];
    };
    const peerId = body.user_id;
    if (!peerId || !db.prepare('SELECT 1 FROM users WHERE id = ?').get(peerId)) {
      return reply.code(404).send({ error: 'kullanıcı bulunamadı' });
    }
    if (peerId === req.user.id) return reply.code(400).send({ error: 'kendine DM olmaz' });
    if (!areFriends(req.user.id, peerId)) {
      return reply.code(403).send({ error: 'sadece arkadaşlarına mesaj atabilirsin' });
    }
    const existing = findDmByPair(req.user.id, peerId);
    if (existing) return { channel: { id: existing.id, existing: true } };

    const wrapped = body.wrapped_keys;
    if (
      !Array.isArray(wrapped) ||
      !wrapped.every(
        (w) => [req.user.id, peerId].includes(w.user_id) && validWrapped(w.wrapped_key),
      ) ||
      new Set(wrapped.map((w) => w.user_id)).size < 2
    ) {
      return reply.code(400).send({ error: 'sarılı anahtarlar iki tarafı kapsamalı' });
    }
    const id = newDmChannelId();
    const [a, b] = req.user.id < peerId ? [req.user.id, peerId] : [peerId, req.user.id];
    const tx = db.transaction(() => {
      db.prepare(
        'INSERT INTO dm_channels(id, user_a, user_b, key_version, created_at) VALUES (?, ?, ?, 1, ?)',
      ).run(id, a, b, Date.now());
      for (const w of wrapped) {
        db.prepare(
          'INSERT INTO dm_keys(channel_id, user_id, key_version, wrapped_key) VALUES (?, ?, 1, ?)',
        ).run(id, w.user_id, w.wrapped_key);
      }
    });
    tx();
    hub.sendToUser(peerId, {
      type: 'dm:new',
      channel_id: id,
      from: { id: req.user.id, nick: req.user.nick },
    });
    return reply.code(201).send({ channel: { id, existing: false } });
  });

  app.get('/dms', async (req) => ({ dms: dmsPayload(req.user.id) }));

  app.get('/dms/:id/messages', async (req, reply) => {
    const { id } = req.params as { id: string };
    const dm = getDm(id, req.user.id);
    if (!dm) return reply.code(404).send({ error: 'DM bulunamadı' });
    const q = req.query as { before?: string; limit?: string };
    const before = q.before && /^\d+$/.test(q.before) ? Number(q.before) : Number.MAX_SAFE_INTEGER;
    const limit = Math.min(Math.max(Number(q.limit) || 50, 1), 100);
    const rows = db
      .prepare(
        `SELECT m.id, m.channel_id, m.sender_id, u.nick, m.key_version, m.nonce, m.ciphertext, m.sent_at, m.client_id, m.sent_at_client
         FROM dm_messages m JOIN users u ON u.id = m.sender_id
         WHERE m.channel_id = ? AND m.id < ? ORDER BY m.id DESC LIMIT ?`,
      )
      .all(id, before, limit);
    return { messages: rows.reverse(), has_more: rows.length === limit };
  });

  app.post(
    '/dms/:id/messages',
    { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const dm = getDm(id, req.user.id);
      if (!dm) return reply.code(404).send({ error: 'DM bulunamadı' });
      if (!areFriends(dm.user_a, dm.user_b)) {
        return reply.code(403).send({ error: 'artık arkadaş değilsiniz' });
      }
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
      if (!Number.isInteger(body.key_version) || body.key_version !== dm.key_version || !nonceOk || !ctOk) {
        return reply.code(400).send({ error: 'geçersiz mesaj verisi' });
      }
      const hasBinding = body.client_id !== undefined || body.sent_at_client !== undefined;
      if (hasBinding && !validBinding(body.client_id, body.sent_at_client)) {
        return reply.code(400).send({ error: 'geçersiz mesaj verisi' });
      }
      const clientId = hasBinding ? body.client_id ?? null : null;
      const sentAtClient = hasBinding ? body.sent_at_client ?? null : null;
      const now = Date.now();
      const info = db
        .prepare(
          'INSERT INTO dm_messages(channel_id, sender_id, key_version, nonce, ciphertext, sent_at, client_id, sent_at_client) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
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
      hub.sendToUsers([dm.user_a, dm.user_b], { type: 'dm:message', message });
      return reply.code(201).send({ id: message.id, sent_at: now });
    },
  );

  app.post('/dms/:id/my-key', async (req, reply) => {
    const { id } = req.params as { id: string };
    const dm = getDm(id, req.user.id);
    if (!dm) return reply.code(404).send({ error: 'DM bulunamadı' });
    const row = db
      .prepare(
        'SELECT key_version, wrapped_key FROM dm_keys WHERE channel_id = ? AND user_id = ? AND key_version = ?',
      )
      .get(id, req.user.id, dm.key_version) as { key_version: number; wrapped_key: string } | undefined;
    if (!row) return reply.code(404).send({ error: 'anahtarın yok' });
    return row;
  });

  app.post('/dms/:id/call-token', async (req, reply) => {
    const { id } = req.params as { id: string };
    const dm = getDm(id, req.user.id);
    if (!dm) return reply.code(404).send({ error: 'DM bulunamadı' });
    if (!areFriends(dm.user_a, dm.user_b)) {
      return reply.code(403).send({ error: 'artık arkadaş değilsiniz' });
    }
    const hasKey = db
      .prepare('SELECT 1 FROM dm_keys WHERE channel_id = ? AND user_id = ? AND key_version = ?')
      .get(id, req.user.id, dm.key_version);
    if (!hasKey) return reply.code(403).send({ error: 'anahtarın yok' });
    const token = await mintVoiceToken(req.user, id);
    return { url: config.livekitUrl, token };
  });
}
