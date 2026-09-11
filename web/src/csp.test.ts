// CSP must stay compatible with the app's runtime crypto: hash-wasm (Argon2id)
// and libsodium compile WASM in the browser, so script-src needs
// 'wasm-unsafe-eval'. This test pins that regression — a plain-nginx prod
// header check once missed it and killed every login.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const confDir = join(__dirname, '..'); // web/

function cspDirective(conf: string, name: string): string | undefined {
  // comments mention directive names too ("connect-src pinned to 'self'") —
  // only real directive lines (no leading #) may match
  const cleaned = conf
    .split('\n')
    .filter((line) => !line.trim().startsWith('#'))
    .join('\n');
  const m = cleaned.match(new RegExp(`${name}[^;]*`, 'i'));
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

  // Turnstile is optional at runtime (only when VITE_TURNSTILE_SITEKEY is set)
  // but the header must already allow it in both deployments: api.js (script),
  // the challenge iframe (frame-src) and the token fetch (connect-src)
  it.each(files)('%s: Turnstile origins whitelisted for script/connect/frame', (f) => {
    const conf = readFileSync(join(confDir, f), 'utf8');
    expect(cspDirective(conf, 'script-src')).toContain('https://challenges.cloudflare.com');
    expect(cspDirective(conf, 'connect-src')).toContain('https://challenges.cloudflare.com');
    expect(cspDirective(conf, 'frame-src')).toContain('https://challenges.cloudflare.com');
    // 'self' stays pinned ahead of the Turnstile origin — no third-party creep
    expect(cspDirective(conf, 'connect-src')).toMatch(/^connect-src 'self'/);
    expect(cspDirective(conf, 'frame-src')!.trim()).toBe('frame-src https://challenges.cloudflare.com');
  });

  it('nginx.conf does NOT send HSTS over plain HTTP (TLS conf does)', () => {
    const plain = readFileSync(join(confDir, 'nginx.conf'), 'utf8');
    const tls = readFileSync(join(confDir, 'nginx-tls.conf'), 'utf8');
    expect(plain).not.toMatch(/strict-transport-security/i);
    expect(tls).toMatch(/strict-transport-security/i);
  });
});
