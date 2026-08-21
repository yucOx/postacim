import type { FastifyInstance } from 'fastify';
import crypto from 'node:crypto';
import { db } from '../db.js';
import { communityChannels, getCommunity, isStaff, memberRole } from '../lib/access.js';
import { hub } from '../ws/hub.js';

interface CreateInviteBody {
  target_user_id?: string;
  max_uses?: number;
  ttl_hours?: number;
  wrapped_keys: { channel_id: string; key_version: number; wrapped_key: string }[];
}
interface CompleteBody {
  wrapped_keys: { channel_id: string; key_version: number; wrapped_key: string }[];
}

// base58-style, no confusables
const CODE_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function genCode(len = 10): string {
  const bytes = crypto.randomBytes(len);
  let out = '';
  for (let i = 0; i < len; i++) out += CODE_ALPHABET[bytes[i]! % CODE_ALPHABET.length]!;
  return out;
}

const validWrapped = (w: unknown): w is string =>
  typeof w === 'string' && w.length >= 48 && w.length <= 1024 && /^[A-Za-z0-9+/]+={0,2}$/.test(w);

interface InviteRow {
  id: string;
  community_id: string;
  code: string;
  target_user_id: string | null;
  max_uses: number | null;
  uses: number;
  expires_at: number | null;
}

type RedeemError = string;
function inviteUsable(invite: InviteRow, userId: string): RedeemError | null {
  if (invite.expires_at !== null && invite.expires_at < Date.now()) return 'davet süresi geçmiş';
  if (invite.max_uses !== null && invite.uses >= invite.max_uses) return 'davet kullanım limiti dolmuş';
  if (invite.target_user_id !== null && invite.target_user_id !== userId) {
    return 'bu davet sana ait değil';
  }
  if (db.prepare('SELECT 1 FROM bans WHERE community_id = ? AND user_id = ?').get(invite.community_id, userId)) {
    return 'bu topluluktan banlısın';
  }
  if (memberRole(invite.community_id, userId)) return 'zaten üyesin';
  return null;
}

export async function inviteRoutes(app: FastifyInstance): Promise<void> {
  // --- create (owner/admin) ---
  app.post('/communities/:id/invites', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!isStaff(memberRole(id, req.user.id))) {
      return reply.code(403).send({ error: 'sadece sahip veya admin davet üretebilir' });
    }
    const body = req.body as CreateInviteBody;
    const channels = communityChannels(id);
    const wrapped = body?.wrapped_keys;
    if (
      !Array.isArray(wrapped) ||
      new Set(wrapped.map((w) => w.channel_id)).size !== channels.length ||
      !channels.every((ch) =>
        wrapped.some(
          (w) => w.channel_id === ch.id && w.key_version === ch.key_version && validWrapped(w.wrapped_key),
        ),
      )
    ) {
      return reply.code(400).send({ error: 'sarılı anahtarlar tüm kanalları güncel sürümle kapsamalı' });
    }
    let targetNick: string | null = null;
    if (body.target_user_id !== undefined) {
      const target = db
        .prepare('SELECT id, nick FROM users WHERE id = ?')
        .get(body.target_user_id) as { id: string; nick: string } | undefined;
      if (!target) return reply.code(404).send({ error: 'hedef kullanıcı bulunamadı' });
      if (memberRole(id, target.id)) return reply.code(409).send({ error: 'hedef zaten üye' });
      if (db.prepare('SELECT 1 FROM bans WHERE community_id = ? AND user_id = ?').get(id, target.id)) {
        return reply.code(409).send({ error: 'hedef banlı' });
      }
      targetNick = target.nick;
    }
    const inviteId = crypto.randomUUID();
    const code = genCode();
    const maxUses =
      body.max_uses === undefined || body.max_uses === null
        ? null
        : Number.isInteger(body.max_uses) && (body.max_uses as number) >= 1
          ? (body.max_uses as number)
          : undefined;
    if (maxUses === undefined) return reply.code(400).send({ error: 'geçersiz kullanım limiti' });
    const ttl =
      body.ttl_hours === undefined || body.ttl_hours === null
        ? null
        : Number.isFinite(body.ttl_hours) && (body.ttl_hours as number) > 0
          ? Date.now() + (body.ttl_hours as number) * 3_600_000
          : undefined;
    if (ttl === undefined) return reply.code(400).send({ error: 'geçersiz süre' });
    const tx = db.transaction(() => {
      db.prepare(
        `INSERT INTO invites(id, community_id, code, target_user_id, max_uses, uses, expires_at, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?)`,
      ).run(inviteId, id, code, body.target_user_id ?? null, maxUses, ttl, req.user.id, Date.now());
      for (const w of wrapped) {
        db.prepare(
          'INSERT INTO invite_keys(invite_id, channel_id, key_version, wrapped_key) VALUES (?, ?, ?, ?)',
        ).run(inviteId, w.channel_id, w.key_version, w.wrapped_key);
      }
    });
    tx();
    return reply.code(201).send({
      invite: {
        id: inviteId,
        code,
        target_nick: targetNick,
        max_uses: maxUses,
        uses: 0,
        expires_at: ttl,
      },
    });
  });

  app.get('/communities/:id/invites', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!isStaff(memberRole(id, req.user.id))) {
      return reply.code(403).send({ error: 'yetkin yok' });
    }
    const rows = db
      .prepare(
        `SELECT i.id, i.code, i.target_user_id, u.nick AS target_nick, i.max_uses, i.uses, i.expires_at, i.created_at
         FROM invites i LEFT JOIN users u ON u.id = i.target_user_id
         WHERE i.community_id = ? ORDER BY i.created_at DESC`,
      )
      .all(id);
    return { invites: rows };
  });

  app.delete('/communities/:id/invites/:inviteId', async (req, reply) => {
    const { id, inviteId } = req.params as { id: string; inviteId: string };
    if (!isStaff(memberRole(id, req.user.id))) {
      return reply.code(403).send({ error: 'yetkin yok' });
    }
    const info = db
      .prepare('DELETE FROM invites WHERE id = ? AND community_id = ?')
      .run(inviteId, id);
    if (info.changes === 0) return reply.code(404).send({ error: 'davet bulunamadı' });
    return reply.code(204).send();
  });

  // --- redeem (step 1: peek, does NOT consume) ---
  app.get(
    '/invites/:code',
    { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const { code } = req.params as { code: string };
      const invite = db
        .prepare('SELECT * FROM invites WHERE code = ?')
        .get(code) as InviteRow | undefined;
      if (!invite) return reply.code(404).send({ error: 'davet bulunamadı' });
      const err = inviteUsable(invite, req.user.id);
      if (err) return reply.code(409).send({ error: err });
      const community = getCommunity(invite.community_id)!;
      // password-protected communities never hand out keys without the password proof
      const communityInfo = db
        .prepare('SELECT join_verifier FROM communities WHERE id = ?')
        .get(invite.community_id) as { join_verifier: string | null };
      if (communityInfo.join_verifier) {
        const salt = db
          .prepare('SELECT join_kdf_salt FROM communities WHERE id = ?')
          .get(invite.community_id) as { join_kdf_salt: string };
        return {
          community: { id: community.id, name: community.name },
          requires_password: true,
          join_kdf_salt: salt.join_kdf_salt,
        };
      }
      const keys = db
        .prepare(
          `SELECT channel_id, key_version, wrapped_key FROM invite_keys WHERE invite_id = ?`,
        )
        .all(invite.id);
      return { community: { id: community.id, name: community.name }, requires_password: false, wrapped_keys: keys };
    },
  );

  // --- complete (step 2: atomic consume + membership) ---
  app.post(
    '/invites/:code/complete',
    { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const { code } = req.params as { code: string };
      const body = req.body as CompleteBody;
      const invite = db
        .prepare('SELECT * FROM invites WHERE code = ?')
        .get(code) as InviteRow | undefined;
      if (!invite) return reply.code(404).send({ error: 'davet bulunamadı' });
      const err = inviteUsable(invite, req.user.id);
      if (err) return reply.code(409).send({ error: err });
      const channels = communityChannels(invite.community_id);
      const wrapped = body?.wrapped_keys;
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
      const user = db
        .prepare('SELECT id, nick, public_key FROM users WHERE id = ?')
        .get(req.user.id) as { id: string; nick: string; public_key: string };
      const tx = db.transaction(() => {
        db.prepare(
          'INSERT INTO members(community_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)',
        ).run(invite.community_id, req.user.id, 'member', Date.now());
        for (const w of wrapped) {
          db.prepare(
            'INSERT INTO wrapped_channel_keys(channel_id, user_id, key_version, wrapped_key) VALUES (?, ?, ?, ?)',
          ).run(w.channel_id, req.user.id, w.key_version, w.wrapped_key);
        }
        db.prepare('UPDATE invites SET uses = uses + 1 WHERE id = ?').run(invite.id);
      });
      tx();
      hub.joinCommunity(user.id, invite.community_id);
      hub.broadcast(invite.community_id, {
        type: 'community:member_added',
        community_id: invite.community_id,
        user: { id: user.id, nick: user.nick },
        public_key: user.public_key,
      });
      return reply.code(204).send();
    },
  );
}
