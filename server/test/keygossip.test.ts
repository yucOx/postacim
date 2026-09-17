// Faz 6 — WS keylog_head opak relay: üye duyurusu topluluk kitleye gider,
// üye olmayan almaz, sığ sınır dışı düşer, payload saklanmaz (hardening
// deseni: plaintext invariant — server için tablo bile yok).
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startServer, makeUser, type TestServer, type TestUser } from './helpers';

let srv: TestServer;
let owner: TestUser;
let member: TestUser;
let outsider: TestUser;
let comId: string;
let chId: string;
const HASH = 'a'.repeat(64);
const OTHER_HASH = 'b'.repeat(64);

beforeAll(async () => {
  srv = await startServer();
  owner = await makeUser(srv.baseUrl, 'go');
  member = await makeUser(srv.baseUrl, 'gm');
  outsider = await makeUser(srv.baseUrl, 'gx');
  const r = await owner.call('POST', '/communities', {
    name: 'gossip-test',
    channels: [{ name: 'genel', type: 'text', wrapped_key: 'T'.repeat(48) }],
  });
  expect(r.status).toBe(201);
  const j = (await r.json()) as { community: { id: string }; channels: { id: string }[] };
  comId = j.community.id;
  chId = j.channels[0]!.id;
  const add = await owner.call('POST', `/communities/${comId}/members`, {
    user_id: member.userId,
    wrapped_keys: [{ channel_id: chId, wrapped_key: 'A'.repeat(48) }],
  });
  expect(add.status).toBe(204);
});
afterAll(() => srv.stop());

type Ev = { type: string;[k: string]: unknown };

async function wsCollect(token: string) {
  const { WebSocket } = await import('ws');
  const ws = new WebSocket(srv.baseUrl.replace('/api', '').replace(/^http/, 'ws') + '/ws', {
    headers: { Authorization: `Bearer ${token}` },
  });
  const events: Ev[] = [];
  await new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('ws ready timeout')), 5000);
    ws.on('message', (d: { toString(): string }) => {
      const e = JSON.parse(d.toString()) as Ev;
      if (e.type === 'ready') {
        clearTimeout(t);
        resolve();
      }
    });
    ws.on('open', () => ws.send(JSON.stringify({ type: 'auth', token })));
    ws.on('error', reject);
  });
  ws.on('message', (d: { toString(): string }) => {
    events.push(JSON.parse(d.toString()) as Ev);
  });
  return {
    events,
    send: (obj: unknown) => ws.send(JSON.stringify(obj)),
    close: () => ws.close(),
  };
}

const settle = () => new Promise((r) => setTimeout(r, 300));
const headsOf = (events: Ev[]): Ev[] => events.filter((e) => e.type === 'keylog_head');

describe('keylog_head relay — topluluk kitleye', () => {
  it('üye duyurusu üye olan kitleye iletilir, üye olmayan almaz', async () => {
    const sender = await wsCollect(member.token);
    const listener = await wsCollect(owner.token);
    const listenerOut = await wsCollect(outsider.token);
    sender.send({ type: 'keylog_head', id: 42, hash: HASH, communities: [comId] });
    await settle();
    const got = headsOf(listener.events);
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({ type: 'keylog_head', community_id: comId, id: 42, hash: HASH, from: member.userId });
    expect(headsOf(listenerOut.events)).toHaveLength(0);
    sender.close();
    listener.close();
    listenerOut.close();
  });

  it('birden çok topluluk: her birine ayrı ayrı broadcast', async () => {
    // ikinci topluluk — owner üye, member üye DEĞİL
    const r = await owner.call('POST', '/communities', {
      name: 'gossip-test-2',
      channels: [{ name: 'genel', type: 'text', wrapped_key: 'T'.repeat(48) }],
    });
    expect(r.status).toBe(201);
    const j = (await r.json()) as { community: { id: string } };
    const com2 = j.community.id;
    const sender = await wsCollect(member.token);
    const owner2 = await wsCollect(owner.token);
    sender.send({ type: 'keylog_head', id: 100, hash: OTHER_HASH, communities: [comId, com2] });
    await settle();
    // com2'de member üye olmadığından yalnız comId'e gider
    const got = headsOf(owner2.events).filter((e) => e.id === 100);
    expect(got).toHaveLength(1);
    expect(got[0]!.community_id).toBe(comId);
    sender.close();
    owner2.close();
  });

  it('üye olmadığı topluluk adını gönderen sessizce atlanır (relay olmaz)', async () => {
    const sender = await wsCollect(outsider.token);
    const listener = await wsCollect(owner.token);
    sender.send({ type: 'keylog_head', id: 5, hash: HASH, communities: [comId] });
    await settle();
    expect(headsOf(listener.events)).toHaveLength(0);
    sender.close();
    listener.close();
  });
});

describe('keylog_head — sığ sınır (hardening)', () => {
  it('hash 64 hex değilse düşer', async () => {
    const sender = await wsCollect(member.token);
    const listener = await wsCollect(owner.token);
    sender.send({ type: 'keylog_head', id: 1, hash: 'X'.repeat(64), communities: [comId] });
    sender.send({ type: 'keylog_head', id: 1, hash: 'a'.repeat(63), communities: [comId] });
    sender.send({ type: 'keylog_head', id: 1, hash: 'A'.repeat(64), communities: [comId] });
    await settle();
    expect(headsOf(listener.events)).toHaveLength(0);
    sender.close();
    listener.close();
  });

  it('id pozitif 32-bit değilse düşer', async () => {
    const sender = await wsCollect(member.token);
    const listener = await wsCollect(owner.token);
    sender.send({ type: 'keylog_head', id: 0, hash: HASH, communities: [comId] });
    sender.send({ type: 'keylog_head', id: -1, hash: HASH, communities: [comId] });
    sender.send({ type: 'keylog_head', id: 0x80000000, hash: HASH, communities: [comId] });
    await settle();
    expect(headsOf(listener.events)).toHaveLength(0);
    sender.close();
    listener.close();
  });

  it('communities > 64 düşer, string dışı eleman düşer', async () => {
    const sender = await wsCollect(member.token);
    const listener = await wsCollect(owner.token);
    sender.send({ type: 'keylog_head', id: 1, hash: HASH, communities: Array.from({ length: 65 }, () => 'x') });
    sender.send({ type: 'keylog_head', id: 1, hash: HASH, communities: [comId, 42 as unknown as string] });
    await settle();
    expect(headsOf(listener.events)).toHaveLength(0);
    sender.close();
    listener.close();
  });

  it('plaintext invariant: relay saklanmaz — keylog_head için tablo yok', async () => {
    const Database = (await import('better-sqlite3')).default;
    const db = new Database(path.join(srv.dataDir, 'posta.db'));
    const t = db
      .prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name LIKE '%keylog_head%' OR name LIKE '%gossip%'")
      .get() as { n: number };
    expect(t.n).toBe(0); // relay için tablo yok — payload yalnız geçer
    db.close();
  });
});
