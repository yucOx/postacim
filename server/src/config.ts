import path from 'node:path';
import { fileURLToPath } from 'node:url';

const num = (v: string | undefined, d: number): number =>
  v !== undefined && !Number.isNaN(Number(v)) ? Number(v) : d;

// default: <repo>/server/data — independent of the process cwd
const defaultDataDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../data');

// Secrets that ship in examples/docs — anyone can mint room tokens with them
const KNOWN_WEAK_SECRETS = new Set([
  '',
  'devkey',
  'secret',
  'awesomekey', // livekit --dev default
  'pgv-dev-secret-please-change-me-0123456789abcdef', // .env.example value
]);

const livekitSecret = process.env.LIVEKIT_SECRET ?? '';
if (
  KNOWN_WEAK_SECRETS.has(livekitSecret) &&
  process.env.PGV_ALLOW_DEV_LIVEKIT !== '1' // local-dev escape hatch
) {
  console.error(
    '[postacim] LIVEKIT_SECRET eksik veya bilinen bir örnek değer — canlı ortamda herkes oda tokenı üretebilir.\n' +
      'Güçlü bir çift üret:  docker run --rm livekit/livekit-server:v1.13.1 generate-keys\n' +
      'Değerleri .env dosyasına yaz (LIVEKIT_API_KEY + LIVEKIT_SECRET, livekit ve server birlikte kullanır).\n' +
      'Yalnız yerel geliştirme için: PGV_ALLOW_DEV_LIVEKIT=1',
  );
  process.exit(1);
}

export const config = {
  port: num(process.env.PORT, 4000),
  dataDir: process.env.DATA_DIR ?? defaultDataDir,
  livekitUrl: process.env.LIVEKIT_URL ?? 'http://localhost:7880',
  livekitApiKey: process.env.LIVEKIT_API_KEY ?? 'devkey',
  livekitSecret,
  // default 7 days — a stolen cookie's validity window; SESSION_TTL_DAYS env overrides
  sessionTtlDays: num(process.env.SESSION_TTL_DAYS, 7),
  /** dev/testing knob — keep 3 in production */
  registerRatePerHour: num(process.env.REGISTER_RATE_PER_HOUR, 3),
};
