import Fastify from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { config } from './config.js';
import './db.js'; // open + migrate on boot
import './types.js';
import { verifySession } from './auth/sessions.js';
import { authRoutes } from './routes/auth.js';

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

const start = async (): Promise<void> => {
  await app.listen({ port: config.port, host: '0.0.0.0' });
};

start().catch((err) => {
  app.log.error(err);
  process.exit(1);
});
