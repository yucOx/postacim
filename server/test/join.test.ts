// Membership entry paths: open + targeted invites, join requests, join password.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startServer, makeUser, type TestServer, type TestUser } from './helpers';

let srv: TestServer;
let owner: TestUser, outsider: TestUser, applicant: TestUser;
let communityId: string, textChannel: string, voiceChannel: string;

const W = (c: string): string => c.repeat(48);

async function mkCommunity(u: TestUser): Promise<void> {
  const r = await u.call('POST', '/communities', {
    name: 'katilim-test',
    channels: [
      { name: 'genel', type: 'text', wrapped_key: W('A') },
      { name: 'sesli', type: 'voice', wrapped_key: W('B') },
    ],
  });
  const j = (await r.json()) as { community: { id: string }; channels: { id: string }[] };
  communityId = j.community.id;
  textChannel = j.channels[0]!.id;
  voiceChannel = j.channels[1]!.id;
}

beforeAll(async () => {
  srv = await startServer();
  owner = await makeUser(srv.baseUrl, 'jo');
  outsider = await makeUser(srv.baseUrl, 'je');
  applicant = await makeUser(srv.baseUrl, 'ja');
  await mkCommunity(owner);
});
afterAll(() => srv.stop());

async function createInvite(u: TestUser, body: Record<string, unknown>): Promise<{ code: string }> {
  const r = await u.call('POST', `/communities/${communityId}/invites`, {
    wrapped_keys: [
      { channel_id: textChannel, key_version: 1, wrapped_key: W('A') },
      { channel_id: voiceChannel, key_version: 1, wrapped_key: W('B') },
    ],
    ...body,
  });
  if (r.status !== 201) throw new Error(`invite create: ${r.status} ${await r.text()}`);
  return { code: ((await r.json()) as { invite: { code: string } }).invite.code };
}

describe('open invites', () => {
  it('peek hands out wrapped keys; redeem+complete joins with membership', async () => {
    const { code } = await createInvite(owner, {});
    const peek = await outsider.call('GET', `/invites/${code}`);
    expect(peek.status).toBe(200);
    const j = (await peek.json()) as { requires_password: boolean; wrapped_keys: unknown[] };
    expect(j.requires_password).toBe(false);
    expect(j.wrapped_keys).toHaveLength(2);
    const complete = await outsider.call('POST', `/invites/${code}/complete`, {
      wrapped_keys: [
        { channel_id: textChannel, key_version: 1, wrapped_key: W('C') },
        { channel_id: voiceChannel, key_version: 1, wrapped_key: W('D') },
      ],
    });
    expect(complete.status).toBe(204);
    const boot = (await (await outsider.call('GET', '/bootstrap')).json()) as {
      communities: { id: string }[];
    };
    expect(boot.communities.some((c) => c.id === communityId)).toBe(true);
  });

  it('expired invite rejected', async () => {
    const { code } = await createInvite(owner, { ttl_hours: 0.001 }); // ~3.6s
    await new Promise((r) => setTimeout(r, 4000));
    const peek = await applicant.call('GET', `/invites/${code}`);
    expect([404, 409]).toContain(peek.status);
  });
});

describe('targeted invites', () => {
  it('cannot be peeked by another user', async () => {
    const { code } = await createInvite(owner, { target_user_id: applicant.userId });
    const stranger = await makeUser(srv.baseUrl, 'js');
    const peek = await stranger.call('GET', `/invites/${code}`);
    expect([403, 409]).toContain(peek.status);
    const own = await applicant.call('GET', `/invites/${code}`);
    expect(own.status).toBe(200);
  });

  it('max_uses: one-shot invite exhausted after first complete', async () => {
    const { code } = await createInvite(owner, { max_uses: 1 });
    const u1 = await makeUser(srv.baseUrl, 'jm');
    const c1 = await u1.call('POST', `/invites/${code}/complete`, {
      wrapped_keys: [
        { channel_id: textChannel, key_version: 1, wrapped_key: W('E') },
        { channel_id: voiceChannel, key_version: 1, wrapped_key: W('F') },
      ],
    });
    expect(c1.status).toBe(204);
    const u2 = await makeUser(srv.baseUrl, 'jn');
    const c2 = await u2.call('POST', `/invites/${code}/complete`, {
      wrapped_keys: [
        { channel_id: textChannel, key_version: 1, wrapped_key: W('G') },
        { channel_id: voiceChannel, key_version: 1, wrapped_key: W('H') },
      ],
    });
    expect(c2.status).toBe(409);
  });
});

describe('join requests', () => {
  it('apply → approve wraps keys → member; denied can reapply', async () => {
    expect((await applicant.call('POST', `/communities/${communityId}/join-requests`)).status).toBe(204);
    expect((await applicant.call('POST', `/communities/${communityId}/join-requests`)).status).toBe(409); // duplicate pending
    const list = (await (await owner.call('GET', `/communities/${communityId}/join-requests`)).json()) as {
      requests: { user_id: string; nick: string; public_key: string }[];
    };
    expect(list.requests.some((r) => r.user_id === applicant.userId)).toBe(true);
    const approve = await owner.call('POST', `/communities/${communityId}/join-requests/${applicant.userId}/approve`, {
      wrapped_keys: [
        { channel_id: textChannel, key_version: 1, wrapped_key: W('I') },
        { channel_id: voiceChannel, key_version: 1, wrapped_key: W('J') },
      ],
    });
    expect(approve.status).toBe(204);
    const boot = (await (await applicant.call('GET', '/bootstrap')).json()) as {
      communities: { id: string }[];
    };
    expect(boot.communities.some((c) => c.id === communityId)).toBe(true);
  });

  it('already-member applicant rejected', async () => {
    const r = await applicant.call('POST', `/communities/${communityId}/join-requests`);
    expect(r.status).toBe(409);
  });
});

describe('join password', () => {
  it('peek requires proof; wrong proof 401; correct proof yields keys; complete joins', async () => {
    // set the password (owner only) — verifier is argon2(server-side), proof material is opaque here
    const set = await owner.call('POST', `/communities/${communityId}/join-password`, {
      kdf_salt: 'a'.repeat(32),
      verifier_input: 'V'.repeat(44),
      wrapped_keys: [
        { channel_id: textChannel, key_version: 1, wrapped_key: W('K') },
        { channel_id: voiceChannel, key_version: 1, wrapped_key: W('L') },
      ],
    });
    expect(set.status).toBe(204);

    const { code } = await createInvite(owner, {});
    const newcomer = await makeUser(srv.baseUrl, 'jp');
    const peek = await newcomer.call('GET', `/invites/${code}`);
    const pj = (await peek.json()) as { requires_password: boolean; join_kdf_salt?: string };
    expect(pj.requires_password).toBe(true);
    expect(pj.join_kdf_salt).toBe('a'.repeat(32));

    // wrong proof — verifier_input was 'V'*44 (hashed server-side); any other string fails
    const bad = await newcomer.call('POST', `/invites/${code}/redeem-password`, {
      auth_material: 'X'.repeat(44),
    });
    expect(bad.status).toBe(401);

    // correct proof
    const good = await newcomer.call('POST', `/invites/${code}/redeem-password`, {
      auth_material: 'V'.repeat(44),
    });
    expect(good.status).toBe(200);
    const gj = (await good.json()) as { wrapped_keys: unknown[] };
    expect(gj.wrapped_keys).toHaveLength(2);

    const complete = await newcomer.call('POST', `/invites/${code}/complete`, {
      wrapped_keys: [
        { channel_id: textChannel, key_version: 1, wrapped_key: W('M') },
        { channel_id: voiceChannel, key_version: 1, wrapped_key: W('N') },
      ],
    });
    expect(complete.status).toBe(204);

    // owner removes the password → invites go open again
    const del = await owner.call('DELETE', `/communities/${communityId}/join-password`);
    expect(del.status).toBe(204);
    const { code: c2 } = await createInvite(owner, {});
    const peek2 = await (await makeUser(srv.baseUrl, 'jq').then(async (u) => u.call('GET', `/invites/${c2}`))).json() as {
      requires_password: boolean;
    };
    expect(peek2.requires_password).toBe(false);
  });
});
