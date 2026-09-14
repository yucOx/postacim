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
  // kill switch: SCREEN_SHARE=off → voice tokens drop the screen_share publish
  // source; clients physically cannot publish a stream (UI hides it too loose
  // to trust — the token is the enforcement point)
  screenShareEnabled: process.env.SCREEN_SHARE !== 'off',
  // default 7 days — a stolen cookie's validity window; SESSION_TTL_DAYS env overrides
  sessionTtlDays: num(process.env.SESSION_TTL_DAYS, 7),
  /** optional Cloudflare Turnstile — unset secret disables the check entirely
   *  (self-hosted/LAN deployments run with no third-party dependency) */
  turnstileSecret: process.env.TURNSTILE_SECRET ?? '',
  // env override exists for tests: point it at an offline mock of siteverify
  turnstileVerifyUrl:
    process.env.TURNSTILE_VERIFY_URL ?? 'https://challenges.cloudflare.com/turnstile/v0/siteverify',
  /** dev/testing knob — keep 3 in production */
  registerRatePerHour: num(process.env.REGISTER_RATE_PER_HOUR, 3),
  /** dev/testing knob — keep 10 in production: login geri çekilmesindeki
   *  pencere içi cezasız hata hakkı (LOGIN_FAIL_FREE) */
  loginFailFree: num(process.env.LOGIN_FAIL_FREE, 10),
  /** set 1 when the app sits behind a Cloudflare proxy: rate limits and the
   *  Turnstile remoteip then use the CF-Connecting-IP header (the real client)
   *  instead of the CF edge IP nginx forwards. Only enable it when the server
   *  is reachable ONLY through Cloudflare — a direct client could forge the header. */
  trustCfConnectingIp: process.env.PGV_TRUST_CF_IP === '1',
};

/** the client IP to bucket on: CF-Connecting-IP when behind Cloudflare, else
 *  the trustProxy-resolved address */
export function clientIp(req: { ip: string; headers: Record<string, unknown> }): string {
  if (config.trustCfConnectingIp) {
    const cf = req.headers['cf-connecting-ip'];
    if (typeof cf === 'string' && cf) return cf;
  }
  return req.ip;
}
