// keys/log/head — bant dışı checkpoint ucu: public (oturumsuz), yalnız
// hash/sayı; istemci + CI (keylog-checkpoint.yml) buradan okur.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startServer, makeUser, type TestServer } from './helpers';

let srv: TestServer;

beforeAll(async () => {
  srv = await startServer();
  // defter boş başlayabilir — checkpoint ucu her durumda tutarlı olmalı;
  // en az bir kayıt için bir kullanıcı
  await makeUser(srv.baseUrl, 'kh0');
});
afterAll(() => srv.stop());

describe('GET /api/keys/log/head', () => {
  it('oturumsuz erişilebilir (checkpoint kanalı public)', async () => {
    const r = await fetch(`${srv.baseUrl}/keys/log/head`);
    expect(r.status).toBe(200);
    const body = (await r.json()) as { head: { id: number; entry_hash: string } | null; count: number };
    expect(body.count).toBeGreaterThanOrEqual(1);
    expect(body.head).not.toBeNull();
    expect(body.head!.entry_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('head, defterin son satırıyla aynı; count satır sayısıyla aynı', async () => {
    // kayıt ol — deftere yeni satır düşer
    await makeUser(srv.baseUrl, 'kh');
    const head = (await (await fetch(`${srv.baseUrl}/keys/log/head`)).json()) as {
      head: { id: number; entry_hash: string };
      count: number;
    };
    const log = (await (await fetch(`${srv.baseUrl}/keys/log?limit=500`)).json()) as {
      entries: { id: number; entry_hash: string }[];
    };
    const last = log.entries[log.entries.length - 1]!;
    expect(log.entries.length).toBe(head.count);
    expect(last.id).toBe(head.head.id);
    expect(last.entry_hash).toBe(head.head.entry_hash);
  });
});
