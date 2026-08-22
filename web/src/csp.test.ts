// CSP must stay compatible with the app's runtime crypto: hash-wasm (Argon2id)
// and libsodium compile WASM in the browser, so script-src needs
// 'wasm-unsafe-eval'. This test pins that regression — a plain-nginx prod
// header check once missed it and killed every login.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const confDir = join(__dirname, '..'); // web/

function cspDirective(conf: string, name: string): string | undefined {
  const m = conf.match(new RegExp(`${name}[^;]*`, 'i'));
  return m?.[0];
}

describe('nginx CSP stays crypto-compatible', () => {
  const files = ['nginx.conf', 'nginx-tls.conf'] as const;

  it.each(files)('%s: script-src allows WASM but not generic eval', (f) => {
    const conf = readFileSync(join(confDir, f), 'utf8');
    const scriptSrc = cspDirective(conf, 'script-src');
    expect(scriptSrc).toBeDefined();
    expect(scriptSrc).toContain("'wasm-unsafe-eval'");
    expect(scriptSrc).not.toMatch(/(^|[^-])'unsafe-eval'/); // narrow source only
  });

  it.each(files)('%s: worker/media keep blob: for SFrame + local tracks', (f) => {
    const conf = readFileSync(join(confDir, f), 'utf8');
    expect(cspDirective(conf, 'worker-src')).toContain('blob:');
    expect(cspDirective(conf, 'media-src')).toContain('blob:');
  });

  it('nginx.conf does NOT send HSTS over plain HTTP (TLS conf does)', () => {
    const plain = readFileSync(join(confDir, 'nginx.conf'), 'utf8');
    const tls = readFileSync(join(confDir, 'nginx-tls.conf'), 'utf8');
    expect(plain).not.toMatch(/strict-transport-security/i);
    expect(tls).toMatch(/strict-transport-security/i);
  });
});
