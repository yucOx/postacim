// Moderation: roles, kick→freeze→rotate cycle, bans, resource caps.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startServer, makeUser, inviteJoin, type TestServer, type TestUser } from './helpers';

let srv: TestServer;
let owner: TestUser, admin: TestUser, member: TestUser, mallory: TestUser;
let communityId: string, textChannel: string, voiceChannel: string;

const NONCE = 'A'.repeat(32); // 32-char b64 nonce expected by the API
const CT = 'Q'.repeat(24);

interface Channel {
  id: string;
  name: string;
  type: 'text' | 'voice';
  key_version: number;
}

async function createCommunity(u: TestUser, name: string): Promise<{ id: string; channels: Channel[] }> {
  const r = await u.call('POST', '/communities', {
    name,
    channels: [
      { name: 'genel', type: 'text', wrapped_key: 'T'.repeat(48) },
      { name: 'sesli', type: 'voice', wrapped_key: 'V'.repeat(48) },
    ],
  });
  if (r.status !== 201) throw new Error(`createCommunity: ${r.status} ${await r.text()}`);
  const j = (await r.json()) as { community: { id: string }; channels: Channel[] };
  return { id: j.community.id, channels: j.channels };
}

async function addMember(staff: TestUser, cid: string, u: TestUser): Promise<number> {
  // consent flow: POST /members creates a targeted invite; u peeks + completes
  return inviteJoin(staff, u, cid, [
    { channel_id: textChannel, wrapped_key: 'A'.repeat(48) },
    { channel_id: voiceChannel, wrapped_key: 'B'.repeat(48) },
  ]);
}

beforeAll(async () => {
  srv = await startServer();
  owner = await makeUser(srv.baseUrl, 'mo');
  admin = await makeUser(srv.baseUrl, 'ma');
  member = await makeUser(srv.baseUrl, 'mm');
  mallory = await makeUser(srv.baseUrl, 'mx');
  const c = await createCommunity(owner, 'test-topluluk');
  communityId = c.id;
  textChannel = c.channels[0]!.id;
  voiceChannel = c.channels[1]!.id;
  expect(await addMember(owner, communityId, admin)).toBe(204);
  // promote admin
  expect((await owner.call('POST', `/communities/${communityId}/admins`, { user_id: admin.userId })).status).toBe(204);
  expect(await addMember(admin, communityId, member)).toBe(204);
  expect(await addMember(admin, communityId, mallory)).toBe(204);
});
afterAll(() => srv.stop());

describe('roles', () => {
  it('member cannot create channels, kick, or invite', async () => {
    expect((await member.call('POST', `/communities/${communityId}/channels`, { name: 'izinsiz', type: 'text' })).status).toBe(403);
    expect((await member.call('DELETE', `/communities/${communityId}/members/${mallory.userId}`)).status).toBe(403);
    expect((await member.call('POST', `/communities/${communityId}/invites`, { wrapped_keys: [] })).status).toBe(403);
  });
  it('admin cannot promote admins or set the join password', async () => {
    expect((await admin.call('POST', `/communities/${communityId}/admins`, { user_id: member.userId })).status).toBe(403);
    expect((await admin.call('POST', `/communities/${communityId}/join-password`, { kdf_salt: 'a'.repeat(32), verifier_input: 'B'.repeat(44), wrapped_keys: [] })).status).toBe(403);
  });
  it('channel cap: 51st channel rejected', async () => {
    let last = 0;
    for (let i = 0; i < 60; i++) {
      const r = await owner.call('POST', `/communities/${communityId}/channels`, { name: 'ch' + i, type: 'text' });
      last = r.status;
      if (r.status !== 201) break;
    }
    expect(last).toBe(400);
  });
});

describe('kick → freeze → rotate cycle', () => {
  it('kick freezes channels and kills invites', async () => {
    // mallory posts once so we have a message to test later-rotation against
    expect(
      (
        await mallory.call('POST', `/channels/${textChannel}/messages`, {
          key_version: 1,
          nonce: NONCE,
          ciphertext: CT,
        })
      ).status,
    ).toBe(201);
    const kick = await admin.call('DELETE', `/communities/${communityId}/members/${mallory.userId}`);
    expect(kick.status).toBe(200); // { affected_channel_ids } — channels froze
    // frozen: messages, invites, member adds all 409
    expect(
      (await member.call('POST', `/channels/${textChannel}/messages`, { key_version: 1, nonce: NONCE, ciphertext: CT })).status,
    ).toBe(409);
    expect((await owner.call('POST', `/communities/${communityId}/invites`, { wrapped_keys: [{ channel_id: textChannel, key_version: 1, wrapped_key: 'A'.repeat(48) }] })).status).toBe(409);
    const extra = await makeUser(srv.baseUrl, 'mz');
    expect(await addMember(owner, communityId, extra)).toBe(409);
    // mallory is out
    const boot = await mallory.call('GET', '/bootstrap');
    expect(boot.status).toBe(200);
    expect(((await boot.json()) as { communities: unknown[] }).communities).toHaveLength(0);
  });

  it('admin rotation unfreezes and bumps the epoch', async () => {
    const channels = (await (await owner.call('GET', '/bootstrap')).json()) as {
      communities: { id: string; channels: Channel[] }[];
    };
    const before = channels.communities.find((c) => c.id === communityId)!.channels.find((c) => c.id === textChannel)!.key_version;
    const rot = await admin.call(
      'POST',
      `/channels/${textChannel}/rotate`,
      {
        wrapped_keys: [
          { user_id: owner.userId, wrapped_key: 'A'.repeat(48) },
          { user_id: admin.userId, wrapped_key: 'B'.repeat(48) },
          { user_id: member.userId, wrapped_key: 'C'.repeat(48) },
        ],
      },
    );
    expect(rot.status).toBe(204);
    const after = (await (await owner.call('GET', '/bootstrap')).json()) as {
      communities: { id: string; channels: (Channel & { needs_rekey?: number })[] }[];
    };
    const ch = after.communities.find((c) => c.id === communityId)!.channels.find((c) => c.id === textChannel)!;
    expect(ch.key_version).toBe(before + 1);
    expect(ch.needs_rekey ?? 0).toBeFalsy(); // unfrozen
    // messaging works again on the new epoch
    expect(
      (await member.call('POST', `/channels/${textChannel}/messages`, { key_version: before + 1, nonce: NONCE, ciphertext: CT })).status,
    ).toBe(201);
    // stale-epoch write rejected
    expect(
      (await member.call('POST', `/channels/${textChannel}/messages`, { key_version: before, nonce: NONCE, ciphertext: CT })).status,
    ).toBe(409);
  });

  it('mallory (kicked) cannot mint voice tokens for the room', async () => {
    const r = await mallory.call('POST', `/channels/${voiceChannel}/voice-token`);
    expect([403, 404]).toContain(r.status);
  });
});

describe('bans', () => {
  it('banned member cannot rejoin via targeted invite or reapply', async () => {
    expect((await admin.call('POST', `/communities/${communityId}/bans`, { user_id: mallory.userId })).status).toBe(200);
    const inv = await owner.call('POST', `/communities/${communityId}/invites`, {
      target_user_id: mallory.userId,
      wrapped_keys: [
        { channel_id: textChannel, key_version: 2, wrapped_key: 'A'.repeat(48) },
        { channel_id: voiceChannel, key_version: 1, wrapped_key: 'B'.repeat(48) },
      ],
    });
    expect(inv.status).toBe(409); // banned target rejected at creation
    const apply = await mallory.call('POST', `/communities/${communityId}/join-requests`);
    expect(apply.status).toBe(403);
    // ban list visible to staff
    const list = await owner.call('GET', `/communities/${communityId}/bans`);
    expect(list.status).toBe(200);
    const bans = (await list.json()) as { bans: { user_id: string }[] };
    expect(bans.bans.some((b) => b.user_id === mallory.userId)).toBe(true);
  });
});

describe('self-leave + delete', () => {
  it('member leaves: keys purged, channels freeze, bootstrap drops it', async () => {
    const c = await createCommunity(owner, 'ayrilma-test');
    expect(
      await inviteJoin(owner, member, c.id, c.channels.map((ch) => ({ channel_id: ch.id, wrapped_key: 'A'.repeat(48) }))),
    ).toBe(204);
    const leave = await member.call('POST', `/communities/${c.id}/leave`);
    expect(leave.status).toBe(200);
    const affected = ((await leave.json()) as { affected_channel_ids: string[] }).affected_channel_ids;
    expect(affected).toHaveLength(2);
    // gone from the leaver's bootstrap
    const boot = (await (await member.call('GET', '/bootstrap')).json()) as {
      communities: { id: string }[];
    };
    expect(boot.communities.some((x) => x.id === c.id)).toBe(false);
    // leaver holds the raw keys → channels froze for everyone left behind
    expect(
      (await owner.call('POST', `/channels/${c.channels[0]!.id}/messages`, { key_version: 1, nonce: NONCE, ciphertext: CT })).status,
    ).toBe(409);
    // leaver can no longer mint voice tokens
    expect([403, 404]).toContain((await member.call('POST', `/channels/${c.channels[1]!.id}/voice-token`)).status);
  });

  it('owner cannot leave; non-member gets 404', async () => {
    expect((await owner.call('POST', `/communities/${communityId}/leave`)).status).toBe(400);
    const outsider = await makeUser(srv.baseUrl, 'ml');
    expect((await outsider.call('POST', `/communities/${communityId}/leave`)).status).toBe(404);
  });

  it('owner deletes: cascade removes everything, non-owner blocked', async () => {
    const c = await createCommunity(owner, 'silme-test');
    expect(
      await inviteJoin(owner, member, c.id, c.channels.map((ch) => ({ channel_id: ch.id, wrapped_key: 'A'.repeat(48) }))),
    ).toBe(204);
    expect((await member.call('DELETE', `/communities/${c.id}`)).status).toBe(403);
    expect((await owner.call('DELETE', `/communities/${c.id}`)).status).toBe(204);
    // gone from both bootstraps
    for (const u of [owner, member]) {
      const boot = (await (await u.call('GET', '/bootstrap')).json()) as {
        communities: { id: string }[];
      };
      expect(boot.communities.some((x) => x.id === c.id)).toBe(false);
    }
    // channel rows (and thus messages/keys via cascade) are gone
    expect((await owner.call('POST', `/channels/${c.channels[0]!.id}/messages`, { key_version: 1, nonce: NONCE, ciphertext: CT })).status).toBe(404);
    expect((await owner.call('DELETE', `/communities/${c.id}`)).status).toBe(404);
  });
});
