// Sertleştirme denetimi doğrulamaları: log hijyeni (query/nick ve istemci
// IP'si log'a düşmez), WS auth zaman aşımı, login brute-force geri çekilmesi.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startServer, makeUser, type TestServer, type TestUser } from './helpers';
import { b64 } from '../../web/src/crypto/bytes';
import { deriveKeys } from '../../web/src/crypto/argon2';

let srv: TestServer;
let bob: TestUser;
const logs: string[] = [];

beforeAll(async () => {
  srv = await startServer({
    // cezasız krediyi küçült: backoff testi rate-limit'e (5/dk) takılmadan
    // tetiklenebilsin
    env: { LOGIN_FAIL_FREE: '3' },
    onLog: (chunk) => logs.push(chunk),
  });
  bob = await makeUser(srv.baseUrl, 'hd');
});
afterAll(() => srv.stop());

describe('log hijyeni', () => {
  it('istek logu yolu yazar; query (nick) ve istemci IP\'si düşmez', async () => {
    const r = await fetch(`${srv.baseUrl}/auth/kdf-params?nick=${bob.nick}`, {
      headers: { 'x-forwarded-for': '10.60.0.1' },
    });
    expect(r.status).toBe(200);
    await new Promise((res) => setTimeout(res, 500)); // pino satırın yazılmasını bekle
    const all = logs.join('\n');
    expect(all).toContain('/auth/kdf-params'); // yol yazılır — log gerçekten akıyor
    expect(all).not.toContain(bob.nick); // query'deki nick yazılmaz
    expect(all).not.toContain('10.60.0.1'); // istemci IP'si yazılmaz
  });
});

describe('WS auth zaman aşımı', () => {
  it('auth frame göndermeyen soket ~10 sn içinde 4004 ile kesilir', async () => {
    const { WebSocket } = await import('ws');
    const wsUrl = srv.baseUrl.replace('/api', '').replace(/^http/, 'ws') + '/ws';
    const ws = new WebSocket(wsUrl); // hiç auth frame yok
    const code = await new Promise<number>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('close gelmedi')), 15_000);
      ws.on('close', (c) => {
        clearTimeout(t);
        resolve(c);
      });
      ws.on('error', reject);
    });
    expect(code).toBe(4004);
  }, 20_000);
});

describe('login brute-force geri çekilmesi', () => {
  it('cezasız kredi aşılınca blok; doğru parola bile 429, blok IP başınadır', async () => {
    const ip = '10.60.1.1';
    const wrong = await deriveKeys('yanlis', bob.salt);
    const badLogin = () =>
      fetch(`${srv.baseUrl}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-forwarded-for': ip },
        body: JSON.stringify({ nick: bob.nick, auth_material: b64(wrong.authMaterial) }),
      });
    // LOGIN_FAIL_FREE=3: dördüncü hata krediyi aşar → blok konur
    for (let i = 0; i < 4; i++) expect((await badLogin()).status).toBe(401);
    const { authMaterial } = await deriveKeys(bob.password, bob.salt);
    const good = await fetch(`${srv.baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': ip },
      body: JSON.stringify({ nick: bob.nick, auth_material: b64(authMaterial) }),
    });
    expect(good.status).toBe(429); // blok, doğru parolayı da reddeder
    const elsewhere = await fetch(`${srv.baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '10.60.1.2' },
      body: JSON.stringify({ nick: bob.nick, auth_material: b64(authMaterial) }),
    });
    expect(elsewhere.status).toBe(200); // başka IP'nin kovası temiz
  });
});