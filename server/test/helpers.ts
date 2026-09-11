// Ephemeral black-box server for integration suites: child process on a
// random port with a throwaway DB. Each test file calls startServer() once.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface TestServer {
  baseUrl: string;
  stop: () => Promise<void>;
}

const STRONG_SECRET = 'vitest-secret-0123456789abcdef-vitest-secret-98765';

export async function startServer(
  opts: { env?: Record<string, string>; onLog?: (line: string) => void } = {},
): Promise<TestServer> {
  const port = 20_000 + Math.floor(Math.random() * 20_000);
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pgv-test-'));
  const proc = spawn(
    process.execPath,
    ['--import', 'tsx', path.resolve(__dirname, '../src/index.ts')],
    {
      env: {
        ...process.env,
        PORT: String(port),
        DATA_DIR: dataDir,
        LIVEKIT_SECRET: STRONG_SECRET,
        LIVEKIT_API_KEY: 'testkey',
        REGISTER_RATE_PER_HOUR: '5000',
        ...opts.env,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  let bootErr = '';
  proc.stderr.on('data', (d) => {
    bootErr += d.toString();
    opts.onLog?.(d.toString());
  });
  proc.stdout.on('data', (d) => {
    opts.onLog?.(d.toString());
  });
  const baseUrl = `http://127.0.0.1:${port}/api`;
  for (let i = 0; i < 100; i++) {
    try {
      const r = await fetch(`${baseUrl}/health`);
      if (r.ok) break;
    } catch {
      if (proc.exitCode !== null) throw new Error(`server died at boot:\n${bootErr}`);
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  return {
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
}

/** register a user with real client-side crypto; returns an api caller bound
 *  to a unique spoofed IP (rate-limit buckets are per-IP) */
export async function makeUser(baseUrl: string, nickPrefix: string) {
  const { b64 } = await import('../../web/src/crypto/bytes');
  const { deriveKeys, newKdfSaltHex } = await import('../../web/src/crypto/argon2');
  const { generateIdentity, sealIdentityBlob } = await import('../../web/src/crypto/identity');
  const { sodiumReady } = await import('../../web/src/crypto/sodium');
  await sodiumReady;

  const nick = nickPrefix + Math.floor(Math.random() * 1e9).toString(36);
  const password = 'pw-' + nick;
  const salt = newKdfSaltHex();
  const { authMaterial, kek } = await deriveKeys(password, salt);
  const id = generateIdentity();
  const ip = `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
  const r = await fetch(`${baseUrl}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify({
      nick,
      kdf_salt: salt,
      auth_material: b64(authMaterial),
      public_key: b64(id.publicKey),
      key_blob: sealIdentityBlob(id.privateKey, kek),
    }),
  });
  if (r.status !== 201) throw new Error(`register ${nick}: ${r.status}`);
  const json = (await r.json()) as { token: string; user: { id: string; nick: string } };
  return {
    nick,
    password,
    salt,
    id,
    ip,
    token: json.token,
    userId: json.user.id,
    call: (method: string, p: string, body?: unknown, xff?: string) =>
      fetch(baseUrl + p, {
        method,
        headers: {
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          Authorization: `Bearer ${json.token}`,
          'x-forwarded-for': xff ?? ip,
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      }),
  };
}

export type TestUser = Awaited<ReturnType<typeof makeUser>>;
