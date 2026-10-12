// DM arama presence (dm:voice — Discord "aramada" göstergesi):
//  - odadaki taraf duyuru yapar, peer'a iletilir
//  - bayat yanlış-kanal kapatması yok sayılır
//  - üye olmayan yayınlayamaz
//  - yeni socket (F5) register anlık görüntüsüyle mevcut durumu alır
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startServer, makeUser, type TestServer, type TestUser } from './helpers';

let srv: TestServer;
let alice: TestUser, bob: TestUser, mallory: TestUser;
let dmId: string;

const W = (c: string): string => c.repeat(48);

async function friend(a: TestUser, b: TestUser): Promise<void> {
  expect((await a.call('POST', '/friends/requests', { nick: b.nick })).status).toBe(204);
  expect((await b.call('POST', `/friends/requests/${a.userId}/accept`, {})).status).toBe(204);
}

async function wsCollect(token: string): Promise<{
  events: { type: string; channel_id?: string; in?: boolean; user_id?: string }[];
  send: (o: unknown) => void;
  close: () => void;
}> {
  const { WebSocket } = await import('ws');
  const ws = new WebSocket(srv.baseUrl.replace('/api', '').replace(/^http/, 'ws') + '/ws', {
    headers: { Authorization: `Bearer ${token}` },
  });
  const events: { type: string; channel_id?: string; in?: boolean; user_id?: string }[] = [];
  await new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('ws ready timeout')), 5000);
    ws.on('message', (d: { toString(): string }) => {
      const e = JSON.parse(d.toString()) as { type: string };
      if (e.type === 'ready') {
        clearTimeout(t);
        resolve();
      }
    });
    ws.on('open', () => ws.send(JSON.stringify({ type: 'auth', token })));
    ws.on('error', reject);
  });
  ws.on('message', (d: { toString(): string }) => {
    events.push(JSON.parse(d.toString()) as { type: string });
  });
  return { events, send: (o) => ws.send(JSON.stringify(o)), close: () => ws.close() };
}

beforeAll(async () => {
  srv = await startServer();
  alice = await makeUser(srv.baseUrl, 'va');
  bob = await makeUser(srv.baseUrl, 'vb');
  mallory = await makeUser(srv.baseUrl, 'vm');
  await friend(alice, bob);
  const open = await alice.call('POST', '/dms', {
    user_id: bob.userId,
    wrapped_keys: [
      { user_id: alice.userId, wrapped_key: W('A') },
      { user_id: bob.userId, wrapped_key: W('B') },
    ],
  });
  expect(open.status).toBe(201);
  dmId = ((await open.json()) as { channel: { id: string } }).channel.id;
});
afterAll(() => srv.stop());

describe('dm:voice presence', () => {
  it('odadaki tarafın duyurusu peer\'a gider; kapatınca in=false döner', async () => {
    const a = await wsCollect(alice.token);
    const b = await wsCollect(bob.token);
    try {
      b.send({ type: 'dm:voice', channel_id: dmId, in: true });
      await new Promise((r) => setTimeout(r, 400));
      const on = a.events.find((e) => e.type === 'dm:voice' && e.in === true);
      expect(on).toBeDefined();
      expect(on!.channel_id).toBe(dmId);
      expect(on!.user_id).toBe(bob.userId);

      b.send({ type: 'dm:voice', channel_id: dmId, in: false });
      await new Promise((r) => setTimeout(r, 400));
      const off = a.events.find((e) => e.type === 'dm:voice' && e.in === false);
      expect(off).toBeDefined();
      expect(off!.channel_id).toBe(dmId);
    } finally {
      a.close();
      b.close();
    }
  });

  it('bayat yanlış-kanal kapatması yok sayılır', async () => {
    const a = await wsCollect(alice.token);
    const b = await wsCollect(bob.token);
    try {
      b.send({ type: 'dm:voice', channel_id: dmId, in: true });
      await new Promise((r) => setTimeout(r, 400));
      const before = a.events.length;
      // sonraki bir aramadan kalma sahte kanal — presence'e dokunmamalı
      b.send({ type: 'dm:voice', channel_id: 'olmayan-kanal', in: false });
      await new Promise((r) => setTimeout(r, 400));
      expect(a.events.slice(before).some((e) => e.type === 'dm:voice')).toBe(false);
    } finally {
      a.close();
      b.close();
    }
  });

  it('üye olmayan yayınlayamaz', async () => {
    const a = await wsCollect(alice.token);
    const m = await wsCollect(mallory.token);
    try {
      const before = a.events.length;
      m.send({ type: 'dm:voice', channel_id: dmId, in: true });
      await new Promise((r) => setTimeout(r, 400));
      // (bob'un önceki testten kalan presence'ı register anlık görüntüsüyle
      // gelebilir — bu test yalnız mallory'den gelen olmamalı)
      expect(a.events.slice(before).some((e) => e.type === 'dm:voice' && e.user_id === mallory.userId)).toBe(false);
    } finally {
      a.close();
      m.close();
    }
  });

  it('yeni socket register anlık görüntüsüyle mevcut presence\'ı alır (F5)', async () => {
    const b = await wsCollect(bob.token);
    b.send({ type: 'dm:voice', channel_id: dmId, in: true });
    await new Promise((r) => setTimeout(r, 400));
    // alice sayfayı yeniledi — yeni socket açılışta durumu öğrenmeli
    const a2 = await wsCollect(alice.token);
    try {
      await new Promise((r) => setTimeout(r, 400));
      const snap = a2.events.find((e) => e.type === 'dm:voice' && e.in === true);
      expect(snap).toBeDefined();
      expect(snap!.channel_id).toBe(dmId);
    } finally {
      a2.close();
      b.close();
    }
  });
});
