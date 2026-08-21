import { WebSocketServer, type WebSocket } from 'ws';
import type { FastifyInstance } from 'fastify';
import { verifySession } from '../auth/sessions.js';
import { hub } from './hub.js';
import { db } from '../db.js';

// Auth-first-frame protocol: the first message must authenticate the socket,
// anything else closes it. After that only voice_state is accepted.
export function attachWs(app: FastifyInstance): void {
  const wss = new WebSocketServer({ server: app.server, path: '/ws', maxPayload: 1 << 20 });

  wss.on('connection', (ws: WebSocket) => {
    let authed = false;
    let userId = '';

    ws.on('message', (raw) => {
      let msg: { type?: string; token?: string; channel_id?: string; state?: string };
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        ws.close(4002, 'geçersiz json');
        return;
      }
      if (!authed) {
        if (msg?.type !== 'auth' || typeof msg.token !== 'string') {
          ws.close(4001, 'önce auth');
          return;
        }
        const user = verifySession(msg.token);
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
