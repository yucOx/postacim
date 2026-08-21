import type { FastifyInstance } from 'fastify';
import argon2 from 'argon2';
import crypto from 'node:crypto';
import { db } from '../db.js';
import { loginSchema, NICK_REGEX, registerSchema } from '../schemas.js';
import { issueSession, revokeAllSessions, revokeSession, SESSION_COOKIE } from '../auth/sessions.js';
import { config } from '../config.js';

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
  key_blob: string;
}
interface LoginBody {
  nick: string;
  auth_material: string;
}

const publicUser = (id: string, nick: string) => ({ id, nick });

export async function authRoutes(app: FastifyInstance): Promise<void> {
  // Salt for client-side KDF. 404 on unknown nick: existence is rate-limited but not secret.
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
      if (!row) return reply.code(404).send({ error: 'kullanıcı bulunamadı' });
      return { kdf_salt: row.kdf_salt };
    },
  );

  app.post(
    '/auth/register',
    { config: { rateLimit: { max: config.registerRatePerHour, timeWindow: '1 hour' } }, schema: { body: registerSchema } },
    async (req, reply) => {
      const body = req.body as RegisterBody;
      try {
        const verifier = await argon2.hash(body.auth_material);
        const id = crypto.randomUUID();
        db.prepare(
          `INSERT INTO users(id, nick, kdf_salt, verifier, public_key, key_blob, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        ).run(id, body.nick, body.kdf_salt, verifier, body.public_key, body.key_blob, Date.now());
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
      const row = db
        .prepare('SELECT id, nick, verifier, public_key, key_blob FROM users WHERE nick = ?')
        .get(body.nick) as
        | { id: string; nick: string; verifier: string; public_key: string; key_blob: string }
        | undefined;
      if (!row) return reply.code(401).send({ error: 'nick veya şifre hatalı' });
      const ok = await argon2.verify(row.verifier, body.auth_material).catch(() => false);
      if (!ok) return reply.code(401).send({ error: 'nick veya şifre hatalı' });
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
      .prepare('SELECT id, nick, public_key, key_blob FROM users WHERE id = ?')
      .get(req.user.id) as { id: string; nick: string; public_key: string; key_blob: string };
    return { user: { ...publicUser(row.id, row.nick), public_key: row.public_key, key_blob: row.key_blob } };
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
}
