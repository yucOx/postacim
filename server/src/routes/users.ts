import type { FastifyInstance } from 'fastify';
import { db } from '../db.js';
import { revokeAllSessions } from '../auth/sessions.js';

export async function userRoutes(app: FastifyInstance): Promise<void> {
  // public key of any user — the client derives a safety number from it so two
  // peers can detect a server swapping identity keys, out-of-band
  app.get(
    '/users/:id/pubkey',
    { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const row = db.prepare('SELECT public_key FROM users WHERE id = ?').get(id) as
        | { public_key: string }
        | undefined;
      if (!row) return reply.code(404).send({ error: 'kullanıcı bulunamadı' });
      return { public_key: row.public_key };
    },
  );

  // permanent self-deletion, single transaction. Authored message ROWS are
  // deleted, not tombstoned — a tombstone would keep pointing at a wiped
  // identity, and only the content was ever theirs.
  app.delete(
    '/users/me',
    { config: { rateLimit: { max: 5, timeWindow: '1 hour' } } },
    async (req) => {
      const uid = req.user.id;
      const del = db.transaction(() => {
        db.prepare('DELETE FROM messages WHERE sender_id = ?').run(uid);
        db.prepare('DELETE FROM dm_messages WHERE sender_id = ?').run(uid);
        db.prepare('DELETE FROM gdm_messages WHERE sender_id = ?').run(uid);

        // DM channels exist only between the two participants — the whole
        // channel (its messages and wrapped keys) goes with the account
        const dmIds = 'SELECT id FROM dm_channels WHERE user_a = ? OR user_b = ?';
        db.prepare(`DELETE FROM dm_keys WHERE channel_id IN (${dmIds})`).run(uid, uid);
        db.prepare(`DELETE FROM dm_messages WHERE channel_id IN (${dmIds})`).run(uid, uid);
        db.prepare('DELETE FROM dm_channels WHERE user_a = ? OR user_b = ?').run(uid, uid);

        // group DMs: drop membership + keys; groups they created hand the
        // creator role to the earliest remaining member (or die with them)
        db.prepare('DELETE FROM gdm_keys WHERE user_id = ?').run(uid);
        db.prepare('DELETE FROM gdm_members WHERE user_id = ?').run(uid);
        const created = db
          .prepare('SELECT id FROM gdm_channels WHERE creator_id = ?')
          .all(uid) as { id: string }[];
        for (const g of created) {
          const next = db
            .prepare('SELECT user_id FROM gdm_members WHERE channel_id = ? ORDER BY added_at')
            .get(g.id) as { user_id: string } | undefined;
          if (next) {
            db.prepare('UPDATE gdm_channels SET creator_id = ? WHERE id = ?').run(next.user_id, g.id);
          } else {
            db.prepare('DELETE FROM gdm_messages WHERE channel_id = ?').run(g.id);
            db.prepare('DELETE FROM gdm_keys WHERE channel_id = ?').run(g.id);
            db.prepare('DELETE FROM gdm_channels WHERE id = ?').run(g.id);
          }
        }

        // invites they minted; targeted invites pointing at them detach
        db.prepare('DELETE FROM invites WHERE created_by = ?').run(uid);
        db.prepare('UPDATE invites SET target_user_id = NULL WHERE target_user_id = ?').run(uid);

        // owned communities: the whole community goes (members, channels →
        // messages, bans, invites and all wrapped/join keys cascade)
        db.prepare('DELETE FROM communities WHERE owner_id = ?').run(uid);

        // identity, keys, avatar, sessions (friend/friend-request/membership/
        // ban/join-request/session rows cascade from here)
        revokeAllSessions(uid);
        db.prepare('DELETE FROM users WHERE id = ?').run(uid);
      });
      del();
      return { ok: true };
    },
  );
}