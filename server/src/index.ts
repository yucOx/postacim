import Fastify from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { config } from './config.js';
import './db.js'; // open + migrate on boot
import './types.js';
import { verifySession } from './auth/sessions.js';
import { authRoutes } from './routes/auth.js';
import { bootstrapRoutes } from './routes/bootstrap.js';
import { communityRoutes } from './routes/communities.js';
import { channelRoutes } from './routes/channels.js';
import { messageRoutes } from './routes/messages.js';
import { voiceRoutes } from './routes/voice.js';
import { inviteRoutes } from './routes/invites.js';
import { friendRoutes } from './routes/friends.js';
import { dmRoutes } from './routes/dms.js';
import { gdmRoutes } from './routes/gdms.js';
import { attachWs } from './ws/index.js';

export const app = Fastify({
  logger: {
    level: 'info',
    redact: { paths: ['req.headers.authorization'], remove: true },
  },
  bodyLimit: 1024 * 1024,
});

await app.register(rateLimit, { global: false });

// Routes reachable without a session
const PUBLIC_PATHS = new Set([
  '/api/health',
  '/api/auth/kdf-params',
  '/api/auth/register',
  '/api/auth/login',
]);

app.addHook('onRequest', async (req, reply) => {
  if (!req.url.startsWith('/api')) return;
  if (PUBLIC_PATHS.has(req.url.split('?')[0])) return;
  const header = req.headers.authorization;
  const token = header?.startsWith('Bearer ') ? header.slice(7) : null;
  const user = token ? verifySession(token) : null;
  if (!user) return reply.code(401).send({ error: 'oturum gerekli' });
  req.user = user;
  req.sessionToken = token!;
});

app.get('/api/health', async () => ({ ok: true }));

await app.register(authRoutes, { prefix: '/api' });
await app.register(bootstrapRoutes, { prefix: '/api' });
await app.register(communityRoutes, { prefix: '/api' });
await app.register(channelRoutes, { prefix: '/api' });
await app.register(messageRoutes, { prefix: '/api' });
await app.register(voiceRoutes, { prefix: '/api' });
await app.register(inviteRoutes, { prefix: '/api' });
await app.register(friendRoutes, { prefix: '/api' });
await app.register(dmRoutes, { prefix: '/api' });
await app.register(gdmRoutes, { prefix: '/api' });

attachWs(app);

const start = async (): Promise<void> => {
  await app.listen({ port: config.port, host: '0.0.0.0' });
};

start().catch((err) => {
  app.log.error(err);
  process.exit(1);
});
