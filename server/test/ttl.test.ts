// Kaybolan mesajlar (Faz 2): expires_at doğrulama, WS frame'de TTL alanı,
// süresi geçen frame reddi ve saatlik janitor'un tombstone süpürmesi.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startServer, makeUser, type TestServer, type TestUser } from './helpers';
import { MAX_MESSAGE_TTL_MS, isExpired, parseExpiresAt } from '../src/lib/ttl';

let srv: TestServer;
let owner: TestUser;
let member: TestUser;
let comId: string;
let chId: string;

const CT = 'Q'.repeat(24);
const NONCE = 'N'.repeat(32);

interface Channel {
  id: string;
  name: string;
  type: 'text' | 'voice';
  key_version: number;
}

beforeAll(async () => {
  srv = await startServer();
  owner = await makeUser(srv.baseUrl, 'to');
  member = await makeUser(srv.baseUrl, 'tm');
  const r = await owner.call('POST', '/communities', {
    name: 'ttl-test',
    channels: [{ name: 'genel', type: 'text', wrapped_key: 'T'.repeat(48) }],
  });
  expect(r.status).toBe(201);
  const j = (await r.json()) as { community: { id: string }; channels: Channel[] };
  comId = j.community.id;
  chId = j.channels[0]!.id;
  expect(
    (await owner.call('POST', `/communities/${comId}/members`, {
      user_id: member.userId,
      wrapped_keys: [{ channel_id: chId, wrapped_key: 'A'.repeat(48) }],
    })).status,
  ).toBe(204);
});
afterAll(() => srv.stop());

// --- saf helper sınırları (route validasyonu bunlara dayanır) ---
describe('parseExpiresAt / isExpired', () => {
  const now = 1_000_000;
  it('null/absent kapalı; gelecek kabul; geçmiş ve tavan üstü reddedilir', () => {
    expect(parseExpiresAt(undefined, now)).toBeNull();
    expect(parseExpiresAt(null, now)).toBeNull();
    expect(parseExpiresAt(now + 1, now)).toBe(now + 1);
    expect(parseExpiresAt(now + MAX_MESSAGE_TTL_MS, now)).toBe(now + MAX_MESSAGE_TTL_MS);
    expect(parseExpiresAt(now, now)).toBeUndefined();
    expect(parseExpiresAt(now - 1, now)).toBeUndefined();
    expect(parseExpiresAt(now + MAX_MESSAGE_TTL_MS + 1, now)).toBeUndefined();
    expect(parseExpiresAt('yakinda', now)).toBeUndefined();
    expect(parseExpiresAt(1.5, now)).toBeUndefined();
  });
  it('isExpired: eşit ve geçmiş true, gelecek ve null false', () => {
    expect(isExpired(null, now)).toBe(false);
    expect(isExpired(undefined, now)).toBe(false);
    expect(isExpired(now + 1, now)).toBe(false);
    expect(isExpired(now, now)).toBe(true);
    expect(isExpired(now - 1, now)).toBe(true);
  });
});

// --- WS dinleyici (messages.test.ts kalıbı) ---
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

describe('expires_at kabul + WS frame alanı', () => {
  it('geçerli TTL ile POST → 201; history ve message:new frame expires_at taşır', async () => {
    const listener = await wsCollect(owner.token);
    const future = Date.now() + 3_600_000;
    const r = await member.call('POST', `/channels/${chId}/messages`, {
      key_version: 1,
      nonce: NONCE,
      ciphertext: CT,
      expires_at: future,
    });
    expect(r.status).toBe(201);
    await new Promise((res) => setTimeout(res, 300));
    const frame = listener.events.find((e) => e.type === 'message:new') as
      | { message?: { expires_at?: number } }
      | undefined;
    expect(frame?.message?.expires_at).toBe(future);
    listener.close();
    const g = await member.call('GET', `/channels/${chId}/messages?limit=50`);
    const row = ((await g.json()) as { messages: { expires_at: number | null }[] }).messages.at(-1);
    expect(row?.expires_at).toBe(future);
  });

  it('expires_at olmadan POST → history satırında null (TTL kapalı)', async () => {
    expect(
      (await member.call('POST', `/channels/${chId}/messages`, {
        key_version: 1,
        nonce: NONCE,
        ciphertext: CT,
      })).status,
    ).toBe(201);
    const g = await member.call('GET', `/channels/${chId}/messages?limit=50`);
    const row = ((await g.json()) as { messages: { expires_at: number | null }[] }).messages.at(-1);
    expect(row?.expires_at).toBeNull();
  });

  it('süresi geçmiş expires_at → 400 ve WS frame dağıtılmaz', async () => {
    const listener = await wsCollect(owner.token);
    await new Promise((res) => setTimeout(res, 200));
    const r = await member.call('POST', `/channels/${chId}/messages`, {
      key_version: 1,
      nonce: NONCE,
      ciphertext: CT,
      expires_at: Date.now() - 1_000,
    });
    expect(r.status).toBe(400);
    await new Promise((res) => setTimeout(res, 300));
    expect(listener.events.some((e) => e.type === 'message:new')).toBe(false);
    listener.close();
  });

  it('tavan üstü (30 gün +) ve bozuk tip → 400', async () => {
    const far = await member.call('POST', `/channels/${chId}/messages`, {
      key_version: 1,
      nonce: NONCE,
      ciphertext: CT,
      // +1 dk: süreçler arası saat kayması tavanın hemen üstünü yutmasın
      expires_at: Date.now() + MAX_MESSAGE_TTL_MS + 60_000,
    });
    expect(far.status).toBe(400);
    const junk = await member.call('POST', `/channels/${chId}/messages`, {
      key_version: 1,
      nonce: NONCE,
      ciphertext: CT,
      expires_at: 'yarin',
    });
    expect(junk.status).toBe(400);
  });
});

describe('DM + GDM expires_at', () => {
  it('DM mesajı TTL ile saklanır ve history satırında döner', async () => {
    const a = owner;
    const b = member;
    expect((await a.call('POST', '/friends/requests', { nick: b.nick })).status).toBe(204);
    expect((await b.call('POST', `/friends/requests/${a.userId}/accept`, {})).status).toBe(204);
    const open = await a.call('POST', '/dms', {
      user_id: b.userId,
      wrapped_keys: [
        { user_id: a.userId, wrapped_key: 'A'.repeat(48) },
        { user_id: b.userId, wrapped_key: 'B'.repeat(48) },
      ],
    });
    expect(open.status).toBe(201);
    const dmId = ((await open.json()) as { channel: { id: string } }).channel.id;
    const future = Date.now() + 60_000;
    expect(
      (await a.call('POST', `/dms/${dmId}/messages`, {
        key_version: 1,
        nonce: NONCE,
        ciphertext: CT,
        expires_at: future,
      })).status,
    ).toBe(201);
    const g = await b.call('GET', `/dms/${dmId}/messages`);
    const row = ((await g.json()) as { messages: { expires_at: number | null }[] }).messages.at(-1);
    expect(row?.expires_at).toBe(future);
  });

  it('GDM mesajı TTL ile saklanır ve history satırında döner', async () => {
    const a = owner;
    const b = member;
    const create = await a.call('POST', '/gdms', {
      name: 'ttl-grup',
      member_ids: [b.userId],
      wrapped_keys: [
        { user_id: a.userId, wrapped_key: 'G'.repeat(48) },
        { user_id: b.userId, wrapped_key: 'H'.repeat(48) },
      ],
    });
    expect(create.status).toBe(201);
    const gid = ((await create.json()) as { channel: { id: string } }).channel.id;
    const future = Date.now() + 60_000;
    expect(
      (await a.call('POST', `/gdms/${gid}/messages`, {
        key_version: 1,
        nonce: NONCE,
        ciphertext: CT,
        expires_at: future,
      })).status,
    ).toBe(201);
    const g = await b.call('GET', `/gdms/${gid}/messages`);
    const row = ((await g.json()) as { messages: { expires_at: number | null }[] }).messages.at(-1);
    expect(row?.expires_at).toBe(future);
  });
});

// --- janitor: kendi sunucusu — kısa süpürme aralığı env ile ---
describe('janitor tombstone süpürmesi', () => {
  it("süresi geçen satır tombstone olur; TTL'siz komşu dokunulmaz", async () => {
    const srv2 = await startServer({ env: { MESSAGE_TTL_SWEEP_MS: '150' } });
    try {
      const u = await makeUser(srv2.baseUrl, 'jw');
      const c = await u.call('POST', '/communities', {
        name: 'süpürge',
        channels: [{ name: 'genel', type: 'text', wrapped_key: 'T'.repeat(48) }],
      });
      expect(c.status).toBe(201);
      const cid = ((await c.json()) as { channels: Channel[] }).channels[0]!.id;
      const future = Date.now() + 600;
      expect(
        (await u.call('POST', `/channels/${cid}/messages`, {
          key_version: 1,
          nonce: NONCE,
          ciphertext: CT,
          expires_at: future,
        })).status,
      ).toBe(201);
      expect(
        (await u.call('POST', `/channels/${cid}/messages`, {
          key_version: 1,
          nonce: NONCE,
          ciphertext: CT,
        })).status,
      ).toBe(201);
      // süpürme henüz çalışmadı — satır canlı
      let j = (await (await u.call('GET', `/channels/${cid}/messages?limit=50`)).json()) as {
        messages: { expires_at: number | null; deleted: number; nonce: string | null }[];
      };
      expect(j.messages.filter((m) => m.expires_at !== null)).toHaveLength(1);
      expect(j.messages.find((m) => m.expires_at !== null)?.deleted).toBe(0);
      // süre dolur + 150 ms'lik süpürme yakalar
      await new Promise((res) => setTimeout(res, 1_600));
      j = (await (await u.call('GET', `/channels/${cid}/messages?limit=50`)).json()) as {
        messages: { expires_at: number | null; deleted: number; nonce: string | null; ciphertext: string | null }[];
      };
      const expired = j.messages.find((m) => m.expires_at !== null);
      expect(expired?.deleted).toBe(1);
      expect(expired?.nonce).toBeNull();
      expect(expired?.ciphertext).toBeNull();
      // TTL'siz mesaj aynen durur
      const plain = j.messages.find((m) => m.expires_at === null);
      expect(plain?.deleted).toBe(0);
      expect(plain?.ciphertext).toBe(CT);
    } finally {
      await srv2.stop();
    }
  }, 20_000);
});