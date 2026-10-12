import type { FastifyInstance } from 'fastify';
import { db } from '../db.js';
import { config } from '../config.js';
import { getChannel, memberRole } from '../lib/access.js';
import { getDm } from '../lib/social.js';
import { hub } from '../ws/hub.js';
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

  // Medya gönderen atfı: odadaki katılımcı LiveKit identity'sini (= user_id)
  // Ed25519 ile imzalayıp duyurur. Sunucu opak relay (dh_update gibi) —
  // doğrulama alıcıda, anahtar defterindeki imza anahtarıyla. Kötü sunucu
  // sahte identity'li hayalet katılımcı basabilir ama onun adına imzalı
  // duyuru üretemez → istemcide "doğrulanmadı" görünür.
  app.post(
    '/voice/attest',
    { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const b = (req.body ?? {}) as Record<string, unknown>;
      const channelId = typeof b.channel_id === 'string' ? b.channel_id : '';
      const identity = typeof b.identity === 'string' ? b.identity : '';
      const payload = typeof b.payload === 'string' ? b.payload : '';
      const signature = typeof b.signature === 'string' ? b.signature : '';
      if (!channelId || !identity || !payload || !signature) {
        return reply.code(400).send({ error: 'eksik alan' });
      }
      if (identity.length > 64 || payload.length > 512 || signature.length > 128) {
        return reply.code(413).send({ error: 'payload çok büyük' });
      }
      const relay = {
        type: 'voice:attest',
        channel_id: channelId,
        user_id: req.user.id,
        identity,
        payload,
        signature,
      };
      const channel = getChannel(channelId);
      if (channel) {
        if (channel.type !== 'voice') return reply.code(400).send({ error: 'sesli kanal değil' });
        if (!memberRole(channel.community_id, req.user.id)) {
          return reply.code(403).send({ error: 'üye değilsin' });
        }
        hub.broadcast(channel.community_id, relay);
      } else {
        const dm = getDm(channelId, req.user.id);
        if (!dm) return reply.code(404).send({ error: 'kanal bulunamadı' });
        const peer = dm.user_a === req.user.id ? dm.user_b : dm.user_a;
        hub.sendToUser(peer, relay);
      }
      return reply.code(204).send();
    },
  );
}
