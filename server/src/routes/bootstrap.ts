import type { FastifyInstance } from 'fastify';
import { db } from '../db.js';
import { communityChannels, communityMembers, type Role } from '../lib/access.js';

interface BootstrapCommunity {
  id: string;
  name: string;
  role: import('../lib/access.js').Role;
  members: { id: string; nick: string; role: import('../lib/access.js').Role }[];
  channels: {
    id: string;
    name: string;
    type: 'text' | 'voice';
    key_version: number;
    my_wrapped_key: string | null;
  }[];
  pending_join_requests: number;
  has_join_password: boolean;
}

// One call hydrates the whole app: communities, members, channels and the
// caller's latest wrapped key per channel. Only sealed boxes leave the server.
export async function bootstrapRoutes(app: FastifyInstance): Promise<void> {
  app.get('/bootstrap', async (req) => {
    const communities = db
      .prepare(
        `SELECT c.id, c.name, m.role FROM communities c
         JOIN members m ON m.community_id = c.id
         WHERE m.user_id = ? ORDER BY c.created_at`,
      )
      .all(req.user.id) as { id: string; name: string; role: Role }[];

    const myKeys = db
      .prepare(
        `SELECT w.channel_id, w.key_version, w.wrapped_key
         FROM wrapped_channel_keys w
         JOIN channels ch ON ch.id = w.channel_id
         WHERE w.user_id = ? AND w.key_version = ch.key_version`,
      )
      .all(req.user.id) as { channel_id: string; key_version: number; wrapped_key: string }[];
    const keyByChannel = new Map(myKeys.map((k) => [k.channel_id, k.wrapped_key]));

    const publicKeys: Record<string, string> = {};
    const result: BootstrapCommunity[] = communities.map((c) => {
      const members = communityMembers(c.id);
      const staff = c.role === 'owner' || c.role === 'admin';
      const pending = staff
        ? (
            db
              .prepare("SELECT COUNT(*) AS n FROM join_requests WHERE community_id = ? AND status = 'pending'")
              .get(c.id) as { n: number }
          ).n
        : 0;
      const hasJoinPassword = !!(
        db
          .prepare('SELECT join_verifier FROM communities WHERE id = ?')
          .get(c.id) as { join_verifier: string | null }
      ).join_verifier;
      return {
        ...c,
        members: members.map((m) => {
          publicKeys[m.id] = m.public_key;
          return { id: m.id, nick: m.nick, role: m.role };
        }),
        channels: communityChannels(c.id).map((ch) => ({
          id: ch.id,
          name: ch.name,
          type: ch.type,
          key_version: ch.key_version,
          my_wrapped_key: keyByChannel.get(ch.id) ?? null,
        })),
        pending_join_requests: pending,
        has_join_password: hasJoinPassword,
      };
    });

    return { communities: result, public_keys: publicKeys };
  });
}
