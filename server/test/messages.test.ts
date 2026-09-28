// Message surface: history pagination cursor, per-user (not per-IP) rate
// bucket on send, and rotate roster validation.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startServer, makeUser, inviteJoin, type TestServer, type TestUser } from './helpers';

let srv: TestServer;
let owner: TestUser;
let member: TestUser;
let comId: string;
let chId: string;

const CT = 'Q'.repeat(24);
const NONCE = 'N'.repeat(32);

beforeAll(async () => {
  srv = await startServer();
  owner = await makeUser(srv.baseUrl, 'mo');
  member = await makeUser(srv.baseUrl, 'mm');
  const r = await owner.call('POST', '/communities', {
    name: 'mesaj-test',
    channels: [{ name: 'genel', type: 'text', wrapped_key: 'T'.repeat(48) }],
  });
  expect(r.status).toBe(201);
  const j = (await r.json()) as { community: { id: string }; channels: { id: string }[] };
  comId = j.community.id;
  chId = j.channels[0]!.id;
  expect(
    await inviteJoin(owner, member, comId, [{ channel_id: chId, wrapped_key: 'A'.repeat(48) }]),
  ).toBe(204);
});
afterAll(() => srv.stop());

async function send(u: TestUser, n = 1): Promise<number> {
  let last = 0;
  for (let i = 0; i < n; i++) {
    const r = await u.call('POST', `/channels/${chId}/messages`, {
      key_version: 1,
      nonce: NONCE,
      ciphertext: CT,
    });
    last = r.status;
    if (r.status !== 201) return last;
  }
  return last;
}

describe('history pagination', () => {
  it('pages backwards by id cursor: ordered, no dupes, covers all rows', async () => {
    expect(await send(owner, 10)).toBe(201);
    const seen: number[] = [];
    let before: number | undefined;
    for (let page = 0; page < 20; page++) {
      const r = await owner.call(
        'GET',
        `/channels/${chId}/messages?limit=4${before ? `&before=${before}` : ''}`,
      );
      expect(r.status).toBe(200);
      const j = (await r.json()) as { messages: { id: number }[]; has_more: boolean };
      const ids = j.messages.map((m) => m.id);
      // pages come oldest-first within themselves; every id must be below the cursor
      ids.forEach((id) => expect(id).toBeLessThan(before ?? Number.MAX_SAFE_INTEGER));
      seen.push(...ids);
      if (!j.has_more) break;
      before = j.messages[0]!.id; // oldest of the page = next cursor
    }
    expect(new Set(seen).size).toBe(seen.length); // no duplicates across pages
    expect(seen.length).toBeGreaterThanOrEqual(10);
  });

  it('rejects a non-numeric cursor without 500', async () => {
    const r = await owner.call('GET', `/channels/${chId}/messages?before=abc`);
    expect([200, 400]).toContain(r.status);
  });
});

describe('per-user send rate bucket', () => {
  it('a heavy user hits 429 while another user on the same IP stays green', async () => {
    // both users share one spoofed IP — the bucket must key on the token, not the IP
    const sharedIp = '10.44.44.44';
    let ownerStatus = 201;
    for (let i = 0; i < 70 && ownerStatus === 201; i++) {
      const r = await owner.call(
        'POST',
        `/channels/${chId}/messages`,
        { key_version: 1, nonce: NONCE, ciphertext: CT },
        sharedIp,
      );
      ownerStatus = r.status;
    }
    expect(ownerStatus).toBe(429); // 60/min limit hit by owner alone
    // member, same IP, own bucket → still allowed
    const r2 = await member.call(
      'POST',
      `/channels/${chId}/messages`,
      { key_version: 1, nonce: NONCE, ciphertext: CT },
      sharedIp,
    );
    expect(r2.status).toBe(201);
  });
});

describe('client replay binding', () => {
  const CID = '123e4567-e89b-41d3-a456-426614174000';
  const AT = 1_700_000_000_000;
  it('stores and echoes client_id + sent_at_client through the list endpoint', async () => {
    const r = await member.call('POST', `/channels/${chId}/messages`, {
      key_version: 1,
      nonce: NONCE,
      ciphertext: CT,
      client_id: CID,
      sent_at_client: AT,
    });
    expect(r.status).toBe(201);
    const g = await member.call('GET', `/channels/${chId}/messages?limit=50`);
    const j = (await g.json()) as {
      messages: { client_id: string | null; sent_at_client: number | null }[];
    };
    const mine = j.messages.find((m) => m.client_id === CID);
    expect(mine?.sent_at_client).toBe(AT);
  });
  it('rejects a half-specified binding with 400', async () => {
    const onlyId = await member.call('POST', `/channels/${chId}/messages`, {
      key_version: 1,
      nonce: NONCE,
      ciphertext: CT,
      client_id: CID,
    });
    expect(onlyId.status).toBe(400);
    const onlyAt = await member.call('POST', `/channels/${chId}/messages`, {
      key_version: 1,
      nonce: NONCE,
      ciphertext: CT,
      sent_at_client: AT,
    });
    expect(onlyAt.status).toBe(400);
  });
  it('rejects a malformed client_id', async () => {
    const r = await member.call('POST', `/channels/${chId}/messages`, {
      key_version: 1,
      nonce: NONCE,
      ciphertext: CT,
      client_id: 'not-a-uuid',
      sent_at_client: AT,
    });
    expect(r.status).toBe(400);
  });
});

describe('rotate roster validation', () => {
  it('rejects a roster that misses a member or includes a stranger', async () => {
    const stranger = await makeUser(srv.baseUrl, 'ms');
    // missing member (member not covered)
    const miss = await owner.call('POST', `/channels/${chId}/rotate`, {
      wrapped_keys: [{ user_id: owner.userId, wrapped_key: 'R'.repeat(48) }],
    });
    expect(miss.status).toBe(400);
    // stranger included
    const extra = await owner.call('POST', `/channels/${chId}/rotate`, {
      wrapped_keys: [
        { user_id: owner.userId, wrapped_key: 'R'.repeat(48) },
        { user_id: member.userId, wrapped_key: 'R'.repeat(48) },
        { user_id: stranger.userId, wrapped_key: 'R'.repeat(48) },
      ],
    });
    expect(extra.status).toBe(400);
  });

  it('exact roster succeeds and bumps the epoch', async () => {
    const ok = await owner.call('POST', `/channels/${chId}/rotate`, {
      wrapped_keys: [
        { user_id: owner.userId, wrapped_key: 'R'.repeat(48) },
        { user_id: member.userId, wrapped_key: 'R'.repeat(48) },
      ],
    });
    expect(ok.status).toBe(204);
    const boot = await member.call('GET', '/bootstrap');
    const j = (await boot.json()) as {
      communities: { channels: { id: string; key_version: number; needs_rekey: boolean }[] }[];
    };
    const ch = j.communities[0]!.channels.find((c) => c.id === chId)!;
    expect(ch.key_version).toBe(2);
    expect(ch.needs_rekey).toBe(false);
  });
});

// --- message deletion (tombstone) ---
// The rotate suite above bumped the channel epoch to 2 — every post here uses it.
const KV = 2;
const W = (c: string): string => c.repeat(48);

async function wsCollect(token: string): Promise<{
  ws: import('ws').WebSocket;
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
  return { ws, events, close: () => ws.close() };
}

async function post(u: TestUser): Promise<{ id: number }> {
  const r = await u.call('POST', `/channels/${chId}/messages`, {
    key_version: KV,
    nonce: NONCE,
    ciphertext: CT,
  });
  expect(r.status).toBe(201);
  return (await r.json()) as { id: number };
}

describe('message deletion (tombstone)', () => {
  it('sender deletes → peer gets WS message:deleted and the GET row is wiped', async () => {
    const listener = await wsCollect(owner.token);
    const { id } = await post(member);
    const del = await member.call('DELETE', `/messages/ch/${chId}/${id}`);
    expect(del.status).toBe(200);
    await new Promise((r) => setTimeout(r, 300));
    expect(listener.events).toContainEqual({
      type: 'message:deleted',
      channel_id: chId,
      id,
    });
    listener.close();
    const g = await owner.call('GET', `/channels/${chId}/messages?limit=50`);
    const row = ((await g.json()) as { messages: { id: number; deleted: number; nonce: string | null; ciphertext: string | null }[] })
      .messages.find((m) => m.id === id);
    expect(row?.deleted).toBe(1);
    expect(row?.nonce).toBeNull();
    expect(row?.ciphertext).toBeNull();
    // idempotent: second delete of the same row stays 200
    const again = await member.call('DELETE', `/messages/ch/${chId}/${id}`);
    expect(again.status).toBe(200);
  });

  it('admin deletes another user\'s message; plain member gets 403 on someone else\'s', async () => {
    const admin = await makeUser(srv.baseUrl, 'md');
    expect(
      await inviteJoin(owner, admin, comId, [{ channel_id: chId, wrapped_key: 'A'.repeat(48) }]),
    ).toBe(204);
    expect((await owner.call('POST', `/communities/${comId}/admins`, { user_id: admin.userId })).status).toBe(204);

    const theirs = await post(member);
    expect((await admin.call('DELETE', `/messages/ch/${chId}/${theirs.id}`)).status).toBe(200);

    const adminMsg = await post(admin);
    expect((await member.call('DELETE', `/messages/ch/${chId}/${adminMsg.id}`)).status).toBe(403);
  });

  it('unknown id and unknown scope return 404', async () => {
    expect((await owner.call('DELETE', `/messages/ch/${chId}/999999999`)).status).toBe(404);
    // member, not owner — owner's send bucket is spent by the rate-limit suite above
    const { id } = await post(member);
    expect((await owner.call('DELETE', `/messages/xx/${chId}/${id}`)).status).toBe(404);
  });
});

describe('DM + GDM deletion', () => {
  it('only the DM sender can tombstone; recipient gets 403; unknown DM id 404s', async () => {
    const alice = await makeUser(srv.baseUrl, 'da');
    const bob = await makeUser(srv.baseUrl, 'db');
    expect((await alice.call('POST', '/friends/requests', { nick: bob.nick })).status).toBe(204);
    expect((await bob.call('POST', `/friends/requests/${alice.userId}/accept`, {})).status).toBe(204);
    const open = await alice.call('POST', '/dms', {
      user_id: bob.userId,
      wrapped_keys: [
        { user_id: alice.userId, wrapped_key: W('A') },
        { user_id: bob.userId, wrapped_key: W('B') },
      ],
    });
    expect(open.status).toBe(201);
    const dmId = ((await open.json()) as { channel: { id: string } }).channel.id;
    const sent = await alice.call('POST', `/dms/${dmId}/messages`, {
      key_version: 1,
      nonce: NONCE,
      ciphertext: CT,
    });
    expect(sent.status).toBe(201);
    const msgId = ((await sent.json()) as { id: number }).id;

    // bob is a participant but NOT the sender — tombstoning for everyone is
    // the sender's call; the recipient hides for themselves locally instead
    expect((await bob.call('DELETE', `/messages/dm/${dmId}/${msgId}`)).status).toBe(403);
    const stillThere = (await (await bob.call('GET', `/dms/${dmId}/messages`)).json()) as {
      messages: { id: number; deleted: number; nonce: string; ciphertext: string }[];
    };
    expect(stillThere.messages.find((m) => m.id === msgId)?.ciphertext).toBe(CT);
    // the sender can delete for everyone
    expect((await alice.call('DELETE', `/messages/dm/${dmId}/${msgId}`)).status).toBe(200);
    const hist = (await (await bob.call('GET', `/dms/${dmId}/messages`)).json()) as {
      messages: { id: number; deleted: number; nonce: string | null; ciphertext: string | null }[];
    };
    const row = hist.messages.find((m) => m.id === msgId);
    expect(row?.deleted).toBe(1);
    expect(row?.ciphertext).toBeNull();

    expect((await alice.call('DELETE', `/messages/dm/dm_nope/${msgId}`)).status).toBe(404);
  });

  it('gdm creator can tombstone a member\'s message', async () => {
    const ga = await makeUser(srv.baseUrl, 'ga');
    const gb = await makeUser(srv.baseUrl, 'gb');
    expect((await ga.call('POST', '/friends/requests', { nick: gb.nick })).status).toBe(204);
    expect((await gb.call('POST', `/friends/requests/${ga.userId}/accept`, {})).status).toBe(204);
    const create = await ga.call('POST', '/gdms', {
      name: 'sil-test',
      member_ids: [gb.userId],
      wrapped_keys: [
        { user_id: ga.userId, wrapped_key: W('G') },
        { user_id: gb.userId, wrapped_key: W('H') },
      ],
    });
    expect(create.status).toBe(201);
    const gid = ((await create.json()) as { channel: { id: string } }).channel.id;
    const sent = await gb.call('POST', `/gdms/${gid}/messages`, {
      key_version: 1,
      nonce: NONCE,
      ciphertext: CT,
    });
    expect(sent.status).toBe(201);
    const msgId = ((await sent.json()) as { id: number }).id;
    expect((await ga.call('DELETE', `/messages/gdm/${gid}/${msgId}`)).status).toBe(200);
    const hist = (await (await gb.call('GET', `/gdms/${gid}/messages`)).json()) as {
      messages: { id: number; deleted: number }[];
    };
    expect(hist.messages.find((m) => m.id === msgId)?.deleted).toBe(1);
  });
});
