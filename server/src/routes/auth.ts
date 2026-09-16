import type { FastifyInstance } from 'fastify';
import argon2 from 'argon2';
import crypto from 'node:crypto';
import { db } from '../db.js';
import { loginSchema, NICK_REGEX, registerSchema } from '../schemas.js';
import { issueSession, revokeAllSessions, revokeSession, SESSION_COOKIE } from '../auth/sessions.js';
import { config, clientIp } from '../config.js';
import { appendKeyLog } from './keys.js';

// Cookie mirrors the Bearer token 1:1. httpOnly + SameSite=strict keeps it out
// of JS and cross-site requests; Secure flips on automatically behind TLS.
function sessionCookie(reply: { setCookie: (n: string, v: string, o: object) => void }, req: { headers: Record<string, unknown> }, token: string): void {
  const proto = req.headers['x-forwarded-proto'];
  reply.setCookie(SESSION_COOKIE, token, {
    path: '/',
    httpOnly: true,
    sameSite: 'strict',
    secure: proto === 'https',
    maxAge: config.sessionTtlDays * 86_400,
  });
}

interface RegisterBody {
  nick: string;
  kdf_salt: string;
  auth_material: string;
  public_key: string;
  sign_public_key?: string;
  key_blob: string;
  turnstile_token?: string;
  recovery?: {
    kdf_salt: string;
    auth_material: string;
    blob: string;
  };
}
interface LoginBody {
  nick: string;
  auth_material: string;
  turnstile_token?: string;
}

const publicUser = (id: string, nick: string) => ({ id, nick });

// --- nick-enumeration resistance ---
// An unknown nick must be indistinguishable from a wrong password: same status,
// same body, same argon2 cost. For the client-side KDF we hand out a
// deterministic pseudo-salt (HMAC of the nick under a server-only secret) so
// derivation runs normally and the follow-up verify simply fails.
const ENUM_SECRET = crypto.randomBytes(32);

function pseudoSalt(nick: string, domain: string): string {
  return crypto
    .createHmac('sha256', ENUM_SECRET)
    .update(`${domain}${nick.toLowerCase()}`)
    .digest('hex')
    .slice(0, 32);
}

// throwaway verifier so the unknown-nick path burns the same argon2 cost as a
// real check — otherwise response timing alone reveals account existence
let dummyVerifier: string | null = null;
async function burnVerify(): Promise<void> {
  dummyVerifier ??= await argon2.hash('timing-parity-dummy');
  await argon2.verify(dummyVerifier, '0'.repeat(44)).catch(() => false);
}

// --- login brute-force geri çekilmesi ---
// Rate limit (5/dk) pencere içindeki patlamayı keser; bu, pencereyi aşıp
// denemeye devam eden tek-IP saldırgana kademeli blok verir. In-memory —
// restart'ta sıfırlanır, kalıcı olması gerekmiyor.
const LOGIN_FAIL_WINDOW = 15 * 60_000;
const loginFails = new Map<string, number[]>();
const loginBlock = new Map<string, number>();

function loginBlocked(ip: string): boolean {
  const until = loginBlock.get(ip) ?? 0;
  if (Date.now() >= until) {
    loginBlock.delete(ip); // blok süresi doldu — unut
    return false;
  }
  return true;
}

function noteLoginFail(ip: string): void {
  const now = Date.now();
  const fails = (loginFails.get(ip) ?? []).filter((t) => now - t < LOGIN_FAIL_WINDOW);
  if (fails.length === 0) loginFails.delete(ip);
  fails.push(now);
  loginFails.set(ip, fails);
  // serbest kredinin üstünde her ekstra hata bloğu ikiye katlar (1, 2, 4, 8
  // dk...) — 15 dk'da tavan yapar
  if (fails.length > config.loginFailFree) {
    const mins = Math.min(2 ** (fails.length - config.loginFailFree - 1), 15);
    loginBlock.set(ip, now + mins * 60_000);
  }
}

// --- Cloudflare Turnstile (optional) ---
// Secret unset → the check vanishes entirely: self-hosted/LAN deployments run
// without Cloudflare. Set → register/login must carry a fresh widget token,
// verified server-side at siteverify. Any transport/parse/verification failure
// counts as failed — fail closed.
async function verifyTurnstile(
  req: { ip: string; headers: Record<string, unknown> },
  token: unknown,
): Promise<boolean> {
  if (!config.turnstileSecret) return true;
  if (typeof token !== 'string' || token.length === 0) return false;
  try {
    const res = await fetch(config.turnstileVerifyUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        secret: config.turnstileSecret,
        response: token,
        remoteip: clientIp(req),
      }),
    });
    if (!res.ok) return false;
    const out = (await res.json()) as { success?: boolean };
    return out.success === true;
  } catch {
    return false;
  }
}

// Magic-byte sniff — the client picks the format, but the server is the gate.
function detectImageMime(buf: Buffer): string {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png';
  if (
    buf.length >= 12 &&
    buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
    buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50
  ) return 'image/webp';
  return 'application/octet-stream';
}

export async function authRoutes(app: FastifyInstance): Promise<void> {
  // Salt for the client-side KDF. Unknown nicks get a pseudo-salt (see
  // enumeration resistance above) — existence must not be observable here.
  app.get(
    '/auth/kdf-params',
    { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const nick = (req.query as { nick?: string }).nick;
      if (typeof nick !== 'string' || !NICK_REGEX.test(nick)) {
        return reply.code(400).send({ error: 'geçersiz nick' });
      }
      const row = db.prepare('SELECT kdf_salt FROM users WHERE nick = ?').get(nick) as
        | { kdf_salt: string }
        | undefined;
      return { kdf_salt: row?.kdf_salt ?? pseudoSalt(nick, 'kdf') };
    },
  );

  app.post(
    '/auth/register',
    { config: { rateLimit: { max: config.registerRatePerHour, timeWindow: '1 hour' } }, schema: { body: registerSchema } },
    async (req, reply) => {
      const body = req.body as RegisterBody;
      if (!(await verifyTurnstile(req, body.turnstile_token))) {
        return reply.code(400).send({ error: 'insan doğrulaması başarısız' });
      }
      const rec = body.recovery;
      if (
        rec !== undefined &&
        (!/^[0-9a-f]{32}$/.test(rec.kdf_salt) ||
          typeof rec.auth_material !== 'string' ||
          rec.auth_material.length !== 44 ||
          typeof rec.blob !== 'string' ||
          rec.blob.length < 48 ||
          rec.blob.length > 1024)
      ) {
        return reply.code(400).send({ error: 'geçersiz kurtarma verisi' });
      }
      try {
        const verifier = await argon2.hash(body.auth_material);
        const recVerifier = rec ? await argon2.hash(rec.auth_material) : null;
        const id = crypto.randomUUID();
        // kullanıcı satırı + anahtar defteri satırı tek işlemde — defterde
        // kaydı olmayan yayılmış bir public key kalmasın
        const tx = db.transaction(() => {
          db.prepare(
            `INSERT INTO users(id, nick, kdf_salt, verifier, public_key, sign_public_key, key_blob, recovery_salt, recovery_blob, recovery_verifier, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          ).run(
            id,
            body.nick,
            body.kdf_salt,
            verifier,
            body.public_key,
            body.sign_public_key ?? null,
            body.key_blob,
            rec?.kdf_salt ?? null,
            rec?.blob ?? null,
            recVerifier,
            Date.now(),
          );
          appendKeyLog(id, body.public_key, body.sign_public_key);
        });
        tx();
        const token = issueSession(id);
        sessionCookie(reply, req, token);
        return reply.code(201).send({ token, user: publicUser(id, body.nick) });
      } catch (err) {
        if (err instanceof Error && err.message.includes('UNIQUE')) {
          return reply.code(409).send({ error: 'bu nick zaten alınmış' });
        }
        throw err;
      }
    },
  );

  app.post(
    '/auth/login',
    { config: { rateLimit: { max: 5, timeWindow: '1 minute' } }, schema: { body: loginSchema } },
    async (req, reply) => {
      const body = req.body as LoginBody;
      const ip = clientIp(req);
      // kademeli blok, arama maliyeti ödemeden önce reddedilir
      if (loginBlocked(ip)) {
        return reply.code(429).send({ error: 'çok fazla başarısız giriş — sonra tekrar dene' });
      }
      // before the lookup: a missing/bad token must not probe nicks any further
      if (!(await verifyTurnstile(req, body.turnstile_token))) {
        return reply.code(400).send({ error: 'insan doğrulaması başarısız' });
      }
      const row = db
        .prepare('SELECT id, nick, verifier, public_key, key_blob FROM users WHERE nick = ?')
        .get(body.nick) as
        | { id: string; nick: string; verifier: string; public_key: string; key_blob: string }
        | undefined;
      if (!row) {
        // burn the same argon2 cost a real verify would, then fail uniformly
        await burnVerify();
        noteLoginFail(ip);
        return reply.code(401).send({ error: 'nick veya şifre hatalı' });
      }
      const ok = await argon2.verify(row.verifier, body.auth_material).catch(() => false);
      if (!ok) {
        noteLoginFail(ip);
        return reply.code(401).send({ error: 'nick veya şifre hatalı' });
      }
      loginFails.delete(ip);
      loginBlock.delete(ip);
      const token = issueSession(row.id);
      sessionCookie(reply, req, token);
      return {
        token,
        user: { ...publicUser(row.id, row.nick), public_key: row.public_key, key_blob: row.key_blob },
      };
    },
  );

  // Session restore: lets a reloaded tab re-fetch the blob without a password prompt.
  app.get('/auth/me', async (req) => {
    const row = db
      .prepare('SELECT id, nick, public_key, key_blob, avatar_updated_at FROM users WHERE id = ?')
      .get(req.user.id) as { id: string; nick: string; public_key: string; key_blob: string; avatar_updated_at: number | null };
    return {
      user: {
        ...publicUser(row.id, row.nick),
        public_key: row.public_key,
        key_blob: row.key_blob,
        avatar_updated_at: row.avatar_updated_at ?? null,
      },
    };
  });

  app.post('/auth/logout', async (req, reply) => {
    revokeSession(req.sessionToken);
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return reply.code(204).send();
  });

  // Password change: verifies old material, replaces salt + verifier + blob.
  // Channel keys are untouched — they are wrapped to the X25519 identity, which
  // does not change with the password.
  app.post(
    '/auth/password',
    {
      config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
      schema: {
        body: {
          type: 'object',
          required: ['old_auth_material', 'new_kdf_salt', 'new_auth_material', 'new_key_blob'],
          additionalProperties: false,
          properties: {
            old_auth_material: { type: 'string', minLength: 44, maxLength: 44 },
            new_kdf_salt: { type: 'string', minLength: 32, maxLength: 32, pattern: '^[0-9a-f]{32}$' },
            new_auth_material: { type: 'string', minLength: 44, maxLength: 44 },
            new_key_blob: { type: 'string', minLength: 48, maxLength: 1024 },
          },
        },
      },
    },
    async (req, reply) => {
      const body = req.body as {
        old_auth_material: string;
        new_kdf_salt: string;
        new_auth_material: string;
        new_key_blob: string;
      };
      const row = db
        .prepare('SELECT verifier FROM users WHERE id = ?')
        .get(req.user.id) as { verifier: string } | undefined;
      if (!row) return reply.code(404).send({ error: 'kullanıcı bulunamadı' });
      const ok = await argon2.verify(row.verifier, body.old_auth_material).catch(() => false);
      if (!ok) return reply.code(401).send({ error: 'eski şifre hatalı' });
      const verifier = await argon2.hash(body.new_auth_material);
      const tx = db.transaction(() => {
        db.prepare('UPDATE users SET kdf_salt = ?, verifier = ?, key_blob = ? WHERE id = ?').run(
          body.new_kdf_salt,
          verifier,
          body.new_key_blob,
          req.user.id,
        );
        // every session drops — including a hijacker's; the client re-logs in
        revokeAllSessions(req.user.id);
      });
      tx();
      reply.clearCookie(SESSION_COOKIE, { path: '/' });
      return reply.code(204).send();
    },
  );

  // --- avatar: small JPEG/PNG/WebP blob, capped at 16KB on the wire ---

  // Public avatar fetch. `?v=<updatedAt>` is the cache key — clients pin the
  // URL on the timestamp so a re-upload invalidates with no server-side cache
  // coordination. Returns 204 when the user has no avatar set.
  app.get('/users/:id/avatar', async (req, reply) => {
    const { id } = req.params as { id: string };
    const row = db
      .prepare('SELECT avatar_data, avatar_updated_at FROM users WHERE id = ?')
      .get(id) as { avatar_data: Buffer | null; avatar_updated_at: number | null } | undefined;
    if (!row || !row.avatar_data || !row.avatar_updated_at) {
      return reply.code(204).send();
    }
    reply.header('content-type', detectImageMime(row.avatar_data));
    reply.header('cache-control', 'public, max-age=3600');
    return reply.send(row.avatar_data);
  });

  // Upload / replace. Body is a raw data URL (`data:image/jpeg;base64,...`)
  // with a hard size cap. We re-validate the magic bytes server-side too —
  // never trust the client-declared type.
  app.patch(
    '/users/me/avatar',
    {
      config: { rateLimit: { max: 10, timeWindow: '1 hour' } },
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          properties: {
            data_url: { type: 'string', minLength: 64, maxLength: 24_000 },
            clear: { type: 'boolean' },
          },
        },
      },
    },
    async (req, reply) => {
      const body = req.body as { data_url?: string; clear?: boolean };
      if (body.clear) {
        db.prepare('UPDATE users SET avatar_data = NULL, avatar_updated_at = NULL WHERE id = ?').run(
          req.user.id,
        );
        return reply.code(204).send();
      }
      if (!body.data_url) return reply.code(400).send({ error: 'data_url gerekli' });
      const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(body.data_url);
      if (!m) return reply.code(400).send({ error: 'geçersiz resim' });
      const buf = Buffer.from(m[2]!, 'base64');
      // hard cap: rejects fat uploads even if the client-side resize was bypassed
      if (buf.length === 0 || buf.length > 16_000) {
        return reply.code(413).send({ error: 'avatar çok büyük (max 16KB)' });
      }
      if (!detectImageMime(buf).startsWith('image/')) {
        return reply.code(400).send({ error: 'geçersiz resim baytları' });
      }
      db.prepare('UPDATE users SET avatar_data = ?, avatar_updated_at = ? WHERE id = ?').run(
        buf,
        Date.now(),
        req.user.id,
      );
      return reply.code(204).send();
    },
  );

  // --- recovery phrase ---

  // salt for the recovery KDF (mirrors kdf-params; pseudo-salt when no phrase
  // is set — the flow must fail at verify, not here)
  app.get(
    '/auth/recovery-params',
    { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const nick = (req.query as { nick?: string }).nick;
      if (typeof nick !== 'string' || !NICK_REGEX.test(nick)) {
        return reply.code(400).send({ error: 'geçersiz nick' });
      }
      const row = db.prepare('SELECT recovery_salt FROM users WHERE nick = ?').get(nick) as
        | { recovery_salt: string | null }
        | undefined;
      return { recovery_salt: row?.recovery_salt ?? pseudoSalt(nick, 'recovery') };
    },
  );

  // attach a phrase to an existing logged-in account (accounts created before
  // the ritual, or a fresh phrase after compromise fears)
  app.post(
    '/auth/recovery',
    { config: { rateLimit: { max: 5, timeWindow: '1 hour' } } },
    async (req, reply) => {
      const body = req.body as { kdf_salt?: string; auth_material?: string; blob?: string };
      if (
        !/^[0-9a-f]{32}$/.test(body?.kdf_salt ?? '') ||
        typeof body?.auth_material !== 'string' ||
        body.auth_material.length !== 44 ||
        typeof body?.blob !== 'string' ||
        body.blob.length < 48 ||
        body.blob.length > 1024
      ) {
        return reply.code(400).send({ error: 'geçersiz kurtarma verisi' });
      }
      const verifier = await argon2.hash(body.auth_material);
      db.prepare(
        'UPDATE users SET recovery_salt = ?, recovery_blob = ?, recovery_verifier = ? WHERE id = ?',
      ).run(body.kdf_salt, body.blob, verifier, req.user.id);
      return reply.code(204).send();
    },
  );

  // "forgot password" step 1: prove the phrase → receive the recovery blob
  // (identity wrapped under the phrase-derived KEK). Nothing changes yet.
  app.post(
    '/auth/recover/unlock',
    { config: { rateLimit: { max: 5, timeWindow: '1 hour' } } },
    async (req, reply) => {
      const body = (req.body ?? {}) as { nick?: string; recovery_auth_material?: string };
      if (typeof body?.nick !== 'string' || !NICK_REGEX.test(body.nick)) {
        return reply.code(400).send({ error: 'geçersiz nick' });
      }
      if (typeof body?.recovery_auth_material !== 'string' || body.recovery_auth_material.length !== 44) {
        return reply.code(400).send({ error: 'geçersiz kanıt' });
      }
      const row = db
        .prepare('SELECT id, recovery_verifier, recovery_blob, public_key FROM users WHERE nick = ?')
        .get(body.nick) as
        | {
            id: string;
            recovery_verifier: string | null;
            recovery_blob: string | null;
            public_key: string;
          }
        | undefined;
      if (!row?.recovery_verifier || !row.recovery_blob) {
        // unknown nick and no-phrase look identical to a wrong phrase
        await burnVerify();
        return reply.code(401).send({ error: 'nick veya kurtarma ifadesi hatalı' });
      }
      const ok = await argon2
        .verify(row.recovery_verifier, body.recovery_auth_material)
        .catch(() => false);
      if (!ok) return reply.code(401).send({ error: 'nick veya kurtarma ifadesi hatalı' });
      return reply.code(200).send({ recovery_blob: row.recovery_blob, public_key: row.public_key });
    },
  );

  // "forgot password" step 2: set the new password material + rewrapped blob.
  // The identity (public key) stays the same; every existing session drops.
  app.post(
    '/auth/recover/finish',
    { config: { rateLimit: { max: 5, timeWindow: '1 hour' } } },
    async (req, reply) => {
      const body = (req.body ?? {}) as {
        nick?: string;
        recovery_auth_material?: string;
        new_kdf_salt?: string;
        new_auth_material?: string;
        new_key_blob?: string;
      };
      if (
        typeof body?.nick !== 'string' ||
        !NICK_REGEX.test(body.nick) ||
        typeof body?.recovery_auth_material !== 'string' ||
        body.recovery_auth_material.length !== 44 ||
        !/^[0-9a-f]{32}$/.test(body?.new_kdf_salt ?? '') ||
        typeof body?.new_auth_material !== 'string' ||
        body.new_auth_material.length !== 44 ||
        typeof body?.new_key_blob !== 'string' ||
        body.new_key_blob.length < 48 ||
        body.new_key_blob.length > 1024
      ) {
        return reply.code(400).send({ error: 'geçersiz veri' });
      }
      const row = db
        .prepare('SELECT id, nick, recovery_verifier, public_key, key_blob FROM users WHERE nick = ?')
        .get(body.nick) as
        | {
            id: string;
            nick: string;
            recovery_verifier: string | null;
            public_key: string;
            key_blob: string;
          }
        | undefined;
      if (!row?.recovery_verifier) {
        // same unification as recover/unlock — no-phrase ≡ unknown nick ≡ wrong phrase
        await burnVerify();
        return reply.code(401).send({ error: 'nick veya kurtarma ifadesi hatalı' });
      }
      const ok = await argon2
        .verify(row.recovery_verifier, body.recovery_auth_material)
        .catch(() => false);
      if (!ok) return reply.code(401).send({ error: 'nick veya kurtarma ifadesi hatalı' });
      const verifier = await argon2.hash(body.new_auth_material);
      const tx = db.transaction(() => {
        db.prepare('UPDATE users SET kdf_salt = ?, verifier = ?, key_blob = ? WHERE id = ?').run(
          body.new_kdf_salt,
          verifier,
          body.new_key_blob,
          row.id,
        );
        revokeAllSessions(row.id);
      });
      tx();
      const token = issueSession(row.id);
      sessionCookie(reply, req, token);
      return {
        token,
        user: { ...publicUser(row.id, row.nick), public_key: row.public_key, key_blob: body.new_key_blob },
      };
    },
  );
}
