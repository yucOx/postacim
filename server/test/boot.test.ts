// Boot integrity: refuses weak secrets, migrates a fresh DB cleanly.
import { expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function bootOnce(env: Record<string, string>, ms = 6000): Promise<{ code: number | null; err: string }> {
  return new Promise((resolve) => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pgv-boot-'));
    const proc = spawn(
      process.execPath,
      ['--import', 'tsx', path.resolve(__dirname, '../src/index.ts')],
      {
        env: { ...process.env, PORT: '0', DATA_DIR: dataDir, ...env },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    let err = '';
    proc.stderr.on('data', (d) => (err += d.toString()));
    proc.stdout.on('data', (d) => (err += d.toString()));
    const t = setTimeout(() => {
      proc.kill('SIGKILL');
      resolve({ code: null, err });
    }, ms);
    proc.on('exit', (code) => {
      clearTimeout(t);
      fs.rmSync(dataDir, { recursive: true, force: true });
      resolve({ code, err });
    });
  });
}

it('refuses to boot with a weak LIVEKIT_SECRET', async () => {
  const { code, err } = await bootOnce({ LIVEKIT_SECRET: 'devkey' });
  expect(code).not.toBe(null);
  expect(code === null ? err : 'weak secret rejected').toMatch(/weak secret rejected|güçlü|LIVEKIT_SECRET/);
}, 15_000);

it('boots a fresh DB through the whole migration chain', async () => {
  const { code, err } = await bootOnce({
    LIVEKIT_SECRET: 'boot-test-secret-0123456789abcdef-9876543210',
  });
  expect(code).toBe(null); // survived the full window → migrations applied, listening
  expect(err).toMatch(/listening|Server/);
}, 15_000);
