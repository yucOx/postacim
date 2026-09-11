// Account deletion: one transaction wipes identity, authored messages, DMs
// and owned communities; gdm creator role transfers. Other users untouched.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startServer, makeUser, type TestServer, type TestUser } from './helpers';

let srv: TestServer;
let alice: TestUser, bob: TestUser;

const NONCE = 'A'.repeat(32);
const CT = 'Q'.repeat(24);
const W = (c: string): string => c.repeat(48);

interface Channel {
  id: string;
  name: string;
  type: 'text' | 'voice';
  key_version: number;
}

async function friend(a: TestUser, b: TestUser): Promise<void> {
  expect((await a.call('POST', '/friends/requests', { nick: b.nick })).status).toBe(204);
  expect((await b.call('POST', `/friends/requests/${a.userId}/accept`, {})).status).toBe(204);
}

async function createCommunity(u: TestUser, name: string): Promise<{ id: string; channels: Channel[] }> {
  const r = await u.call('POST', '/communities', {
    name,
    channels: [{ name: 'genel', type: 'text', wrapped_key: 'T'.repeat(48) }],
  });
  if (r.status !== 201) throw new Error(`createCommunity: ${r.status} ${await r.text()}`);
  const j = (await r.json()) as { community: { id: string }; channels: Channel[] };
  return { id: j.community.id, channels: j.channels };
}

beforeAll(async () => {
  srv = await startServer();
  alice = await makeUser(srv.baseUrl, 'da');
  bob = await makeUser(srv.baseUrl, 'db');
  await friend(alice, bob);
});

afterAll(() => srv.stop());

describe('DELETE /users/me', () => {
  it('setup: both sides leave data behind', async () => {
    // bob's community + his own message — must survive alice's deletion
    const bc = await createCommunity(bob, 'bob-com');
    await bob.call('POST', `/channels/${bc.channels[0]!.id}/messages`, {
      key_version: 1,
      nonce: NONCE,
      ciphertext: CT,
    });
    expect((await bob.call('POST', `/communities/${bc.id}/members`, {
      user_id: alice.userId,
      wrapped_keys: [{ channel_id: bc.channels[0]!.id, wrapped_key: 'A'.repeat(48) }],
    })).status).toBe(204);
    // alice's message inside bob's community
    expect(
      (await alice.call('POST', `/channels/${bc.channels[0]!.id}/messages`, {
        key_version: 1,
        nonce: NONCE,
        ciphertext: CT,
      })).status,
    ).toBe(201);
    // alice's own community
    await alice.call('POST', '/communities', {
      name: 'alice-com',
      channels: [{ name: 'genel', type: 'text', wrapped_key: 'T'.repeat(48) }],
    });
    // gdm created by alice with bob; alice sends a message
    const gdm = await alice.call('POST', '/gdms', {
      name: 'ikili',
      member_ids: [bob.userId],
      wrapped_keys: [
        { user_id: alice.userId, wrapped_key: W('A') },
        { user_id: bob.userId, wrapped_key: W('B') },
      ],
    });
    expect(gdm.status).toBe(201);
    const gdmId = ((await gdm.json()) as { channel: { id: string } }).channel.id;
    expect(
      (await alice.call('POST', `/gdms/${gdmId}/messages`, { key_version: 1, nonce: NONCE, ciphertext: CT })).status,
    ).toBe(201);
    // dm alice ↔ bob with an authored message
    const dm = await alice.call('POST', '/dms', {
      user_id: bob.userId,
      wrapped_keys: [
        { user_id: alice.userId, wrapped_key: W('A') },
        { user_id: bob.userId, wrapped_key: W('B') },
      ],
    });
    expect(dm.status).toBe(201);
    const dmId = ((await dm.json()) as { channel: { id: string } }).channel.id;
    expect(
      (await alice.call('POST', `/dms/${dmId}/messages`, { key_version: 1, nonce: NONCE, ciphertext: CT })).status,
    ).toBe(201);
  });

  it('wipes the account + authored data; creator role transfers; bob untouched', async () => {
    expect((await alice.call('DELETE', '/users/me')).status).toBe(200);
    // identity + sessions gone
    expect((await alice.call('GET', '/auth/me')).status).toBe(401);
    // bob's community survives; alice's community does not; alice's message
    // rows are gone from bob's channel history
    const boot = (await (await bob.call('GET', '/bootstrap')).json()) as {
      communities: { name: string; channels: Channel[] }[];
    };
    expect(boot.communities.some((c) => c.name === 'alice-com')).toBe(false);
    const bobCom = boot.communities.find((c) => c.name === 'bob-com')!;
    expect(bobCom).toBeTruthy();
    const hist = (await (await bob.call('GET', `/channels/${bobCom.channels[0]!.id}/messages`)).json()) as {
      messages: { sender_id: string }[];
    };
    expect(hist.messages.every((m) => m.sender_id === bob.userId)).toBe(true);
    expect(hist.messages.length).toBe(1);
    // dm channel deleted for both sides
    const dms = (await (await bob.call('GET', '/dms')).json()) as { dms: unknown[] };
    expect(dms.dms).toHaveLength(0);
    // gdm survives; creator role handed to bob; alice no longer a member
    const gdms = (await (await bob.call('GET', '/gdms')).json()) as {
      gdms: { creator_id: string; members: { id: string }[] }[];
    };
    expect(gdms.gdms).toHaveLength(1);
    expect(gdms.gdms[0]!.creator_id).toBe(bob.userId);
    expect(gdms.gdms[0]!.members.some((m) => m.id === alice.userId)).toBe(false);
  });
});