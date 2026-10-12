// Dummy trafik (noise): oturum zorunluluğu, biçim/boyut reddi ve hız
// sınırı — içerik asla doğrulanmaz, saklanmaz.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startServer, makeUser, type TestServer } from './helpers';

let srv: TestServer;

beforeAll(async () => {
  srv = await startServer();
});
afterAll(() => srv.stop());

describe('noise', () => {
  it('oturumsuz POST 401 döner', async () => {
    const r = await fetch(`${srv.baseUrl}/noise`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ b: 'QUJDRA==' }), // "ABCD"
    });
    expect(r.status).toBe(401);
  });

  it('oturumla geçerli blob 204 döner, gövde boş', async () => {
    const u = await makeUser(srv.baseUrl, 'nz');
    const r = await u.call('POST', '/noise', { b: Buffer.from('anlamsiz').toString('base64') });
    expect(r.status).toBe(204);
    expect(await r.text()).toBe('');
  });

  it('8193+ byte blob 400 döner', async () => {
    const u = await makeUser(srv.baseUrl, 'nl');
    const big = Buffer.alloc(8193, 7).toString('base64');
    expect(Buffer.from(big, 'base64').length).toBe(8193);
    expect((await u.call('POST', '/noise', { b: big })).status).toBe(400);
  });

  it('yanlış base64 / eksik b alanı 400 döner', async () => {
    const u = await makeUser(srv.baseUrl, 'nb');
    expect((await u.call('POST', '/noise', { b: 'bu-base64-degil!!' })).status).toBe(400);
    expect((await u.call('POST', '/noise', {})).status).toBe(400);
  });

  it('hız sınırı 60/dk — 61. istek 429', async () => {
    // taze kullanıcı: kova oturum token'ına göre, önceki testler sayılmasın
    const u = await makeUser(srv.baseUrl, 'nq');
    const b = Buffer.alloc(32, 1).toString('base64');
    for (let i = 1; i <= 65; i++) {
      const r = await u.call('POST', '/noise', { b });
      expect(r.status).toBe(i <= 60 ? 204 : 429);
    }
  });
});
