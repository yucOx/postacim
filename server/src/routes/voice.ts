import type { FastifyInstance } from 'fastify';
import { db } from '../db.js';
import { config } from '../config.js';
import { getChannel, memberRole } from '../lib/access.js';
import { mintVoiceToken } from '../livekit.js';

export async function voiceRoutes(app: FastifyInstance): Promise<void> {
  app.post('/channels/:id/voice-token', async (req, reply) => {
    const { id } = req.params as { id: string };
    const channel = getChannel(id);
    if (!channel) return reply.code(404).send({ error: 'kanal bulunamadı' });
    if (channel.type !== 'voice') return reply.code(400).send({ error: 'sesli kanal değil' });
    if (!memberRole(channel.community_id, req.user.id)) {
      return reply.code(403).send({ error: 'üye değilsin' });
    }
    if (channel.needs_rekey) {
      return reply.code(409).send({ error: 'kanal yeniden anahtarlanmalı — sahip/admin anahtarı yenilesin' });
    }
    // a wrapped key row is proof this member received the channel key
    const hasKey = db
      .prepare(
        'SELECT 1 FROM wrapped_channel_keys WHERE channel_id = ? AND user_id = ? AND key_version = ?',
      )
      .get(id, req.user.id, channel.key_version);
    if (!hasKey) return reply.code(403).send({ error: 'anahtarın yok' });

    const token = await mintVoiceToken(req.user, id);
    return { url: config.livekitUrl, token };
  });
}
