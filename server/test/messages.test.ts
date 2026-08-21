// Message surface: history pagination cursor, per-user (not per-IP) rate
// bucket on send, and rotate roster validation.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startServer, makeUser, type TestServer, type TestUser } from './helpers';

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
  const add = await owner.call('POST', `/communities/${comId}/members`, {
    user_id: member.userId,
    wrapped_keys: [{ channel_id: chId, wrapped_key: 'A'.repeat(48) }],
  });
  expect(add.status).toBe(204);
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
