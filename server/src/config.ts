import path from 'node:path';
import { fileURLToPath } from 'node:url';

const num = (v: string | undefined, d: number): number =>
  v !== undefined && !Number.isNaN(Number(v)) ? Number(v) : d;

// default: <repo>/server/data — independent of the process cwd
const defaultDataDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../data');

export const config = {
  port: num(process.env.PORT, 4000),
  dataDir: process.env.DATA_DIR ?? defaultDataDir,
  livekitUrl: process.env.LIVEKIT_URL ?? 'http://localhost:7880',
  livekitApiKey: process.env.LIVEKIT_API_KEY ?? 'devkey',
  livekitSecret:
    process.env.LIVEKIT_SECRET ?? 'pgv-dev-secret-please-change-me-0123456789abcdef',
  sessionTtlDays: num(process.env.SESSION_TTL_DAYS, 30),
};
