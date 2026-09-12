import Fastify from 'fastify';
import rateLimit from '@fastify/rate-limit';
import cookie from '@fastify/cookie';
import crypto from 'node:crypto';
import { config, clientIp } from './config.js';
import './db.js'; // open + migrate on boot
import './types.js';
import {
  verifySession,
  touchSession,
  sha256,
  SESSION_COOKIE,
  pruneSessions,
} from './auth/sessions.js';
import { authRoutes } from './routes/auth.js';
import { bootstrapRoutes } from './routes/bootstrap.js';
import { communityRoutes } from './routes/communities.js';
import { channelRoutes } from './routes/channels.js';
import { messageRoutes } from './routes/messages.js';
import { messageDeleteRoutes } from './routes/messageDel.js';
import { reactionRoutes } from './routes/reactions.js';
import { voiceRoutes } from './routes/voice.js';
import { inviteRoutes } from './routes/invites.js';
import { friendRoutes } from './routes/friends.js';
import { dmRoutes } from './routes/dms.js';
import { gdmRoutes } from './routes/gdms.js';
import { userRoutes } from './routes/users.js';
import { keyRoutes, backfillKeyLog } from './routes/keys.js';
import { attachWs } from './ws/index.js';

export const app = Fastify({
  // we sit behind nginx, which OVERWRITES X-Forwarded-For with $remote_addr
  // (web/nginx.conf) — never append; a preserved client XFF + leftmost-wins
  // would let a forged header mint fresh rate-limit buckets. Without trusting
  // the proxy every caller shares one IP and per-IP limits collapse.
  trustProxy: true,
  logger: {
    level: 'info',
    // PRIVACY: log yalnız yöntem+yol taşır. Default seriyalayıcı url'yi
    // query'siz değil yazıyor (?nick=... gibi hassas parametreler düşer) ve
    // remoteAddress (istemci IP'si) ekliyordu — ikisini de sansürledik.
    serializers: {
      req: (req) => ({ method: req.method, url: req.url?.split('?')[0] }),
    },
    redact: { paths: ['req.headers.authorization'], remove: true },
  },
  bodyLimit: 1024 * 1024,
});

await app.register(cookie);

await app.register(rateLimit, {
  global: false,
  // Authenticated requests are bucketed per session (≈ per user) so one heavy
  // user cannot exhaust everyone's quota; anonymous ones fall back to client IP.
  keyGenerator: (req) => {
    const auth = req.headers.authorization ?? req.cookies?.[SESSION_COOKIE];
    if (auth) return 'u:' + crypto.createHash('sha256').update(auth).digest('hex').slice(0, 32);
    return clientIp(req);
  },
});

// Routes reachable without a session
const PUBLIC_PATHS = new Set([
  '/api/health',
  '/api/auth/kdf-params',
  '/api/auth/register',
  '/api/auth/login',
  '/api/auth/recovery-params',
  '/api/auth/recover/unlock',
  '/api/auth/recover/finish',
  '/api/keys/log',
]);

app.addHook('onRequest', async (req, reply) => {
  // GET-only public avatar fetch — the URL is only knowable by people who
  // already talk to this user; no message content, same exposure as nicks
  if (req.method === 'GET' && /^\/api\/users\/[^/]+\/avatar$/.test(req.url.split('?')[0])) return;
  if (!req.url.startsWith('/api')) return;
  if (PUBLIC_PATHS.has(req.url.split('?')[0])) return;
  const header = req.headers.authorization;
  // Bearer header (scripts/tests) or the httpOnly session cookie (browser —
  // XSS cannot read it, unlike a localStorage token)
  const token =
    (header?.startsWith('Bearer ') ? header.slice(7) : null) ?? req.cookies?.[SESSION_COOKIE] ?? null;
  const user = token ? verifySession(token) : null;
  if (!user) return reply.code(401).send({ error: 'oturum gerekli' });
  // rolling refresh: extends at most once per half-TTL, skipped while young
  touchSession(sha256(token!), user.expires_at);
  req.user = user;
  req.sessionToken = token!;
});

app.get('/api/health', async () => ({ ok: true }));

await app.register(authRoutes, { prefix: '/api' });
await app.register(bootstrapRoutes, { prefix: '/api' });
await app.register(communityRoutes, { prefix: '/api' });
await app.register(channelRoutes, { prefix: '/api' });
await app.register(messageRoutes, { prefix: '/api' });
await app.register(messageDeleteRoutes, { prefix: '/api' });
await app.register(reactionRoutes, { prefix: '/api' });
await app.register(voiceRoutes, { prefix: '/api' });
await app.register(inviteRoutes, { prefix: '/api' });
await app.register(friendRoutes, { prefix: '/api' });
await app.register(dmRoutes, { prefix: '/api' });
await app.register(userRoutes, { prefix: '/api' });
await app.register(gdmRoutes, { prefix: '/api' });
await app.register(keyRoutes, { prefix: '/api' });

// anahtar defteri: özellikten önce kaydolmuş hesaplar için eksik satırları
// işle (tek yazı yolu appendKeyLog — sadece ekler)
backfillKeyLog();

attachWs(app);

const start = async (): Promise<void> => {
  pruneSessions();
  setInterval(pruneSessions, 3_600_000).unref();
  await app.listen({ port: config.port, host: '0.0.0.0' });
  // docker stop / systemd restart — close sockets and the DB handle cleanly
  for (const sig of ['SIGTERM', 'SIGINT'] as const) {
    process.on(sig, () => {
      app.close().finally(() => process.exit(0));
    });
  }
};

start().catch((err) => {
  app.log.error(err);
  process.exit(1);
});
