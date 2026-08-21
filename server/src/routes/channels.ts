import type { FastifyInstance } from 'fastify';
import { db } from '../db.js';
import { getChannel, isStaff, memberRole } from '../lib/access.js';
import { hub } from '../ws/hub.js';

interface RotateBody {
  wrapped_keys: { user_id: string; wrapped_key: string }[];
}

const validWrapped = (w: unknown): w is string =>
  typeof w === 'string' && w.length >= 48 && w.length <= 1024 && /^[A-Za-z0-9+/]+={0,2}$/.test(w);

export async function channelRoutes(app: FastifyInstance): Promise<void> {
  app.get('/channels/:id/my-key', async (req, reply) => {
    const { id } = req.params as { id: string };
    const channel = getChannel(id);
    if (!channel) return reply.code(404).send({ error: 'kanal bulunamadı' });
    if (!memberRole(channel.community_id, req.user.id)) {
      return reply.code(403).send({ error: 'üye değilsin' });
    }
    const row = db
      .prepare(
        `SELECT key_version, wrapped_key FROM wrapped_channel_keys
         WHERE channel_id = ? AND user_id = ? AND key_version = ?`,
      )
      .get(id, req.user.id, channel.key_version) as
      | { key_version: number; wrapped_key: string }
      | undefined;
    if (!row) return reply.code(404).send({ error: 'anahtarın yok' });
    return row;
  });

  // Rekey after member removal. Old-version wrapped rows for remaining members
  // are kept on purpose: they decrypt pre-rotation history after a reload.
  // Owner OR admin — the kicking admin must be able to finish the rekey even
  // when the owner is offline (the channel stays frozen until then).
  app.post('/channels/:id/rotate', async (req, reply) => {
    const { id } = req.params as { id: string };
    const channel = getChannel(id);
    if (!channel) return reply.code(404).send({ error: 'kanal bulunamadı' });
    if (!isStaff(memberRole(channel.community_id, req.user.id))) {
      return reply.code(403).send({ error: 'sadece sahip veya admin döndürebilir' });
    }
    const members = db
      .prepare('SELECT user_id FROM members WHERE community_id = ?')
      .all(channel.community_id) as { user_id: string }[];
    const body = req.body as RotateBody;
    const wrapped = body?.wrapped_keys;
    if (
      !Array.isArray(wrapped) ||
      new Set(wrapped.map((w) => w.user_id)).size !== members.length ||
      !members.every((m) => wrapped.some((w) => w.user_id === m.user_id && validWrapped(w.wrapped_key)))
    ) {
      return reply.code(400).send({ error: 'sarılı anahtarlar tüm üyeleri kapsamalı' });
    }
    const newVersion = channel.key_version + 1;
    const tx = db.transaction(() => {
      db.prepare('UPDATE channels SET key_version = ?, needs_rekey = 0 WHERE id = ?').run(newVersion, id);
      for (const w of wrapped) {
        db.prepare(
          'INSERT INTO wrapped_channel_keys(channel_id, user_id, key_version, wrapped_key) VALUES (?, ?, ?, ?)',
        ).run(id, w.user_id, newVersion, w.wrapped_key);
      }
      // old-version sealed sets can no longer be redeemed; owners regenerate them
      db.prepare('DELETE FROM invite_keys WHERE channel_id = ? AND key_version = ?').run(id, channel.key_version);
      db.prepare('DELETE FROM join_pw_keys WHERE channel_id = ? AND key_version = ?').run(id, channel.key_version);
    });
    tx();
    hub.broadcast(channel.community_id, {
      type: 'channel:rotated',
      channel_id: id,
      key_version: newVersion,
    });
    return reply.code(204).send();
  });
}
