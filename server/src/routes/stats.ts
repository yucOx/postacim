import type { FastifyInstance } from 'fastify';
import { db } from '../db.js';
import { hub } from '../ws/hub.js';
import { livekitStats } from '../livekit.js';

const n = (sql: string, ...args: unknown[]): number =>
  (db.prepare(sql).get(...args) as { n: number } | undefined)?.n ?? 0;

/** Capacity tracking (GET /api/stats — authed, aggregates only, no per-user
 *  rows). The capacity ladder lives in README: ~40 concurrent calls → free,
 *  ~60 → drop default quality, ~80+ → move LiveKit to its own host. */
export async function statsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/stats', async () => {
    // SFU erişilemezse stats düşmesin — 0'la devam
    let sfu = { rooms: 0, participants: 0 };
    try {
      sfu = await livekitStats();
    } catch {
      // LiveKit down / restarting
    }
    return {
      users: n('SELECT COUNT(*) AS n FROM users'),
      sessions24h: n('SELECT COUNT(*) AS n FROM sessions WHERE created_at > ?', Date.now() - 86_400_000),
      openSockets: hub.openSockets(),
      voicePeers: hub.voicePeers(),
      dmCalls: hub.dmCallCount(),
      sfuRooms: sfu.rooms,
      sfuParticipants: sfu.participants,
    };
  });
}
