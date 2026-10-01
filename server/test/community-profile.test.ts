// Community profile: rename + avatar. Plain server metadata like names —
// must not touch wrapped channel keys (E2EE). Staff-only writes, member-only
// avatar read, friend requests by user_id from the member list.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startServer, makeUser, inviteJoin, type TestServer, type TestUser } from './helpers';

let srv: TestServer;
let owner: TestUser, member: TestUser, outsider: TestUser;

// real 1x1 PNG — passes the magic-byte gate
const PNG_1PX =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

let communityId = '';
let channelId = '';

beforeAll(async () => {
  srv = await startServer();
  owner = await makeUser(srv.baseUrl, 'cp-o');
  member = await makeUser(srv.baseUrl, 'cp-m');
  outsider = await makeUser(srv.baseUrl, 'cp-x');
  const r = await owner.call('POST', '/communities', {
    name: 'profil test',
    channels: [{ name: 'genel', type: 'text', wrapped_key: 'T'.repeat(48) }],
  });
  expect(r.status).toBe(201);
  const j = (await r.json()) as { community: { id: string }; channels: { id: string }[] };
  communityId = j.community.id;
  channelId = j.channels[0]!.id;
  expect(
    await inviteJoin(owner, member, communityId, [{ channel_id: channelId, wrapped_key: 'A'.repeat(48) }]),
  ).toBe(204);
});
afterAll(() => srv.stop());

describe('community rename + avatar', () => {
  it('member cannot rename; owner can', async () => {
    expect((await member.call('PATCH', `/communities/${communityId}`, { name: 'hacked' })).status).toBe(403);
    expect((await owner.call('PATCH', `/communities/${communityId}`, { name: '  ' })).status).toBe(400);
    expect((await owner.call('PATCH', `/communities/${communityId}`, { name: 'yeni ad' })).status).toBe(204);
    // member sees the new name; keys untouched
    const boot = (await (
      await member.call('GET', '/bootstrap')
    ).json()) as {
      communities: { id: string; name: string; avatar_updated_at: number | null; channels: { needs_rekey: boolean }[] }[];
    };
    const com = boot.communities.find((c) => c.id === communityId)!;
    expect(com.name).toBe('yeni ad');
    expect(com.channels.every((ch) => !ch.needs_rekey)).toBe(true);
  });

  it('avatar: member-only read, staff-only write, magic bytes enforced', async () => {
    // no avatar yet
    expect((await member.call('GET', `/communities/${communityId}/avatar`)).status).toBe(204);
    // outsider must not learn the community exists
    expect((await outsider.call('GET', `/communities/${communityId}/avatar`)).status).toBe(404);
    // member cannot upload
    expect(
      (await member.call('PATCH', `/communities/${communityId}/avatar`, { data_url: PNG_1PX })).status,
    ).toBe(403);
    // not an image
    expect(
      (await owner.call('PATCH', `/communities/${communityId}/avatar`, { data_url: 'data:image/png;base64,AAAA' }))
        .status,
    ).toBe(400);
    // owner uploads a real one
    expect(
      (await owner.call('PATCH', `/communities/${communityId}/avatar`, { data_url: PNG_1PX })).status,
    ).toBe(204);
    const get = await member.call('GET', `/communities/${communityId}/avatar`);
    expect(get.status).toBe(200);
    expect(get.headers.get('content-type')).toBe('image/png');
    // bootstrap carries the cache-bust stamp
    const boot = (await (
      await member.call('GET', '/bootstrap')
    ).json()) as { communities: { id: string; avatar_updated_at: number | null }[] };
    expect(boot.communities.find((c) => c.id === communityId)!.avatar_updated_at).toBeGreaterThan(0);
    // clear
    expect(
      (await owner.call('PATCH', `/communities/${communityId}/avatar`, { clear: true })).status,
    ).toBe(204);
    expect((await member.call('GET', `/communities/${communityId}/avatar`)).status).toBe(204);
  });

  it('rename does not touch wrapped keys', async () => {
    const before = (await (
      await member.call('GET', '/bootstrap')
    ).json()) as { communities: { id: string; channels: { my_wrapped_key: string | null; key_version: number }[] }[] };
    await owner.call('PATCH', `/communities/${communityId}`, { name: 'yeni ad 2' });
    const after = (await (
      await member.call('GET', '/bootstrap')
    ).json()) as { communities: { id: string; channels: { my_wrapped_key: string | null; key_version: number }[] }[] };
    const b = before.communities.find((c) => c.id === communityId)!.channels[0]!;
    const a = after.communities.find((c) => c.id === communityId)!.channels[0]!;
    expect(a.my_wrapped_key).toBe(b.my_wrapped_key);
    expect(a.key_version).toBe(b.key_version);
  });
});

describe('friend request by user_id', () => {
  it('member-list flow: send by id, accept, friend', async () => {
    // outsider → member by user_id (the UserCard path)
    expect(
      (await outsider.call('POST', '/friends/requests', { user_id: member.userId })).status,
    ).toBe(204);
    // duplicate pending → 409
    expect(
      (await outsider.call('POST', '/friends/requests', { user_id: member.userId })).status,
    ).toBe(409);
    expect((await member.call('POST', `/friends/requests/${outsider.userId}/accept`, {})).status).toBe(204);
    const friends = (await (await outsider.call('GET', '/friends')).json()) as {
      friends: { id: string }[];
    };
    expect(friends.friends.some((f) => f.id === member.userId)).toBe(true);
  });

  it('validation: bad id → 400, unknown id → 404', async () => {
    expect((await outsider.call('POST', '/friends/requests', { user_id: '../x' })).status).toBe(400);
    expect((await outsider.call('POST', '/friends/requests', { user_id: '11111111-1111-1111-1111-111111111111' })).status).toBe(404);
  });
});
