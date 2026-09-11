import type { FastifyInstance } from 'fastify';
import { db } from '../db.js';

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
}
