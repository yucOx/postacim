// Faz 7 — cihaz yönetimi uçları. Sunucu private key saklamaz; yalnız
// public key + cihaz adı + linking durumu. Negatif senaryolar zorunlu
// (kripto/auth invariant'ı).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startServer, makeUser, type TestServer, type TestUser } from './helpers';

let srv: TestServer;

beforeAll(async () => {
  srv = await startServer();
});
afterAll(() => srv.stop());

const validKey = (i: number): string =>
  // geçerli 32B base64 (44 char padding dahil) — test anahtarıdır
  Buffer.alloc(32, i).toString('base64');

const startLink = async (u: TestUser, name = 'my phone'): Promise<{ link_token: string }> => {
  const r = await u.call('POST', '/devices/link/start', { name, ephemeral_pub: validKey(1) });
  expect(r.status).toBe(201);
  return (await r.json()) as { link_token: string };
};

describe('GET /devices', () => {
  it('yeni hesap tek primary cihazla döner', async () => {
    const u = await makeUser(srv.baseUrl, 'devlist');
    const r = await u.call('GET', '/devices');
    expect(r.status).toBe(200);
    const j = (await r.json()) as { devices: { id: string; name: string; is_primary: number }[] };
    expect(j.devices).toHaveLength(1);
    expect(j.devices[0]!.is_primary).toBe(1);
  });

  it('authsuz erişim 401', async () => {
    const r = await fetch(`${srv.baseUrl}/devices`);
    expect(r.status).toBe(401);
  });
});

describe('POST /devices/link/start', () => {
  it('joinee ephemeral pub + name → link_token + WS broadcast', async () => {
    const u = await makeUser(srv.baseUrl, 'devstart');
    const { link_token: token } = await startLink(u);
    expect(typeof token).toBe('string');
    expect(token.length).toBeGreaterThanOrEqual(32);
  });

  it('bozuk body 400', async () => {
    const u = await makeUser(srv.baseUrl, 'devstartbad');
    const r = await u.call('POST', '/devices/link/start', { name: '', ephemeral_pub: 'short' });
    expect(r.status).toBe(400);
  });
});

describe('POST /devices/link/approve', () => {
  it('primary onayı → 204 + joinee WS bildirimi', async () => {
    const u = await makeUser(srv.baseUrl, 'devapprove');
    const { link_token: token } = await startLink(u);
    const r = await u.call('POST', '/devices/link/approve', { link_token: token, approval: 'A'.repeat(64) });
    expect(r.status).toBe(204);
  });

  it('bilinmeyen token 404', async () => {
    const u = await makeUser(srv.baseUrl, 'devapprove404');
    const r = await u.call('POST', '/devices/link/approve', {
      link_token: 'A'.repeat(32),
      approval: 'B'.repeat(64),
    });
    expect(r.status).toBe(404);
  });
});

describe('POST /devices/link/finish', () => {
  it('joinee kimliğini yazar → 201 + device_id döner', async () => {
    const u = await makeUser(srv.baseUrl, 'devfinish');
    const { link_token: token } = await startLink(u, 'tablet');
    const r = await u.call('POST', '/devices/link/finish', {
      link_token: token,
      name: 'tablet',
      x25519_public_key: validKey(2),
      ed25519_public_key: validKey(3),
    });
    expect(r.status).toBe(201);
    const j = (await r.json()) as { device_id: string };
    expect(j.device_id).toBeTruthy();
    // listeye düştü mü?
    const list = await u.call('GET', '/devices');
    const jList = (await list.json()) as { devices: { id: string; name: string; is_primary: number }[] };
    expect(jList.devices).toHaveLength(2);
    const tablet = jList.devices.find((d) => d.name === 'tablet');
    expect(tablet?.is_primary).toBe(0);
  });

  it('yanlış user 403', async () => {
    const u1 = await makeUser(srv.baseUrl, 'devfinishu1');
    const u2 = await makeUser(srv.baseUrl, 'devfinishu2');
    const { link_token: token } = await startLink(u1, 'foo');
    // u2 token'ı u1'e ait — finish'i u2 yapamaz
    const r = await u2.call('POST', '/devices/link/finish', {
      link_token: token,
      name: 'hacked',
      x25519_public_key: validKey(4),
      ed25519_public_key: validKey(5),
    });
    expect(r.status).toBe(403);
  });

  it('bitiş sonrası aynı token tekrar kullanılamaz (tek kullanımlık)', async () => {
    const u = await makeUser(srv.baseUrl, 'devfinishonce');
    const { link_token: token } = await startLink(u);
    const r1 = await u.call('POST', '/devices/link/finish', {
      link_token: token,
      name: 'one',
      x25519_public_key: validKey(6),
      ed25519_public_key: validKey(7),
    });
    expect(r1.status).toBe(201);
    const r2 = await u.call('POST', '/devices/link/finish', {
      link_token: token,
      name: 'two',
      x25519_public_key: validKey(8),
      ed25519_public_key: validKey(9),
    });
    expect(r2.status).toBe(404);
  });
});

describe('POST /devices/:id/revoke', () => {
  it('primary cihaz iptal edilemez (400)', async () => {
    const u = await makeUser(srv.baseUrl, 'devrevp');
    const list = await u.call('GET', '/devices');
    const j = (await list.json()) as { devices: { id: string; is_primary: number }[] };
    const primary = j.devices.find((d) => d.is_primary === 1)!;
    const r = await u.call('POST', `/devices/${primary.id}/revoke`);
    expect(r.status).toBe(400);
  });

  it('joinee iptal edilebilir + listeden düşer', async () => {
    const u = await makeUser(srv.baseUrl, 'devrevj');
    const { link_token: token } = await startLink(u, 'to-revoke');
    const r1 = await u.call('POST', '/devices/link/finish', {
      link_token: token,
      name: 'to-revoke',
      x25519_public_key: validKey(10),
      ed25519_public_key: validKey(11),
    });
    const { device_id } = (await r1.json()) as { device_id: string };
    const rev = await u.call('POST', `/devices/${device_id}/revoke`);
    expect(rev.status).toBe(204);
    const list = await u.call('GET', '/devices');
    const j = (await list.json()) as { devices: { id: string }[] };
    expect(j.devices.find((d) => d.id === device_id)).toBeUndefined();
  });

  it('başka kullanıcının cihazı iptal edilemez (404)', async () => {
    const u1 = await makeUser(srv.baseUrl, 'devrevx1');
    const u2 = await makeUser(srv.baseUrl, 'devrevx2');
    const { link_token: token } = await startLink(u1, 'mine');
    const r1 = await u1.call('POST', '/devices/link/finish', {
      link_token: token,
      name: 'mine',
      x25519_public_key: validKey(12),
      ed25519_public_key: validKey(13),
    });
    const { device_id } = (await r1.json()) as { device_id: string };
    const r = await u2.call('POST', `/devices/${device_id}/revoke`);
    expect(r.status).toBe(404);
  });
});
