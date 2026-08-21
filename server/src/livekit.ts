import { AccessToken } from 'livekit-server-sdk';
import { config } from './config.js';

// Offline-signed JWT: the server never talks to livekit-server for this.
export async function mintVoiceToken(
  user: { id: string; nick: string },
  channelId: string,
): Promise<string> {
  const at = new AccessToken(config.livekitApiKey, config.livekitSecret, {
    identity: user.id,
    name: user.nick,
    ttl: '2h',
  });
  at.addGrant({ room: `ch_${channelId}`, roomJoin: true, canPublish: true, canSubscribe: true });
  return at.toJwt();
}
