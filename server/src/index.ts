import Fastify from 'fastify';
import { config } from './config.js';
import './db.js'; // open + migrate on boot

export const app = Fastify({
  logger: { level: 'info' },
  bodyLimit: 1024 * 1024,
});

app.get('/api/health', async () => ({ ok: true }));

const start = async (): Promise<void> => {
  await app.listen({ port: config.port, host: '0.0.0.0' });
};

start().catch((err) => {
  app.log.error(err);
  process.exit(1);
});
