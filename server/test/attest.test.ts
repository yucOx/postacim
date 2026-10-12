// voice:attest — medya gönderen atfı relay'i: oturum zorunlu, boyut/üye
// doğrulaması, topluluk kanalında broadcast + DM'de peer'a iletim.
// İçerik opak (sunucu doğrulamaz — dh_update kalıbı); imza alıcıda doğrulanır.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startServer, makeUser, type TestServer, type TestUser } from './helpers';

let srv: TestServer;
let alice: TestUser, bob: TestUser, mallory: TestUser;
let voiceCh = '';
let textCh = '';
let dmId = '';

const W = (c: string): string => c.repeat(48);

async function friend(a: TestUser, b: TestUser): Promise<void> {
  expect((await a.call('POST', '/friends/requests', { nick: b.nick })).status).toBe(204);
  expect((await b.call('POST', `/friends/requests/${a.userId}/accept`, {})).status).toBe(204);
}

async function wsCollect(token: string): Promise<{
  events: { type: string;[k: string]: unknown }[];
  close: () => void;
}> {
  const { WebSocket } = await import('ws');
  const ws = new WebSocket(srv.baseUrl.replace('/api', '').replace(/^http/, 'ws') + '/ws', {
    headers: { Authorization: `Bearer ${token}` },
  });
  const events: { type: string;[k: string]: unknown }[] = [];
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
  return { events, close: () => ws.close() };
}

beforeAll(async () => {
  srv = await startServer();
  alice = await makeUser(srv.baseUrl, 'ta');
  bob = await makeUser(srv.baseUrl, 'tb');
  mallory = await makeUser(srv.baseUrl, 'tm');
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
  const comm = await alice.call('POST', '/communities', {
    name: 'attest-test',
    channels: [
      { name: 'genel', type: 'text', wrapped_key: 'T'.repeat(48) },
      { name: 'sesli', type: 'voice', wrapped_key: 'V'.repeat(48) },
    ],
  });
  expect(comm.status).toBe(201);
  const j = (await comm.json()) as { channels: { id: string; type: string }[] };
  textCh = j.channels.find((c) => c.type === 'text')!.id;
  voiceCh = j.channels.find((c) => c.type === 'voice')!.id;
});
afterAll(() => srv.stop());

const attestBody = (channelId: string, over: Record<string, unknown> = {}) => ({
  channel_id: channelId,
  identity: 'u1',
  payload: '{"room":"r","identity":"u1","ts":1}',
  signature: 'ab'.repeat(64),
  ...over,
});

describe('POST /api/voice/attest', () => {
  it('oturumsuz 401', async () => {
    const r = await fetch(`${srv.baseUrl}/voice/attest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(attestBody(voiceCh)),
    });
    expect(r.status).toBe(401);
  });

  it('eksik alan 400; büyük payload 413', async () => {
    expect((await alice.call('POST', '/voice/attest', attestBody(voiceCh, { signature: '' }))).status).toBe(400);
    expect(
      (await alice.call('POST', '/voice/attest', attestBody(voiceCh, { payload: 'p'.repeat(513) }))).status,
    ).toBe(413);
  });

  it('yazı kanalına duyuru 400', async () => {
    expect((await alice.call('POST', '/voice/attest', attestBody(textCh))).status).toBe(400);
  });

  it('üye olunan ilişki olmayan kanal 404', async () => {
    expect((await mallory.call('POST', '/voice/attest', attestBody(dmId))).status).toBe(404);
  });

  it('topluluk sesli kanalında duyuru broadcast edilir', async () => {
    const ws = await wsCollect(alice.token);
    try {
      const r = await alice.call('POST', '/voice/attest', attestBody(voiceCh, { identity: alice.userId }));
      expect(r.status).toBe(204);
      await new Promise((res) => setTimeout(res, 400));
      const ev = ws.events.find((e) => e.type === 'voice:attest');
      expect(ev).toBeDefined();
      expect(ev!.channel_id).toBe(voiceCh);
      expect(ev!.user_id).toBe(alice.userId);
    } finally {
      ws.close();
    }
  });

  it('DM duyurusu peer\'a gider', async () => {
    const bws = await wsCollect(bob.token);
    try {
      const r = await alice.call('POST', '/voice/attest', attestBody(dmId, { identity: alice.userId }));
      expect(r.status).toBe(204);
      await new Promise((res) => setTimeout(res, 400));
      const ev = bws.events.find((e) => e.type === 'voice:attest');
      expect(ev).toBeDefined();
      expect(ev!.user_id).toBe(alice.userId);
      expect(ev!.channel_id).toBe(dmId);
    } finally {
      bws.close();
    }
  });
});
