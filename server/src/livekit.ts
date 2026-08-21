import { AccessToken, RoomServiceClient } from 'livekit-server-sdk';
import { config } from './config.js';

// Offline-signed JWT: the server never talks to livekit-server for this.
export async function mintVoiceToken(
  user: { id: string; nick: string },
  channelId: string,
): Promise<string> {
  const at = new AccessToken(config.livekitApiKey, config.livekitSecret, {
    identity: user.id,
    name: user.nick,
    // short-lived: tokens are stateless, so a kicked member could otherwise
    // reconnect to the room with a stale one for the full TTL. 15m bounds that
    // window; legit clients mint a fresh token on every join.
    ttl: '15m',
  });
  at.addGrant({ room: `ch_${channelId}`, roomJoin: true, canPublish: true, canSubscribe: true });
  return at.toJwt();
}

// Drop a user's live connections from the given rooms. Token TTL alone does not
// kill an established session, so membership loss must actively evict.
// Fire-and-forget tolerant: if the SFU is unreachable we still removed the
// wrapped keys, so the user cannot rejoin.
export async function evictFromRooms(user: { id: string }, channelIds: string[]): Promise<void> {
  if (channelIds.length === 0) return;
  const svc = new RoomServiceClient(config.livekitUrl, config.livekitApiKey, config.livekitSecret);
  await Promise.allSettled(
    channelIds.map((cid) => svc.removeParticipant(`ch_${cid}`, user.id)),
  );
}
