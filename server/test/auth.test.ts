// Auth surface: register/login, per-IP rate buckets, httpOnly cookie session,
// password change session-drops, BIP-39 recovery, weak-secret boot refusal.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startServer, makeUser, type TestServer, type TestUser } from './helpers';
import { b64 } from '../../web/src/crypto/bytes';
import { deriveKeys, newKdfSaltHex } from '../../web/src/crypto/argon2';
import { generateIdentity, openIdentityBlob, sealIdentityBlob } from '../../web/src/crypto/identity';
import { deriveRecoveryKeys } from '../../web/src/crypto/recovery';
import { generateMnemonic } from '../../web/src/crypto/bip39';
import { sodiumReady } from '../../web/src/crypto/sodium';

let srv: TestServer;
let alice: TestUser;

beforeAll(async () => {
  srv = await startServer();
  alice = await makeUser(srv.baseUrl, 'au');
  await sodiumReady;
});
afterAll(() => srv.stop());

describe('register + login', () => {
  it('duplicate nick → 409', async () => {
    const salt = newKdfSaltHex();
    const { authMaterial, kek } = await deriveKeys('x', salt);
    const id = generateIdentity();
    const r = await fetch(`${srv.baseUrl}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '10.30.0.1' },
      body: JSON.stringify({
        nick: alice.nick,
        kdf_salt: salt,
        auth_material: b64(authMaterial),
        public_key: b64(id.publicKey),
        key_blob: sealIdentityBlob(id.privateKey, kek),
      }),
    });
    expect(r.status).toBe(409);
  });

  it('wrong password → 401', async () => {
    const { authMaterial } = await deriveKeys('yanlis', alice.salt);
    const r = await fetch(`${srv.baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '10.30.0.2' },
      body: JSON.stringify({ nick: alice.nick, auth_material: b64(authMaterial) }),
    });
    expect(r.status).toBe(401);
  });

  it('login rate limit is per-IP (X-Forwarded-For honored)', async () => {
    const ip = '10.30.9.9';
    const codes: number[] = [];
    for (let i = 0; i < 6; i++) {
      const r = await fetch(`${srv.baseUrl}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-forwarded-for': ip },
        body: JSON.stringify({ nick: 'yokboyle', auth_material: 'A'.repeat(44) }),
      });
      codes.push(r.status);
    }
    expect(codes.slice(0, 5)).toEqual([401, 401, 401, 401, 401]);
    expect(codes[5]).toBe(429);
    const otherIp = await fetch(`${srv.baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '10.30.8.8' },
      body: JSON.stringify({ nick: 'yokboyle', auth_material: 'A'.repeat(44) }),
    });
    expect(otherIp.status).toBe(401); // own bucket, not the global one
  });
});

describe('httpOnly cookie session', () => {
  it('login sets HttpOnly+SameSite=Strict cookie that authorizes requests', async () => {
    const { authMaterial } = await deriveKeys(alice.password, alice.salt);
    const r = await fetch(`${srv.baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '10.30.1.1' },
      body: JSON.stringify({ nick: alice.nick, auth_material: b64(authMaterial) }),
    });
    expect(r.status).toBe(200);
    const setCookie = r.headers.get('set-cookie') ?? '';
    expect(setCookie).toMatch(/pgv_session=/);
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=Strict/i);
    const cookie = /pgv_session=[^;]+/.exec(setCookie)![0];
    const me = await fetch(`${srv.baseUrl}/auth/me`, {
      headers: { cookie, 'x-forwarded-for': '10.30.1.1' },
    });
    expect(me.status).toBe(200);
    const out = await fetch(`${srv.baseUrl}/auth/logout`, {
      method: 'POST',
      headers: { cookie, 'x-forwarded-for': '10.30.1.1' },
    });
    expect(out.status).toBe(204);
    const dead = await fetch(`${srv.baseUrl}/auth/me`, {
      headers: { cookie, 'x-forwarded-for': '10.30.1.1' },
    });
    expect(dead.status).toBe(401);
  });

  it('WS authenticates from the upgrade cookie without a token frame', async () => {
    const { WebSocket } = await import('ws');
    const { authMaterial } = await deriveKeys(alice.password, alice.salt);
    const r = await fetch(`${srv.baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '10.30.1.2' },
      body: JSON.stringify({ nick: alice.nick, auth_material: b64(authMaterial) }),
    });
    const cookie = /pgv_session=[^;]+/.exec(r.headers.get('set-cookie') ?? '')![0];
    const wsUrl = srv.baseUrl.replace('/api', '').replace(/^http/, 'ws') + '/ws';
    const ws = new WebSocket(wsUrl, { headers: { cookie } });
    const first = await new Promise<string>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('ws auth timeout')), 5000);
      ws.on('open', () => ws.send(JSON.stringify({ type: 'auth' })));
      ws.on('message', (d: { toString(): string }) => {
        clearTimeout(t);
        resolve(d.toString());
      });
      ws.on('error', reject);
    });
    expect(JSON.parse(first).type).toBe('ready');
    ws.close();
  });
});

describe('password change', () => {
  it('drops every session; new password works with the same identity', async () => {
    const bob = await makeUser(srv.baseUrl, 'ab');
    const newSalt = newKdfSaltHex();
    const next = await deriveKeys('yeni-sifre-9', newSalt);
    const chg = await bob.call('POST', '/auth/password', {
      old_auth_material: b64((await deriveKeys(bob.password, bob.salt)).authMaterial),
      new_kdf_salt: newSalt,
      new_auth_material: b64(next.authMaterial),
      new_key_blob: sealIdentityBlob(bob.id.privateKey, next.kek),
    });
    expect(chg.status).toBe(204);
    const me = await bob.call('GET', '/auth/me');
    expect(me.status).toBe(401);
    const login = await fetch(`${srv.baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '10.30.2.1' },
      body: JSON.stringify({
        nick: bob.nick,
        auth_material: b64(next.authMaterial),
      }),
    });
    expect(login.status).toBe(200);
    const oldPw = await fetch(`${srv.baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '10.30.2.2' },
      body: JSON.stringify({
        nick: bob.nick,
        auth_material: b64((await deriveKeys(bob.password, bob.salt)).authMaterial),
      }),
    });
    expect(oldPw.status).toBe(401);
  });
});

describe('BIP-39 recovery', () => {
  it('full forgot-password cycle keeps the identity', async () => {
    // register WITH a recovery phrase
    const words = await generateMnemonic();
    const salt = newKdfSaltHex();
    const { authMaterial, kek } = await deriveKeys('pw-asli-1', salt);
    const id = generateIdentity();
    const recSalt = newKdfSaltHex();
    const rec = await deriveRecoveryKeys(words, recSalt);
    const reg = await fetch(`${srv.baseUrl}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '10.30.3.1' },
      body: JSON.stringify({
        nick: 'arc' + Math.floor(Math.random() * 1e9).toString(36),
        kdf_salt: salt,
        auth_material: b64(authMaterial),
        public_key: b64(id.publicKey),
        key_blob: sealIdentityBlob(id.privateKey, kek),
        recovery: {
          kdf_salt: recSalt,
          auth_material: b64(rec.authMaterial),
          blob: sealIdentityBlob(id.privateKey, rec.kek),
        },
      }),
    });
    expect(reg.status).toBe(201);
    const regJson = (await reg.json()) as { token: string; user: { nick: string } };
    const oldToken = regJson.token;
    const nickFinal = regJson.user.nick;

    // params visible only when set
    const p = await fetch(`${srv.baseUrl}/auth/recovery-params?nick=${nickFinal}`, {
      headers: { 'x-forwarded-for': '10.30.3.2' },
    });
    expect(p.status).toBe(200);

    // wrong phrase → 401
    const wrong = await deriveRecoveryKeys(await generateMnemonic(), recSalt);
    const bad = await fetch(`${srv.baseUrl}/auth/recover/unlock`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '10.30.3.3' },
      body: JSON.stringify({ nick: nickFinal, recovery_auth_material: b64(wrong.authMaterial) }),
    });
    expect(bad.status).toBe(401);

    // unlock with the true phrase → blob decrypts to the same private key
    const unlock = await fetch(`${srv.baseUrl}/auth/recover/unlock`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '10.30.3.4' },
      body: JSON.stringify({ nick: nickFinal, recovery_auth_material: b64(rec.authMaterial) }),
    });
    expect(unlock.status).toBe(200);
    const { recovery_blob: blob, public_key: pub } = (await unlock.json()) as {
      recovery_blob: string;
      public_key: string;
    };
    expect(pub).toBe(b64(id.publicKey));
    const priv = openIdentityBlob(blob, rec.kek);
    expect(b64(priv)).toBe(b64(id.privateKey));

    // finish with a new password → session issued, old ones dead
    const newSalt = newKdfSaltHex();
    const next = await deriveKeys('sifirlanmis-2', newSalt);
    const fin = await fetch(`${srv.baseUrl}/auth/recover/finish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '10.30.3.5' },
      body: JSON.stringify({
        nick: nickFinal,
        recovery_auth_material: b64(rec.authMaterial),
        new_kdf_salt: newSalt,
        new_auth_material: b64(next.authMaterial),
        new_key_blob: sealIdentityBlob(priv, next.kek),
      }),
    });
    expect(fin.status).toBe(200);
    expect((fin.headers.get('set-cookie') ?? '')).toMatch(/pgv_session=/);

    const old = await fetch(`${srv.baseUrl}/auth/me`, {
      headers: { Authorization: `Bearer ${oldToken}`, 'x-forwarded-for': '10.30.3.6' },
    });
    expect(old.status).toBe(401);

    const relog = await fetch(`${srv.baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '10.30.3.7' },
      body: JSON.stringify({ nick: nickFinal, auth_material: b64(next.authMaterial) }),
    });
    expect(relog.status).toBe(200);
    const relogJson = (await relog.json()) as { user: { public_key: string } };
    expect(relogJson.user.public_key).toBe(b64(id.publicKey));
  });

  it('recovery-params returns a pseudo-salt for accounts without a phrase; verify fails uniformly', async () => {
    const r = await fetch(`${srv.baseUrl}/auth/recovery-params?nick=${alice.nick}`, {
      headers: { 'x-forwarded-for': '10.30.4.1' },
    });
    expect(r.status).toBe(200);
    const { recovery_salt } = (await r.json()) as { recovery_salt: string };
    expect(recovery_salt).toMatch(/^[0-9a-f]{32}$/);
  });

  it('nick enumeration: unknown nick ≡ wrong password ≡ no-phrase, byte for byte', async () => {
    const ip = '10.31.9.';
    const login = async (nick: string): Promise<{ status: number; body: string }> => {
      const r = await fetch(`${srv.baseUrl}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-forwarded-for': `${ip}1` },
        body: JSON.stringify({ nick, auth_material: b64(new Uint8Array(32)) }),
      });
      return { status: r.status, body: JSON.stringify(await r.json()) };
    };
    const kdfSalt = async (nick: string): Promise<number> => {
      const r = await fetch(`${srv.baseUrl}/auth/kdf-params?nick=${encodeURIComponent(nick)}`, {
        headers: { 'x-forwarded-for': `${ip}2` },
      });
      return r.status;
    };
    // wrong password on a real account and unknown nick: identical status + body
    const real = await login(alice.nick);
    const ghost = await login('yokboylebirnick' + Math.floor(Math.random() * 1e6));
    expect(ghost.status).toBe(real.status);
    expect(ghost.body).toBe(real.body);
    // kdf-params never 404s on shape-valid nicks, real or not
    expect(await kdfSalt(alice.nick)).toBe(200);
    expect(await kdfSalt('yokboylebirnick' + Math.floor(Math.random() * 1e6))).toBe(200);
    // recovery: unknown nick and no-phrase account fail with the same body
    const rec = async (nick: string): Promise<{ status: number; body: string }> => {
      const r = await fetch(`${srv.baseUrl}/auth/recover/unlock`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-forwarded-for': `${ip}3` },
        body: JSON.stringify({ nick, recovery_auth_material: b64(new Uint8Array(32)) }),
      });
      return { status: r.status, body: JSON.stringify(await r.json()) };
    };
    const noPhrase = await rec(alice.nick);
    const unknown = await rec('yokboylebirnick' + Math.floor(Math.random() * 1e6));
    expect(unknown.status).toBe(noPhrase.status);
    expect(unknown.body).toBe(noPhrase.body);
  });

  it('late setup attaches a phrase to a logged-in account', async () => {
    const words = await generateMnemonic();
    const recSalt = newKdfSaltHex();
    const rec = await deriveRecoveryKeys(words, recSalt);
    const setup = await alice.call('POST', '/auth/recovery', {
      kdf_salt: recSalt,
      auth_material: b64(rec.authMaterial),
      blob: sealIdentityBlob(alice.id.privateKey, rec.kek),
    });
    expect(setup.status).toBe(204);
    const p = await fetch(`${srv.baseUrl}/auth/recovery-params?nick=${alice.nick}`, {
      headers: { 'x-forwarded-for': '10.30.5.1' },
    });
    expect(p.status).toBe(200);
  });
});

describe('cookie hardening details', () => {
  it('Secure flag flips on when the proxy reports https', async () => {
    const salt = newKdfSaltHex();
    const { authMaterial, kek } = await deriveKeys('pw-secure-1', salt);
    const id = generateIdentity();
    const r = await fetch(`${srv.baseUrl}/auth/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-forwarded-for': '10.30.6.1',
        'x-forwarded-proto': 'https',
      },
      body: JSON.stringify({
        nick: 'sec' + Math.floor(Math.random() * 1e9).toString(36),
        kdf_salt: salt,
        auth_material: b64(authMaterial),
        public_key: b64(id.publicKey),
        key_blob: sealIdentityBlob(id.privateKey, kek),
      }),
    });
    const sc = r.headers.get('set-cookie') ?? '';
    expect(/HttpOnly/i.test(sc)).toBe(true);
    expect(/SameSite=Strict/i.test(sc)).toBe(true);
    expect(/Secure/i.test(sc)).toBe(true); // only behind TLS
  });

  it('logout clears the cookie and kills the session server-side', async () => {
    // fresh login to get a cookie
    const { authMaterial } = await deriveKeys(alice.password, alice.salt);
    const r = await fetch(`${srv.baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '10.30.6.2' },
      body: JSON.stringify({ nick: alice.nick, auth_material: b64(authMaterial) }),
    });
    const cookie = /pgv_session=[^;]+/.exec(r.headers.get('set-cookie') ?? '')![0];
    const me1 = await fetch(`${srv.baseUrl}/auth/me`, {
      headers: { cookie, 'x-forwarded-for': '10.30.6.2' },
    });
    expect(me1.status).toBe(200);
    const out = await fetch(`${srv.baseUrl}/auth/logout`, {
      method: 'POST',
      headers: { cookie, 'x-forwarded-for': '10.30.6.2' },
    });
    expect(out.status).toBe(204);
    expect(/pgv_session=;/.test(out.headers.get('set-cookie') ?? '')).toBe(true);
    const me2 = await fetch(`${srv.baseUrl}/auth/me`, {
      headers: { cookie, 'x-forwarded-for': '10.30.6.2' },
    });
    expect(me2.status).toBe(401); // revoked, not just forgotten by the browser
  });
});

describe('turnstile (TURNSTILE_SECRET set)', () => {
  // dedicated black-box server + an offline stand-in for Cloudflare's
  // siteverify: response=good-token → success, anything else → failure.
  // TURNSTILE_VERIFY_URL env (test-only knob) points the server at the mock so
  // the suite never leaves localhost.
  let tsrv: TestServer;
  let mock: Server;
  let lastVerify: URLSearchParams | null = null;

  const regBody = async (nick: string, turnstile_token?: string) => {
    const salt = newKdfSaltHex();
    const { authMaterial, kek } = await deriveKeys('pw-' + nick, salt);
    const id = generateIdentity();
    const body = {
      nick,
      kdf_salt: salt,
      auth_material: b64(authMaterial),
      public_key: b64(id.publicKey),
      key_blob: sealIdentityBlob(id.privateKey, kek),
      ...(turnstile_token === undefined ? {} : { turnstile_token }),
    };
    return { body, salt };
  };

  beforeAll(async () => {
    mock = createServer((req, res) => {
      let body = '';
      req.on('data', (c: Buffer) => {
        body += c.toString();
      });
      req.on('end', () => {
        lastVerify = new URLSearchParams(body);
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ success: lastVerify.get('response') === 'good-token' }));
      });
    });
    await new Promise<void>((resolve) => mock.listen(0, '127.0.0.1', resolve));
    const mockPort = (mock.address() as AddressInfo).port;

    // same boot shape as helpers.startServer, plus the Turnstile env
    const port = 20_000 + Math.floor(Math.random() * 20_000);
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pgv-ts-'));
    const proc = spawn(
      process.execPath,
      ['--import', 'tsx', path.resolve(__dirname, '../src/index.ts')],
      {
        env: {
          ...process.env,
          PORT: String(port),
          DATA_DIR: dataDir,
          LIVEKIT_SECRET: 'vitest-secret-0123456789abcdef-vitest-secret-98765',
          LIVEKIT_API_KEY: 'testkey',
          REGISTER_RATE_PER_HOUR: '5000',
          TURNSTILE_SECRET: 'cf-test-secret',
          TURNSTILE_VERIFY_URL: `http://127.0.0.1:${mockPort}/siteverify`,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    const baseUrl = `http://127.0.0.1:${port}/api`;
    for (let i = 0; i < 100; i++) {
      try {
        const r = await fetch(`${baseUrl}/health`);
        if (r.ok) break;
      } catch {
        if (proc.exitCode !== null) throw new Error('turnstile test server died at boot');
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    tsrv = {
      baseUrl,
      stop: () =>
        new Promise((resolve) => {
          proc.once('exit', () => {
            fs.rmSync(dataDir, { recursive: true, force: true });
            resolve();
          });
          proc.kill('SIGKILL');
        }),
    };
  });

  afterAll(async () => {
    await tsrv.stop();
    await new Promise<void>((resolve) => mock.close(() => resolve()));
  });

  it('register without a token → 400', async () => {
    const { body } = await regBody('tsn' + Math.floor(Math.random() * 1e9).toString(36));
    const r = await fetch(`${tsrv.baseUrl}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '10.40.0.1' },
      body: JSON.stringify(body),
    });
    expect(r.status).toBe(400);
    expect((await r.json() as { error: string }).error).toBe('insan doğrulaması başarısız');
  });

  it('register with a garbage token → 400 (siteverify success:false)', async () => {
    const { body } = await regBody('tsg' + Math.floor(Math.random() * 1e9).toString(36), 'garbage-token');
    const r = await fetch(`${tsrv.baseUrl}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '10.40.0.2' },
      body: JSON.stringify(body),
    });
    expect(r.status).toBe(400);
    expect(lastVerify?.get('response')).toBe('garbage-token'); // verify really ran
  });

  it('register with a valid token → 201; secret/response/remoteip reached siteverify', async () => {
    const ip = '10.40.0.3';
    const { body } = await regBody('tsv' + Math.floor(Math.random() * 1e9).toString(36), 'good-token');
    const r = await fetch(`${tsrv.baseUrl}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': ip },
      body: JSON.stringify(body),
    });
    expect(r.status).toBe(201);
    expect(lastVerify?.get('secret')).toBe('cf-test-secret');
    expect(lastVerify?.get('response')).toBe('good-token');
    expect(lastVerify?.get('remoteip')).toBe(ip); // trustProxy resolves XFF
  });

  it('login gated the same way: no token → 400, valid token → 200', async () => {
    const nick = 'tsl' + Math.floor(Math.random() * 1e9).toString(36);
    const { body, salt } = await regBody(nick, 'good-token');
    const reg = await fetch(`${tsrv.baseUrl}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '10.40.1.1' },
      body: JSON.stringify(body),
    });
    expect(reg.status).toBe(201);
    const { authMaterial } = await deriveKeys('pw-' + nick, salt);
    const login = (turnstile_token?: string) =>
      fetch(`${tsrv.baseUrl}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '10.40.1.2' },
        body: JSON.stringify({
          nick,
          auth_material: b64(authMaterial),
          ...(turnstile_token === undefined ? {} : { turnstile_token }),
        }),
      });
    expect((await login()).status).toBe(400); // no token — gated before the lookup
    expect((await login('stale-token')).status).toBe(400);
    expect((await login('good-token')).status).toBe(200);
  });
});

describe('rolling session refresh (touchSession)', () => {
  it('aged sessions roll to a full TTL; young ones are left untouched', async () => {
    // config reads env at import time — the strong-secret guard would exit the
    // test process otherwise, and DATA_DIR keeps this off the repo's real DB
    process.env.LIVEKIT_SECRET = 'vitest-secret-0123456789abcdef-vitest-secret-98765';
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pgv-touch-'));
    process.env.DATA_DIR = dataDir;
    const { db } = await import('../src/db.js');
    const { config } = await import('../src/config.js');
    const { issueSession, verifySession, touchSession, sha256 } = await import(
      '../src/auth/sessions.js'
    );

    db.prepare(
      'INSERT INTO users(id, nick, kdf_salt, verifier, public_key, key_blob, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run('u-touch', 'touch', 'a'.repeat(32), 'v', 'p', 'k', Date.now());
    const token = issueSession('u-touch');
    const hash = sha256(token);
    const expiresAt = () =>
      (db.prepare('SELECT expires_at AS e FROM sessions WHERE token_hash = ?').get(hash) as { e: number }).e;

    // verifySession surfaces expires_at — the values the request hook feeds back
    const fresh = expiresAt();
    expect(verifySession(token)).toMatchObject({ id: 'u-touch', expires_at: fresh });

    // young session (> half TTL remaining): no write
    touchSession(hash, fresh);
    expect(expiresAt()).toBe(fresh);

    // aged session (< half TTL remaining): rolled forward to ≈ now + TTL
    const aged = Date.now() + 60_000; // one minute left of the TTL
    db.prepare('UPDATE sessions SET expires_at = ? WHERE token_hash = ?').run(aged, hash);
    touchSession(hash, aged);
    const rolled = expiresAt();
    expect(rolled).toBeGreaterThan(Date.now() + config.sessionTtlDays * 86_400_000 - 5_000);

    fs.rmSync(dataDir, { recursive: true, force: true });
  });
});
