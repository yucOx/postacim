import { WebSocketServer, type WebSocket } from 'ws';
import type { FastifyInstance } from 'fastify';
import { verifySession } from '../auth/sessions.js';
import { hub } from './hub.js';
import { db } from '../db.js';
import { getDm } from '../lib/social.js';

// Auth-first-frame protocol: the first message must authenticate the socket,
// anything else closes it. After that only voice_state is accepted.
export function attachWs(app: FastifyInstance): void {
  const wss = new WebSocketServer({ server: app.server, path: '/ws', maxPayload: 1 << 20 });

  wss.on('connection', (ws: WebSocket, req) => {
    let authed = false;
    let userId = '';

    // cookie fallback: browsers carry the httpOnly session cookie on the
    // upgrade request, so the auth frame needs no token at all
    const cookieToken = /(?:^|;\s*)pgv_session=([^;]+)/.exec(req.headers.cookie ?? '')?.[1];

    ws.on('message', (raw) => {
      let msg: { type?: string; token?: string; channel_id?: string; state?: string };
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        ws.close(4002, 'geçersiz json');
        return;
      }
      if (!authed) {
        if (msg?.type !== 'auth') {
          ws.close(4001, 'önce auth');
          return;
        }
        const token = typeof msg.token === 'string' ? msg.token : cookieToken;
        const user = token ? verifySession(token) : null;
        if (!user) {
          ws.close(4003, 'geçersiz oturum');
          return;
        }
        authed = true;
        userId = user.id;
        hub.register(ws, user);
        ws.send(JSON.stringify({ type: 'ready' }));
        return;
      }
      if (
        msg?.type === 'voice_state' &&
        typeof msg.channel_id === 'string' &&
        (msg.state === 'joined' || msg.state === 'left')
      ) {
        const channel = db
          .prepare('SELECT community_id FROM channels WHERE id = ?')
          .get(msg.channel_id) as { community_id: string } | undefined;
        if (!channel) return;
        const nick = db.prepare('SELECT nick FROM users WHERE id = ?').get(userId) as
          | { nick: string }
          | undefined;
        if (!nick) return;
        hub.setVoice(userId, nick.nick, channel.community_id, msg.channel_id, msg.state === 'joined');
        return;
      }

      // --- 1:1 DM call signaling (caller/relayed; media goes through LiveKit) ---
      const CALL_MSGS = ['call:ring', 'call:accept', 'call:decline', 'call:cancel'] as const;
      if (
        typeof msg?.type === 'string' &&
        (CALL_MSGS as readonly string[]).includes(msg.type) &&
        typeof msg.channel_id === 'string'
      ) {
        const dm = getDm(msg.channel_id, userId);
        if (!dm) return;
        const peerId = dm.user_a === userId ? dm.user_b : dm.user_a;
        const nick = db.prepare('SELECT nick FROM users WHERE id = ?').get(userId) as
          | { nick: string }
          | undefined;
        const nickStr = nick?.nick ?? '?';
        switch (msg.type) {
          case 'call:ring':
            // caller is signaling — track the call so we can end it on disconnect
            hub.addDmCall(msg.channel_id, userId, peerId);
            hub.sendToUser(peerId, {
              type: 'call:incoming',
              channel_id: msg.channel_id,
              from: { id: userId, nick: nickStr },
            });
            break;
          case 'call:accept':
            hub.addDmCall(msg.channel_id, userId, peerId);
            hub.sendToUser(peerId, { type: 'call:accepted', channel_id: msg.channel_id });
            break;
          case 'call:decline':
            hub.endDmCallFor(userId, 'declined');
            hub.sendToUser(peerId, { type: 'call:declined', channel_id: msg.channel_id });
            break;
          case 'call:cancel':
            hub.endDmCallFor(userId, 'cancelled');
            hub.sendToUser(peerId, { type: 'call:cancelled', channel_id: msg.channel_id });
            break;
        }
      }
    });

    ws.on('pong', () => hub.markAlive(ws));
    ws.on('close', () => {
      if (authed) hub.unregister(ws);
    });
  });

  const sweep = setInterval(() => hub.sweep(), 30_000);
  wss.on('close', () => clearInterval(sweep));
}
