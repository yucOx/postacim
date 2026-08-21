import type { FastifyInstance } from 'fastify';
import { db } from '../db.js';
import { communityChannels, communityMembers, type Role } from '../lib/access.js';

interface BootstrapCommunity {
  id: string;
  name: string;
  role: Role;
  members: { id: string; nick: string; role: Role }[];
  channels: {
    id: string;
    name: string;
    type: 'text' | 'voice';
    key_version: number;
    my_wrapped_key: string | null;
  }[];
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
    const result: BootstrapCommunity[] = communities.map((c) => ({
      ...c,
      members: communityMembers(c.id).map((m) => {
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
    }));

    return { communities: result, public_keys: publicKeys };
  });
}
