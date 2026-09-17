// Faz 5c — WS dh_update opak relay: kanal/gdm/dm kitlesi, sığ payload sınırı,
// üye olmayan reddi, plaintext invariant (sunucu saklamaz — hardening deseni).
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startServer, makeUser, type TestServer, type TestUser } from './helpers';

let srv: TestServer;
let owner: TestUser;
let member: TestUser;
let outsider: TestUser;
let comId: string;
let chId: string;

beforeAll(async () => {
  srv = await startServer();
  owner = await makeUser(srv.baseUrl, 'do');
  member = await makeUser(srv.baseUrl, 'dm');
  outsider = await makeUser(srv.baseUrl, 'dx');
  const r = await owner.call('POST', '/communities', {
    name: 'relay-test',
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
const updatesOf = (events: Ev[]): Ev[] => events.filter((e) => e.type === 'dh_update');

describe('dh_update relay — topluluk kanalı', () => {
  it('üye duyurusu kanal kitlesine aynen iletilir, üye olmayan hiçbir şey almaz', async () => {
    const sender = await wsCollect(member.token);
    const listener = await wsCollect(owner.token);
    const listenerOut = await wsCollect(outsider.token);

    const { encodeDhUpdatePayload, ingestDhUpdate } = await import('../../web/src/lib/dhupdate');
    const { generateSignIdentity } = await import('../../web/src/crypto/identity');
    const { newDhEphemeral } = await import('../../web/src/crypto/dhratchet');
    const sign = generateSignIdentity();
    const payload = encodeDhUpdatePayload(chId, 1, newDhEphemeral().publicKey, sign.signPrivateKey);

    sender.send({ type: 'dh_update', channel_id: chId, payload });
    await settle();

    const got = updatesOf(listener.events);
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({ channel_id: chId, payload, from: member.userId });
    expect(updatesOf(listenerOut.events)).toHaveLength(0);
    // Faz 5d — uçtan uca: relay edilen frame alıcıda doğrulanır ve pin düşer
    expect(ingestDhUpdate(member.userId, chId, got[0]!.payload as string, [sign.signPublicKey])).toBe('ok');
    sender.close();
    listener.close();
    listenerOut.close();
  });

  it('relay bozuk duyuruyu da geçirir (opak) — alıcı doğrulaması bad-signature ile reddeder', async () => {
    const sender = await wsCollect(member.token);
    const listener = await wsCollect(owner.token);
    const { encodeDhUpdatePayload, ingestDhUpdate } = await import('../../web/src/lib/dhupdate');
    const { b64, unb64 } = await import('../../web/src/crypto/bytes');
    const { generateSignIdentity } = await import('../../web/src/crypto/identity');
    const { newDhEphemeral } = await import('../../web/src/crypto/dhratchet');
    const sign = generateSignIdentity();
    const raw = unb64(encodeDhUpdatePayload(chId, 1, newDhEphemeral().publicKey, sign.signPrivateKey));
    raw[10] ^= 1; // kanon gövdesinde tek bayt — imza düşer, boyut/b64 korunur
    const payload = b64(raw);
    sender.send({ type: 'dh_update', channel_id: chId, payload });
    await settle();
    const got = updatesOf(listener.events);
    expect(got).toHaveLength(1);
    expect(got[0]!.payload).toBe(payload); // sunucu yargılamaz — aynen geçer
    // alıcı tarafı: imza doğrulaması düşer → SecurityStore bandı bunu tetikler
    expect(ingestDhUpdate(member.userId, chId, got[0]!.payload as string, [sign.signPublicKey])).toBe('bad-signature');
    sender.close();
    listener.close();
  });

  it('sığ sınır: b64 olmayan / 512 üstü payload relay edilmez', async () => {
    const sender = await wsCollect(member.token);
    const listener = await wsCollect(owner.token);
    sender.send({ type: 'dh_update', channel_id: chId, payload: '!!!@gecersiz' });
    sender.send({ type: 'dh_update', channel_id: chId, payload: 'A'.repeat(513) });
    await settle();
    expect(updatesOf(listener.events)).toHaveLength(0);
    sender.close();
    listener.close();
  });

  it('üye olmayan gönderen relay edilmez; bilinmeyen kanal sessiz düşer', async () => {
    const senderOut = await wsCollect(outsider.token);
    const sender = await wsCollect(member.token);
    const listener = await wsCollect(owner.token);
    const { encodeDhUpdatePayload } = await import('../../web/src/lib/dhupdate');
    const { generateSignIdentity } = await import('../../web/src/crypto/identity');
    const payload = encodeDhUpdatePayload(chId, 1, new Uint8Array(32), generateSignIdentity().signPrivateKey);
    senderOut.send({ type: 'dh_update', channel_id: chId, payload });
    sender.send({ type: 'dh_update', channel_id: 'ch_yok', payload });
    await settle();
    expect(updatesOf(listener.events)).toHaveLength(0);
    senderOut.close();
    sender.close();
    listener.close();
  });

  it('plaintext invariant: relay saklanmaz — mesaj tablosunda satır oluşmaz', async () => {
    const Database = (await import('better-sqlite3')).default;
    const db = new Database(path.join(srv.dataDir, 'posta.db'));
    const n = db.prepare('SELECT COUNT(*) AS n FROM messages WHERE channel_id = ?').get(chId) as { n: number };
    expect(n.n).toBe(0);
    const t = db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name LIKE '%dh_update%'").get() as { n: number };
    expect(t.n).toBe(0); // relay için tablo bile yok — payload yalnız geçer
    db.close();
  });
});

describe('dh_update relay — gdm/dm kitlesi', () => {
  let alice: TestUser;
  let bob: TestUser;
  let gdmId: string;
  let dmId: string;

  beforeAll(async () => {
    alice = await makeUser(srv.baseUrl, 'ga');
    bob = await makeUser(srv.baseUrl, 'gb');
    expect((await alice.call('POST', '/friends/requests', { nick: bob.nick })).status).toBe(204);
    expect((await bob.call('POST', `/friends/requests/${alice.userId}/accept`, {})).status).toBe(204);
    const W = (c: string): string => c.repeat(48);
    const g = await alice.call('POST', '/gdms', {
      name: 'rekey-grup',
      member_ids: [bob.userId],
      wrapped_keys: [
        { user_id: alice.userId, wrapped_key: W('A') },
        { user_id: bob.userId, wrapped_key: W('B') },
      ],
    });
    expect(g.status).toBe(201);
    gdmId = ((await g.json()) as { channel: { id: string } }).channel.id;
    const d = await alice.call('POST', '/dms', {
      user_id: bob.userId,
      wrapped_keys: [
        { user_id: alice.userId, wrapped_key: W('A') },
        { user_id: bob.userId, wrapped_key: W('B') },
      ],
    });
    expect(d.status).toBe(201);
    dmId = ((await d.json()) as { channel: { id: string } }).channel.id;
  });

  it('gdm duyurusu üyelerine gider, dışarıya çıkmaz', async () => {
    const sender = await wsCollect(alice.token);
    const peer = await wsCollect(bob.token);
    const out = await wsCollect(outsider.token);
    const { encodeDhUpdatePayload } = await import('../../web/src/lib/dhupdate');
    const { generateSignIdentity } = await import('../../web/src/crypto/identity');
    const payload = encodeDhUpdatePayload(gdmId, 2, new Uint8Array(32), generateSignIdentity().signPrivateKey);
    sender.send({ type: 'dh_update', channel_id: gdmId, payload });
    await settle();
    const got = updatesOf(peer.events);
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({ channel_id: gdmId, payload, from: alice.userId });
    expect(updatesOf(out.events)).toHaveLength(0);
    // gdm dışına relay: kanal duyurusu gdm dinleyicisine ulaşmaz
    const chPayload = encodeDhUpdatePayload(chId, 1, new Uint8Array(32), generateSignIdentity().signPrivateKey);
    const before = updatesOf(peer.events).length;
    sender.send({ type: 'dh_update', channel_id: chId, payload: chPayload });
    await settle();
    expect(updatesOf(peer.events)).toHaveLength(before); // bob topluluk üyesi değil
    sender.close();
    peer.close();
    out.close();
  });

  it('dm duyurusu yalnız karşı tarafa gider', async () => {
    const sender = await wsCollect(alice.token);
    const peer = await wsCollect(bob.token);
    const out = await wsCollect(outsider.token);
    const { encodeDhUpdatePayload } = await import('../../web/src/lib/dhupdate');
    const { generateSignIdentity } = await import('../../web/src/crypto/identity');
    const payload = encodeDhUpdatePayload(dmId, 1, new Uint8Array(32), generateSignIdentity().signPrivateKey);
    sender.send({ type: 'dh_update', channel_id: dmId, payload });
    await settle();
    const got = updatesOf(peer.events);
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({ channel_id: dmId, payload, from: alice.userId });
    expect(updatesOf(out.events)).toHaveLength(0);
    sender.close();
    peer.close();
    out.close();
  });
});
