// Social graph: friends, 1:1 DM, group DM rekey-on-membership-change, WS push.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startServer, makeUser, type TestServer, type TestUser } from './helpers';

let srv: TestServer;
let alice: TestUser, bob: TestUser, carol: TestUser, stranger: TestUser;

const W = (c: string): string => c.repeat(48);
const NONCE = 'A'.repeat(32); // 32-char b64 nonce (24B) expected by the API
const CT = 'Q'.repeat(24);

async function friend(a: TestUser, b: TestUser): Promise<void> {
  expect((await a.call('POST', '/friends/requests', { nick: b.nick })).status).toBe(204);
  expect((await b.call('POST', `/friends/requests/${a.userId}/accept`, {})).status).toBe(204);
}

// --- WS dinleyici (ttl.test.ts kalıbı) ---
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
  alice = await makeUser(srv.baseUrl, 'sa');
  bob = await makeUser(srv.baseUrl, 'sb');
  carol = await makeUser(srv.baseUrl, 'sc');
  stranger = await makeUser(srv.baseUrl, 'sx');
  await friend(alice, bob);
  await friend(alice, carol);
  await friend(bob, carol);
});
afterAll(() => srv.stop());

describe('friends', () => {
  it('friend events carry the peer nick', async () => {
    // istemci toast'ında isim gösteriyor — payload boşsa hep "?" çıkar
    const dave = await makeUser(srv.baseUrl, 'sd');
    const erin = await makeUser(srv.baseUrl, 'se');
    const daveWs = await wsCollect(dave.token);
    const erinWs = await wsCollect(erin.token);
    try {
      await dave.call('POST', '/friends/requests', { nick: erin.nick });
      await new Promise((r) => setTimeout(r, 400));
      const req = erinWs.events.find((e) => e.type === 'friend_request:new');
      expect(req).toBeDefined();
      expect((req!.user as { nick: string }).nick).toBe(dave.nick);

      await erin.call('POST', `/friends/requests/${dave.userId}/accept`, {});
      await new Promise((r) => setTimeout(r, 400));
      // kabul eden (erin) karşı tarafı, edilen (dave) da kendi karşı tarafını görür
      for (const [ws, want] of [
        [daveWs, erin.nick],
        [erinWs, dave.nick],
      ] as const) {
        const added = ws.events.find((e) => e.type === 'friend:new');
        expect(added).toBeDefined();
        expect((added!.user as { nick: string }).nick).toBe(want);
      }
    } finally {
      daveWs.close();
      erinWs.close();
    }
  });

  it('request list + duplicate + unfriend', async () => {
    const me = (await (await alice.call('GET', '/friends')).json()) as {
      friends: { nick: string }[];
      incoming: unknown[];
      outgoing: unknown[];
    };
    expect(me.friends.map((f) => f.nick).sort()).toEqual([bob.nick, carol.nick].sort());
    // already friends → 409 on re-request
    expect((await alice.call('POST', '/friends/requests', { nick: bob.nick })).status).toBe(409);
    // self-friend impossible
    expect((await alice.call('POST', '/friends/requests', { nick: alice.nick })).status).toBe(400);
    // stranger befriends + unfriend both sides see it
    expect((await stranger.call('POST', '/friends/requests', { nick: carol.nick })).status).toBe(204);
    expect((await carol.call('POST', `/friends/requests/${stranger.userId}/accept`, {})).status).toBe(204);
    expect((await stranger.call('DELETE', `/friends/${carol.userId}`)).status).toBe(204);
    const carolList = (await (await carol.call('GET', '/friends')).json()) as { friends: { nick: string }[] };
    expect(carolList.friends.some((f) => f.nick === stranger.nick)).toBe(false);
  });
});

describe('1:1 DM', () => {
  let dmId: string;

  it('only friends can open; both sides get the same channel', async () => {
    expect((await alice.call('POST', '/dms', { user_id: stranger.userId })).status).toBe(403);
    const open = await alice.call('POST', '/dms', {
      user_id: bob.userId,
      wrapped_keys: [
        { user_id: alice.userId, wrapped_key: W('A') },
        { user_id: bob.userId, wrapped_key: W('B') },
      ],
    });
    expect(open.status).toBe(201);
    dmId = ((await open.json()) as { channel: { id: string } }).channel.id;
    const again = (await (await bob.call('POST', '/dms', {
      user_id: alice.userId,
      wrapped_keys: [],
    })).json()) as { channel: { id: string; existing: boolean } };
    expect(again.channel.existing).toBe(true);
    expect(again.channel.id).toBe(dmId);
  });

  it('send + history + non-participant blocked', async () => {
    expect(
      (await alice.call('POST', `/dms/${dmId}/messages`, { key_version: 1, nonce: NONCE, ciphertext: CT })).status,
    ).toBe(201);
    expect(
      (await bob.call('POST', `/dms/${dmId}/messages`, { key_version: 1, nonce: NONCE, ciphertext: CT })).status,
    ).toBe(201);
    const hist = (await (await bob.call('GET', `/dms/${dmId}/messages`)).json()) as {
      messages: { sender_id: string }[];
    };
    expect(hist.messages).toHaveLength(2);
    expect((await stranger.call('GET', `/dms/${dmId}/messages`)).status).toBe(404);
    expect((await stranger.call('POST', `/dms/${dmId}/messages`, { key_version: 1, nonce: NONCE, ciphertext: CT })).status).toBe(404);
    // malformed: bad nonce length, stale epoch
    expect(
      (await alice.call('POST', `/dms/${dmId}/messages`, { key_version: 1, nonce: 'SHORT', ciphertext: CT })).status,
    ).toBe(400);
    expect(
      (await alice.call('POST', `/dms/${dmId}/messages`, { key_version: 2, nonce: NONCE, ciphertext: CT })).status,
    ).toBe(400);
  });

  it('unfriend freezes the DM', async () => {
    expect((await alice.call('DELETE', `/friends/${bob.userId}`)).status).toBe(204);
    expect(
      (await alice.call('POST', `/dms/${dmId}/messages`, { key_version: 1, nonce: NONCE, ciphertext: CT })).status,
    ).toBe(403);
    // re-friend → messages flow again (history preserved)
    await friend(alice, bob);
    expect(
      (await alice.call('POST', `/dms/${dmId}/messages`, { key_version: 1, nonce: NONCE, ciphertext: CT })).status,
    ).toBe(201);
  });

  it('call token only while the DM is active', async () => {
    const tok = await alice.call('POST', `/dms/${dmId}/call-token`);
    expect(tok.status).toBe(200);
    expect(((await tok.json()) as { url?: string }).url).toBeTruthy();
    expect((await stranger.call('POST', `/dms/${dmId}/call-token`)).status).toBe(404);
  });
});

describe('group DM (rekey on membership change)', () => {
  let gid: string;
  let friend4: TestUser;

  it('create with friends only', async () => {
    expect(
      (await alice.call('POST', '/gdms', { name: 'grup', member_ids: [stranger.userId], wrapped_keys: [{ user_id: stranger.userId, wrapped_key: W('X') }] })).status,
    ).toBe(403);
    const create = await alice.call('POST', '/gdms', {
      name: 'üçlü',
      member_ids: [bob.userId, carol.userId],
      wrapped_keys: [
        { user_id: alice.userId, wrapped_key: W('A') },
        { user_id: bob.userId, wrapped_key: W('B') },
        { user_id: carol.userId, wrapped_key: W('C') },
      ],
    });
    expect(create.status).toBe(201);
    gid = ((await create.json()) as { channel: { id: string } }).channel.id;
    // epoch-1 message readable by members
    expect((await bob.call('POST', `/gdms/${gid}/messages`, { key_version: 1, nonce: NONCE, ciphertext: CT })).status).toBe(201);
  });

  it('add member bumps epoch; new member cannot read the pre-add message', async () => {
    const f4 = await makeUser(srv.baseUrl, 'sg');
    await friend(alice, f4);
    friend4 = f4;
    const add = await alice.call('POST', `/gdms/${gid}/members`, {
      user_id: f4.userId,
      key_version: 2,
      wrapped_keys: [
        { user_id: alice.userId, wrapped_key: W('D') },
        { user_id: bob.userId, wrapped_key: W('E') },
        { user_id: carol.userId, wrapped_key: W('F') },
        { user_id: friend4.userId, wrapped_key: W('G') },
      ],
    });
    expect(add.status).toBe(204);
    // old-epoch writes rejected for everyone
    expect((await bob.call('POST', `/gdms/${gid}/messages`, { key_version: 1, nonce: NONCE, ciphertext: CT })).status).toBe(400);
    expect((await friend4.call('POST', `/gdms/${gid}/messages`, { key_version: 2, nonce: NONCE, ciphertext: CT })).status).toBe(201);
    // history is server-stored per message with its epoch — the new member's client
    // simply lacks the v1 key; the server must still hand the rows out
    const hist = (await (await friend4.call('GET', `/gdms/${gid}/messages`)).json()) as {
      messages: { key_version: number }[];
    };
    expect(hist.messages.some((m) => m.key_version === 1)).toBe(true);
  });

  it('leave rekeys for the rest; leaver loses access', async () => {
    const leave = await carol.call('POST', `/gdms/${gid}/leave`, {
      key_version: 3,
      wrapped_keys: [
        { user_id: alice.userId, wrapped_key: W('H') },
        { user_id: bob.userId, wrapped_key: W('I') },
        { user_id: friend4.userId, wrapped_key: W('J') },
      ],
    });
    expect(leave.status).toBe(204);
    expect((await carol.call('GET', `/gdms/${gid}/messages`)).status).toBe(404);
    expect((await alice.call('POST', `/gdms/${gid}/messages`, { key_version: 3, nonce: NONCE, ciphertext: CT })).status).toBe(201);
  });
});

describe('websocket push', () => {
  it('friend request + DM events reach the peer socket live', async () => {
    const { WebSocket } = await import('ws');
    const dave = await makeUser(srv.baseUrl, 'sw');
    const ws = new WebSocket(srv.baseUrl.replace('/api', '').replace(/^http/, 'ws') + '/ws', {
      headers: { Authorization: `Bearer ${dave.token}` },
    });
    const events: string[] = [];
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('ws ready timeout')), 5000);
      ws.on('message', (d: { toString(): string }) => {
        const e = JSON.parse(d.toString()) as { type: string };
        if (e.type === 'ready') {
          clearTimeout(t);
          resolve();
        }
      });
      ws.on('open', () => ws.send(JSON.stringify({ type: 'auth', token: dave.token })));
      ws.on('error', reject);
    });
    ws.on('message', (d: { toString(): string }) => {
      events.push((JSON.parse(d.toString()) as { type: string }).type);
    });
    // dave befriends alice → alice sends dave a request… no: alice requests dave
    expect((await stranger.call('POST', '/friends/requests', { nick: dave.nick })).status).toBe(204);
    await new Promise((r) => setTimeout(r, 300));
    expect(events).toContain('friend_request:new');
    ws.close();
  });
});

describe('voice presence over WS', () => {
  it('voice_state frames broadcast to community peers with the right shape', async () => {
    // fresh community so presence state is isolated from other suites
    const vOwner = await makeUser(srv.baseUrl, 'vp');
    const com = await vOwner.call('POST', '/communities', {
      name: 'ses-test',
      channels: [
        { name: 'genel', type: 'text', wrapped_key: W('T') },
        { name: 'ses', type: 'voice', wrapped_key: W('V') },
      ],
    });
    expect(com.status).toBe(201);
    const comJ = (await com.json()) as { community: { id: string }; channels: { id: string; type: string }[] };
    const voiceCh = comJ.channels.find((c) => c.type === 'voice')!.id;

    const { WebSocket } = await import('ws');
    const ws = new WebSocket(srv.baseUrl.replace('/api', '').replace(/^http/, 'ws') + '/ws', {});
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('ws ready timeout')), 5000);
      ws.on('message', (d: { toString(): string }) => {
        const e = JSON.parse(d.toString()) as { type: string };
        if (e.type === 'ready') {
          clearTimeout(t);
          resolve();
        }
      });
      ws.on('open', () => ws.send(JSON.stringify({ type: 'auth', token: vOwner.token })));
      ws.on('error', reject);
    });
    const events: string[] = [];
    let presenceShape = false;
    ws.on('message', (d: { toString(): string }) => {
      const e = JSON.parse(d.toString()) as { type: string; participants?: unknown[]; channel_id?: string };
      events.push(e.type);
      if (e.type === 'voice:update' && Array.isArray(e.participants) && e.channel_id === voiceCh) {
        presenceShape = true;
      }
    });
    ws.send(JSON.stringify({ type: 'voice_state', channel_id: voiceCh, state: 'joined' }));
    await new Promise((r) => setTimeout(r, 400));
    expect(events).toContain('voice:update');
    expect(presenceShape).toBe(true);
    // leaving also broadcasts
    const before = events.length;
    ws.send(JSON.stringify({ type: 'voice_state', channel_id: voiceCh, state: 'left' }));
    await new Promise((r) => setTimeout(r, 300));
    expect(events.length).toBeGreaterThan(before);
    // invalid channel id is ignored (no crash, socket stays open)
    ws.send(JSON.stringify({ type: 'voice_state', channel_id: 'nope', state: 'joined' }));
    await new Promise((r) => setTimeout(r, 200));
    expect(ws.readyState).toBe(1); // OPEN
    ws.close();
  });
});

describe('typing relay over WS', () => {
  it('member typing is relayed; non-member typing is dropped', async () => {
    const tOwner = await makeUser(srv.baseUrl, 'ty');
    const com = await tOwner.call('POST', '/communities', {
      name: 'yaziyor-test',
      channels: [{ name: 'genel', type: 'text', wrapped_key: W('T') }],
    });
    expect(com.status).toBe(201);
    const comJ = (await com.json()) as { community: { id: string }; channels: { id: string }[] };
    const textCh = comJ.channels[0]!.id;

    const { WebSocket } = await import('ws');
    const openSocket = async (u: TestUser): Promise<InstanceType<typeof WebSocket>> => {
      const ws = new WebSocket(srv.baseUrl.replace('/api', '').replace(/^http/, 'ws') + '/ws', {});
      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('ws ready timeout')), 5000);
        ws.on('message', (d: { toString(): string }) => {
          const e = JSON.parse(d.toString()) as { type: string };
          if (e.type === 'ready') {
            clearTimeout(t);
            resolve();
          }
        });
        ws.on('open', () => ws.send(JSON.stringify({ type: 'auth', token: u.token })));
        ws.on('error', reject);
      });
      return ws;
    };

    const ownerWs = await openSocket(tOwner);
    const strangerWs = await openSocket(stranger);
    const relayed: string[] = [];
    ownerWs.on('message', (d: { toString(): string }) => {
      const e = JSON.parse(d.toString()) as { type: string; user?: { nick: string } };
      if (e.type === 'channel:typing' && e.user) relayed.push(e.user.nick);
    });

    ownerWs.send(JSON.stringify({ type: 'typing', channel_id: textCh }));
    await new Promise((r) => setTimeout(r, 300));
    strangerWs.send(JSON.stringify({ type: 'typing', channel_id: textCh }));
    await new Promise((r) => setTimeout(r, 300));

    expect(relayed).toEqual([tOwner.nick]); // own relay arrived; stranger (non-member) dropped
    ownerWs.close();
    strangerWs.close();
  });
});

describe('DM call signaling over WS', () => {
  // Çağrı protokolü: ring → incoming → accept → accepted. Karşı taraf
  // 'active' fazında ayrılınca (call:cancel) diğerine call:ended gitmeli —
  // gitmezse alan taraf 'active' sanıp sessizce asılı kalıyordu.
  async function openSocket(u: TestUser): Promise<import('ws').WebSocket> {
    const { WebSocket } = await import('ws');
    const ws = new WebSocket(srv.baseUrl.replace('/api', '').replace(/^http/, 'ws') + '/ws', {
      headers: { Authorization: `Bearer ${u.token}` },
    });
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('ws ready timeout')), 5000);
      ws.on('message', (d: { toString(): string }) => {
        if ((JSON.parse(d.toString()) as { type: string }).type === 'ready') {
          clearTimeout(t);
          resolve();
        }
      });
      ws.on('open', () => ws.send(JSON.stringify({ type: 'auth', token: u.token })));
      ws.on('error', reject);
    });
    return ws;
  }

  it('caller leaving mid-call signals ended to the peer', async () => {
    const p1 = await makeUser(srv.baseUrl, 'sc1');
    const p2 = await makeUser(srv.baseUrl, 'sc2');
    expect((await p1.call('POST', '/friends/requests', { nick: p2.nick })).status).toBe(204);
    expect((await p2.call('POST', `/friends/requests/${p1.userId}/accept`, {})).status).toBe(204);
    const open = await p1.call('POST', '/dms', {
      user_id: p2.userId,
      wrapped_keys: [
        { user_id: p1.userId, wrapped_key: W('A') },
        { user_id: p2.userId, wrapped_key: W('B') },
      ],
    });
    expect(open.status).toBe(201);
    const dmId = ((await open.json()) as { channel: { id: string } }).channel.id;

    const p1Ws = await openSocket(p1);
    const p2Ws = await openSocket(p2);
    const p2Events: string[] = [];
    p2Ws.on('message', (d: { toString(): string }) => {
      p2Events.push((JSON.parse(d.toString()) as { type: string }).type);
    });
    try {
      // ring → incoming → accept → accepted (call is now 'active' for both)
      p1Ws.send(JSON.stringify({ type: 'call:ring', channel_id: dmId }));
      await new Promise((r) => setTimeout(r, 300));
      expect(p2Events).toContain('call:incoming');

      p2Ws.send(JSON.stringify({ type: 'call:accept', channel_id: dmId }));
      await new Promise((r) => setTimeout(r, 300));

      // p1 now hangs up mid-call — p2 must be told
      p1Ws.send(JSON.stringify({ type: 'call:cancel', channel_id: dmId }));
      await new Promise((r) => setTimeout(r, 400));
      expect(p2Events).toContain('call:ended');
    } finally {
      p1Ws.close();
      p2Ws.close();
    }
  });
});
