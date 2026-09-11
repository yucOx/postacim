import type { FastifyInstance } from 'fastify';
import { db } from '../db.js';
import { getChannel, isStaff, memberRole } from '../lib/access.js';
import { getDm } from '../lib/social.js';
import { getGdm, gdmMemberIds } from './gdms.js';
import { hub } from '../ws/hub.js';

// Prepared once per table — no string-built SQL on the request path.
const msgRow = db.prepare('SELECT sender_id, deleted FROM messages WHERE id = ? AND channel_id = ?');
const dmRow = db.prepare('SELECT deleted FROM dm_messages WHERE id = ? AND channel_id = ?');
const gdmRow = db.prepare('SELECT sender_id, deleted FROM gdm_messages WHERE id = ? AND channel_id = ?');

// Tombstone: keep the row (clients render "silindi"), wipe the content —
// the server never needs the nonce/ciphertext again.
const msgTomb = db.prepare(
  'UPDATE messages SET deleted = 1, deleted_by = ?, deleted_at = ?, nonce = NULL, ciphertext = NULL WHERE id = ? AND channel_id = ?',
);
const dmTomb = db.prepare(
  'UPDATE dm_messages SET deleted = 1, deleted_by = ?, deleted_at = ?, nonce = NULL, ciphertext = NULL WHERE id = ? AND channel_id = ?',
);
const gdmTomb = db.prepare(
  'UPDATE gdm_messages SET deleted = 1, deleted_by = ?, deleted_at = ?, nonce = NULL, ciphertext = NULL WHERE id = ? AND channel_id = ?',
);

interface DelParams {
  scope: string;
  channelId: string;
  messageId: string;
}

export async function messageDeleteRoutes(app: FastifyInstance): Promise<void> {
  // scope: ch = community channel, dm = 1:1, gdm = group DM.
  // Idempotent by design: deleting an already-deleted row returns 200 again
  // (no second wipe, no second broadcast) so a retried click never errors
  // and peers are never double-notified.
  app.delete(
    '/messages/:scope/:channelId/:messageId',
    { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const { scope, channelId } = req.params as DelParams;
      const rawId = (req.params as DelParams).messageId;
      if (!/^\d+$/.test(rawId)) return reply.code(404).send({ error: 'mesaj bulunamadı' });
      const id = Number(rawId);
      const uid = req.user.id;

      if (scope === 'ch') {
        const ch = getChannel(channelId);
        if (!ch) return reply.code(404).send({ error: 'kanal bulunamadı' });
        const role = memberRole(ch.community_id, uid);
        if (!role) return reply.code(403).send({ error: 'üye değilsin' });
        const row = msgRow.get(id, channelId) as { sender_id: string; deleted: number } | undefined;
        if (!row) return reply.code(404).send({ error: 'mesaj bulunamadı' });
        // sender may pull their own; owner/admin may pull anyone's
        if (row.sender_id !== uid && !isStaff(role)) {
          return reply.code(403).send({ error: 'bu mesajı silme yetkin yok' });
        }
        if (!row.deleted) {
          msgTomb.run(uid, Date.now(), id, channelId);
          hub.broadcast(ch.community_id, { type: 'message:deleted', channel_id: channelId, id });
        }
        return { ok: true };
      }

      if (scope === 'dm') {
        const dm = getDm(channelId, uid);
        if (!dm) return reply.code(404).send({ error: 'DM bulunamadı' });
        const row = dmRow.get(id, channelId) as { deleted: number } | undefined;
        if (!row) return reply.code(404).send({ error: 'mesaj bulunamadı' });
        // either participant may tombstone — both already hold the key
        if (!row.deleted) {
          dmTomb.run(uid, Date.now(), id, channelId);
          hub.sendToUsers([dm.user_a, dm.user_b], {
            type: 'message:deleted',
            channel_id: channelId,
            id,
          });
        }
        return { ok: true };
      }

      if (scope === 'gdm') {
        const gdm = getGdm(channelId, uid);
        if (!gdm) return reply.code(404).send({ error: 'grup bulunamadı' });
        const row = gdmRow.get(id, channelId) as { sender_id: string; deleted: number } | undefined;
        if (!row) return reply.code(404).send({ error: 'mesaj bulunamadı' });
        // sender or the group creator may tombstone
        if (row.sender_id !== uid && gdm.creator_id !== uid) {
          return reply.code(403).send({ error: 'bu mesajı silme yetkin yok' });
        }
        if (!row.deleted) {
          gdmTomb.run(uid, Date.now(), id, channelId);
          hub.sendToUsers(gdmMemberIds(channelId), {
            type: 'message:deleted',
            channel_id: channelId,
            id,
          });
        }
        return { ok: true };
      }

      return reply.code(404).send({ error: 'mesaj bulunamadı' });
    },
  );
}
