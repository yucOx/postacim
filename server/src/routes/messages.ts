import type { FastifyInstance } from 'fastify';
import { db } from '../db.js';
import { getChannel, memberRole } from '../lib/access.js';
import { hub } from '../ws/hub.js';

interface PostBody {
  key_version?: number;
  nonce?: string;
  ciphertext?: string;
}

const B64_RE = /^[A-Za-z0-9+/]+={0,2}$/;
// 64 KiB decoded → ~87.5k base64 chars
const MAX_CIPHERTEXT_B64 = 87_484;

export async function messageRoutes(app: FastifyInstance): Promise<void> {
  app.get('/channels/:id/messages', async (req, reply) => {
    const { id } = req.params as { id: string };
    const channel = getChannel(id);
    if (!channel) return reply.code(404).send({ error: 'kanal bulunamadı' });
    if (!memberRole(channel.community_id, req.user.id)) {
      return reply.code(403).send({ error: 'üye değilsin' });
    }
    const q = req.query as { before?: string; limit?: string };
    const before = q.before && /^\d+$/.test(q.before) ? Number(q.before) : Number.MAX_SAFE_INTEGER;
    const limit = Math.min(Math.max(Number(q.limit) || 50, 1), 100);
    const rows = db
      .prepare(
        `SELECT m.id, m.channel_id, m.sender_id, u.nick, m.key_version, m.nonce, m.ciphertext, m.sent_at
         FROM messages m JOIN users u ON u.id = m.sender_id
         WHERE m.channel_id = ? AND m.id < ? ORDER BY m.id DESC LIMIT ?`,
      )
      .all(id, before, limit) as unknown[];
    const hasMore = rows.length === limit;
    return { messages: rows.reverse(), has_more: hasMore };
  });

  app.post(
    '/channels/:id/messages',
    { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const channel = getChannel(id);
      if (!channel) return reply.code(404).send({ error: 'kanal bulunamadı' });
      if (!memberRole(channel.community_id, req.user.id)) {
        return reply.code(403).send({ error: 'üye değilsin' });
      }
      // frozen after a member removal until staff rotate — the removed user
      // still holds the raw key, so new ciphertext must not appear under it
      if (channel.needs_rekey) {
        return reply.code(409).send({ error: 'kanal yeniden anahtarlanmalı — sahip/admin anahtarı yenilesin' });
      }
      const body = req.body as PostBody;
      const nonceOk = typeof body?.nonce === 'string' && body.nonce.length === 32 && B64_RE.test(body.nonce);
      const ctOk =
        typeof body?.ciphertext === 'string' &&
        body.ciphertext.length >= 16 &&
        body.ciphertext.length <= MAX_CIPHERTEXT_B64 &&
        B64_RE.test(body.ciphertext);
      if (!Number.isInteger(body?.key_version) || (body.key_version as number) < 1 || !nonceOk || !ctOk) {
        return reply.code(400).send({ error: 'geçersiz mesaj verisi' });
      }
      // stale epoch → client refetches the rotated key and re-encrypts
      if (body.key_version !== channel.key_version) {
        return reply.code(409).send({ error: 'anahtar sürümü eski' });
      }
      const now = Date.now();
      const info = db
        .prepare(
          'INSERT INTO messages(channel_id, sender_id, key_version, nonce, ciphertext, sent_at) VALUES (?, ?, ?, ?, ?, ?)',
        )
        .run(id, req.user.id, body.key_version, body.nonce, body.ciphertext, now);
      const message = {
        id: Number(info.lastInsertRowid),
        channel_id: id,
        sender_id: req.user.id,
        nick: req.user.nick,
        key_version: body.key_version,
        nonce: body.nonce,
        ciphertext: body.ciphertext,
        sent_at: now,
      };
      hub.broadcast(channel.community_id, { type: 'message:new', channel_id: id, message });
      return reply.code(201).send({ id: message.id, sent_at: now });
    },
  );
}
