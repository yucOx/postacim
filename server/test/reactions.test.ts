// Reactions + replies: channel/dm/gdm kapsamları, idempotent ekleme, 404 silme,
// history gruplaması (emoji/count/me), WS reaction:update yayını, reply_to
// doğrulaması ve satır düzeyinde temizlik kontrolleri (topluluk silme, boş
// GDM, hesap silme — tepkiler message_id FK'suz olduğu için kalıntı kalmamalı).
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { startServer, makeUser, type TestServer, type TestUser } from './helpers';

let srv: TestServer;
let owner: TestUser;
let member: TestUser;
let outsider: TestUser;

const W = (c: string): string => c.repeat(48);
const NONCE = 'A'.repeat(32);
const CT = 'Q'.repeat(24);

let chId: string;

async function friend(a: TestUser, b: TestUser): Promise<void> {
  expect((await a.call('POST', '/friends/requests', { nick: b.nick })).status).toBe(204);
  expect((await b.call('POST', `/friends/requests/${a.userId}/accept`, {})).status).toBe(204);
}

async function postChannel(u: TestUser, replyTo?: number): Promise<number> {
  const r = await u.call('POST', `/channels/${chId}/messages`, {
    key_version: 1,
    nonce: NONCE,
    ciphertext: CT,
    ...(replyTo !== undefined ? { reply_to: replyTo } : {}),
  });
  expect(r.status).toBe(201);
  return ((await r.json()) as { id: number }).id;
}

interface HistMsg {
  id: number;
  reply_to: number | null;
  reply_nick: string | null;
  reactions: { emoji: string; count: number; me: boolean }[];
}

async function channelHistory(u: TestUser): Promise<HistMsg[]> {
  const r = await u.call('GET', `/channels/${chId}/messages?limit=100`);
  expect(r.status).toBe(200);
  return ((await r.json()) as { messages: HistMsg[] }).messages;
}

// test sunucusunun atıl DB'sine doğrudan satır kontrolü
const rawCount = (sql: string, ...params: unknown[]): number => {
  const db = new Database(path.join(srv.dataDir, 'posta.db'));
  try {
    return (db.prepare(sql).get(...params) as { c: number }).c;
  } finally {
    db.close();
  }
};

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

beforeAll(async () => {
  srv = await startServer();
  owner = await makeUser(srv.baseUrl, 'ra');
  member = await makeUser(srv.baseUrl, 'rb');
  outsider = await makeUser(srv.baseUrl, 'rx');
  const r = await owner.call('POST', '/communities', {
    name: 'tepki-test',
    channels: [{ name: 'genel', type: 'text', wrapped_key: W('T') }],
  });
  expect(r.status).toBe(201);
  const j = (await r.json()) as { community: { id: string }; channels: { id: string }[] };
  chId = j.channels[0]!.id;
  expect(
    (await owner.call('POST', `/communities/${j.community.id}/members`, {
      user_id: member.userId,
      wrapped_keys: [{ channel_id: chId, wrapped_key: W('A') }],
    })).status,
  ).toBe(204);
  await friend(owner, member);
});
afterAll(() => srv.stop());

describe('channel reactions', () => {
  it('add → 204, duplicate idempotent → 204, history groups emoji/count/me', async () => {
    const msg = await postChannel(owner);
    const add = await member.call('POST', `/channels/${chId}/messages/${msg}/reactions`, { emoji: '👍' });
    expect(add.status).toBe(204);
    const dup = await member.call('POST', `/channels/${chId}/messages/${msg}/reactions`, { emoji: '👍' });
    expect(dup.status).toBe(204);
    let mine = (await channelHistory(member)).find((m) => m.id === msg)!;
    expect(mine.reactions).toEqual([{ emoji: '👍', count: 1, me: true }]);
    // tepki vermeden önce sahibin görünümü: count 1, me=false
    let theirs = (await channelHistory(owner)).find((m) => m.id === msg)!;
    expect(theirs.reactions).toEqual([{ emoji: '👍', count: 1, me: false }]);
    expect((await owner.call('POST', `/channels/${chId}/messages/${msg}/reactions`, { emoji: '👍' })).status).toBe(204);
    mine = (await channelHistory(member)).find((m) => m.id === msg)!;
    expect(mine.reactions).toEqual([{ emoji: '👍', count: 2, me: true }]);
    theirs = (await channelHistory(owner)).find((m) => m.id === msg)!;
    expect(theirs.reactions).toEqual([{ emoji: '👍', count: 2, me: true }]);
  });

  it('remove → 204, remove again → 404, history back to empty', async () => {
    const msg = await postChannel(owner);
    expect((await member.call('POST', `/channels/${chId}/messages/${msg}/reactions`, { emoji: '😀' })).status).toBe(204);
    const del = await member.call('DELETE', `/channels/${chId}/messages/${msg}/reactions?emoji=${encodeURIComponent('😀')}`);
    expect(del.status).toBe(204);
    const again = await member.call('DELETE', `/channels/${chId}/messages/${msg}/reactions?emoji=${encodeURIComponent('😀')}`);
    expect(again.status).toBe(404);
    expect((await channelHistory(member)).find((m) => m.id === msg)!.reactions).toEqual([]);
  });

  it('non-member 403; bad/missing emoji 400; unknown message 404', async () => {
    const msg = await postChannel(owner);
    expect((await outsider.call('POST', `/channels/${chId}/messages/${msg}/reactions`, { emoji: '👍' })).status).toBe(403);
    expect((await member.call('POST', `/channels/${chId}/messages/${msg}/reactions`, { emoji: '' })).status).toBe(400);
    expect((await member.call('POST', `/channels/${chId}/messages/${msg}/reactions`, { emoji: 'x'.repeat(17) })).status).toBe(400);
    expect((await member.call('POST', `/channels/${chId}/messages/${msg}/reactions`, {})).status).toBe(400);
    expect((await member.call('POST', `/channels/${chId}/messages/999999999/reactions`, { emoji: '👍' })).status).toBe(404);
  });

  it('WS reaction:update on add and remove; duplicate add stays silent', async () => {
    const listener = await wsCollect(owner.token);
    const msg = await postChannel(owner);
    expect((await member.call('POST', `/channels/${chId}/messages/${msg}/reactions`, { emoji: '🔥' })).status).toBe(204);
    expect((await member.call('POST', `/channels/${chId}/messages/${msg}/reactions`, { emoji: '🔥' })).status).toBe(204);
    expect((await member.call('DELETE', `/channels/${chId}/messages/${msg}/reactions?emoji=${encodeURIComponent('🔥')}`)).status).toBe(204);
    await new Promise((r) => setTimeout(r, 300));
    const rx = listener.events.filter((e) => e.type === 'reaction:update');
    expect(rx).toContainEqual({
      type: 'reaction:update', scope: 'channel', channel_id: chId, message_id: msg,
      emoji: '🔥', action: 'add', user_id: member.userId, nick: member.nick,
    });
    expect(rx).toContainEqual({
      type: 'reaction:update', scope: 'channel', channel_id: chId, message_id: msg,
      emoji: '🔥', action: 'remove', user_id: member.userId, nick: member.nick,
    });
    expect(rx.filter((e) => e.action === 'add').length).toBe(1); // duplicate: no second broadcast
    listener.close();
  });
});

describe('channel replies', () => {
  it('valid reply stored; history echoes reply_to + reply_nick; WS payload carries them', async () => {
    const listener = await wsCollect(member.token);
    const target = await postChannel(owner);
    const reply = await postChannel(member, target);
    const row = (await channelHistory(member)).find((m) => m.id === reply)!;
    expect(row.reply_to).toBe(target);
    expect(row.reply_nick).toBe(owner.nick);
    await new Promise((r) => setTimeout(r, 300));
    const ev = listener.events.find((e) => e.type === 'message:new' && (e.message as { id: number }).id === reply);
    expect(ev).toBeTruthy();
    const m = (ev as { message: { reply_to: number; reply_nick: string; reactions: unknown[] } }).message;
    expect(m.reply_to).toBe(target);
    expect(m.reply_nick).toBe(owner.nick);
    expect(m.reactions).toEqual([]);
    listener.close();
  });

  it('cross-channel / unknown / non-integer reply_to → 400; tombstone target is fine', async () => {
    const own = await outsider.call('POST', '/communities', {
      name: 'diger-yer',
      channels: [{ name: 'genel', type: 'text', wrapped_key: W('Z') }],
    });
    const otherCh = ((await own.json()) as { channels: { id: string }[] }).channels[0]!.id;
    const foreign = ((await (await outsider.call('POST', `/channels/${otherCh}/messages`, {
      key_version: 1, nonce: NONCE, ciphertext: CT,
    })).json()) as { id: number }).id;

    expect((await member.call('POST', `/channels/${chId}/messages`, {
      key_version: 1, nonce: NONCE, ciphertext: CT, reply_to: foreign,
    })).status).toBe(400);
    expect((await member.call('POST', `/channels/${chId}/messages`, {
      key_version: 1, nonce: NONCE, ciphertext: CT, reply_to: 999999999,
    })).status).toBe(400);
    expect((await member.call('POST', `/channels/${chId}/messages`, {
      key_version: 1, nonce: NONCE, ciphertext: CT, reply_to: 'abc',
    })).status).toBe(400);

    // tombstone hedef: satır kalır, reply_nick hâlâ dolu gelir
    const dead = await postChannel(owner);
    expect((await owner.call('DELETE', `/messages/ch/${chId}/${dead}`)).status).toBe(200);
    const reply = await postChannel(member, dead);
    const row = (await channelHistory(member)).find((m) => m.id === reply)!;
    expect(row.reply_to).toBe(dead);
    expect(row.reply_nick).toBe(owner.nick);
  });
});

describe('DM reactions + replies', () => {
  it('add/remove with per-viewer me flag; WS reaches only the peer; reply echoed', async () => {
    const open = await owner.call('POST', '/dms', {
      user_id: member.userId,
      wrapped_keys: [
        { user_id: owner.userId, wrapped_key: W('A') },
        { user_id: member.userId, wrapped_key: W('B') },
      ],
    });
    expect(open.status).toBe(201);
    const dmId = ((await open.json()) as { channel: { id: string } }).channel.id;

    const sent = await owner.call('POST', `/dms/${dmId}/messages`, { key_version: 1, nonce: NONCE, ciphertext: CT });
    const msg = ((await sent.json()) as { id: number }).id;

    const listener = await wsCollect(member.token);
    expect((await member.call('POST', `/dms/${dmId}/messages/${msg}/reactions`, { emoji: '👍' })).status).toBe(204);
    expect((await owner.call('POST', `/dms/${dmId}/messages/${msg}/reactions`, { emoji: '👍' })).status).toBe(204);
    await new Promise((r) => setTimeout(r, 300));
    expect(listener.events).toContainEqual({
      type: 'reaction:update', scope: 'dm', channel_id: dmId, message_id: msg,
      emoji: '👍', action: 'add', user_id: owner.userId, nick: owner.nick,
    });
    listener.close();

    const histOf = async (u: TestUser) =>
      ((await (await u.call('GET', `/dms/${dmId}/messages`)).json()) as { messages: HistMsg[] }).messages
        .find((m) => m.id === msg)!;
    expect((await histOf(owner)).reactions).toEqual([{ emoji: '👍', count: 2, me: true }]);
    expect((await histOf(member)).reactions).toEqual([{ emoji: '👍', count: 2, me: true }]);

    // outsider katılımcı değil → 404 (DM varlığı sızmaz)
    expect((await outsider.call('POST', `/dms/${dmId}/messages/${msg}/reactions`, { emoji: '👍' })).status).toBe(404);

    // cevap: hedef aynı DM'de olmalı
    const rep = await member.call('POST', `/dms/${dmId}/messages`, {
      key_version: 1, nonce: NONCE, ciphertext: CT, reply_to: msg,
    });
    expect(rep.status).toBe(201);
    const replyId = ((await rep.json()) as { id: number }).id;
    const targetRow = await histOf(member);
    expect(targetRow.reply_to).toBeNull(); // hedefin kendisi cevap değil
    const replyRow = ((await (await member.call('GET', `/dms/${dmId}/messages`)).json()) as { messages: HistMsg[] })
      .messages.find((m) => m.id === replyId)!;
    expect(replyRow.reply_to).toBe(msg);
    expect(replyRow.reply_nick).toBe(owner.nick);

    // cevap hedefi bu DM'de yok → 400
    expect((await member.call('POST', `/dms/${dmId}/messages`, {
      key_version: 1, nonce: NONCE, ciphertext: CT, reply_to: 999999999,
    })).status).toBe(400);

    expect((await owner.call('DELETE', `/dms/${dmId}/messages/${msg}/reactions?emoji=${encodeURIComponent('👍')}`)).status).toBe(204);
    expect((await owner.call('DELETE', `/dms/${dmId}/messages/${msg}/reactions?emoji=${encodeURIComponent('👍')}`)).status).toBe(404);
  });
});

describe('GDM reactions + replies', () => {
  it('reactions reach members except actor; outsider 404; reply echoed', async () => {
    const create = await owner.call('POST', '/gdms', {
      name: 'tepki-grup',
      member_ids: [member.userId],
      wrapped_keys: [
        { user_id: owner.userId, wrapped_key: W('G') },
        { user_id: member.userId, wrapped_key: W('H') },
      ],
    });
    expect(create.status).toBe(201);
    const gdmId = ((await create.json()) as { channel: { id: string } }).channel.id;

    const sent = await member.call('POST', `/gdms/${gdmId}/messages`, { key_version: 1, nonce: NONCE, ciphertext: CT });
    const msg = ((await sent.json()) as { id: number }).id;

    const listener = await wsCollect(member.token);
    expect((await owner.call('POST', `/gdms/${gdmId}/messages/${msg}/reactions`, { emoji: '🎉' })).status).toBe(204);
    await new Promise((r) => setTimeout(r, 300));
    expect(listener.events).toContainEqual({
      type: 'reaction:update', scope: 'gdm', channel_id: gdmId, message_id: msg,
      emoji: '🎉', action: 'add', user_id: owner.userId, nick: owner.nick,
    });
    listener.close();

    const hist = ((await (await member.call('GET', `/gdms/${gdmId}/messages`)).json()) as { messages: HistMsg[] }).messages;
    expect(hist.find((m) => m.id === msg)!.reactions).toEqual([{ emoji: '🎉', count: 1, me: false }]);
    expect((await outsider.call('POST', `/gdms/${gdmId}/messages/${msg}/reactions`, { emoji: '🎉' })).status).toBe(404);

    const rep = await owner.call('POST', `/gdms/${gdmId}/messages`, {
      key_version: 1, nonce: NONCE, ciphertext: CT, reply_to: msg,
    });
    expect(rep.status).toBe(201);
    const replyId = ((await rep.json()) as { id: number }).id;
    const replyRow = ((await (await member.call('GET', `/gdms/${gdmId}/messages`)).json()) as { messages: HistMsg[] })
      .messages.find((m) => m.id === replyId)!;
    expect(replyRow.reply_to).toBe(msg);
    expect(replyRow.reply_nick).toBe(member.nick);

    expect((await owner.call('DELETE', `/gdms/${gdmId}/messages/${msg}/reactions?emoji=${encodeURIComponent('🎉')}`)).status).toBe(204);
    expect((await owner.call('DELETE', `/gdms/${gdmId}/messages/${msg}/reactions?emoji=${encodeURIComponent('🎉')}`)).status).toBe(404);
  });
});

describe('reaction cleanup on hard deletes', () => {
  it('community delete leaves no channel-scope reaction rows', async () => {
    const solo = await makeUser(srv.baseUrl, 'rc');
    const r = await solo.call('POST', '/communities', {
      name: 'silinecek',
      channels: [{ name: 'genel', type: 'text', wrapped_key: W('S') }],
    });
    const j = (await r.json()) as { community: { id: string }; channels: { id: string }[] };
    expect(
      (await solo.call('POST', `/communities/${j.community.id}/members`, {
        user_id: member.userId,
        wrapped_keys: [{ channel_id: j.channels[0]!.id, wrapped_key: W('A') }],
      })).status,
    ).toBe(204);
    const sent = await solo.call('POST', `/channels/${j.channels[0]!.id}/messages`, {
      key_version: 1, nonce: NONCE, ciphertext: CT,
    });
    const msg = ((await sent.json()) as { id: number }).id;
    expect((await member.call('POST', `/channels/${j.channels[0]!.id}/messages/${msg}/reactions`, { emoji: '👍' })).status).toBe(204);
    expect(rawCount('SELECT COUNT(*) c FROM reactions WHERE scope = ? AND message_id = ?', 'channel', msg)).toBe(1);

    expect((await solo.call('DELETE', `/communities/${j.community.id}`)).status).toBe(204);
    expect(rawCount('SELECT COUNT(*) c FROM reactions WHERE scope = ? AND message_id = ?', 'channel', msg)).toBe(0);
  });

  it('empty-GDM leave removes gdm reactions; account delete sweeps orphans', async () => {
    // boş grup: son ayrılan kanalı siler — tepkiler de gitmeli
    const create = await owner.call('POST', '/gdms', {
      name: 'son-kişi',
      member_ids: [member.userId],
      wrapped_keys: [
        { user_id: owner.userId, wrapped_key: W('G') },
        { user_id: member.userId, wrapped_key: W('H') },
      ],
    });
    const gid = ((await create.json()) as { channel: { id: string } }).channel.id;
    const sent = await member.call('POST', `/gdms/${gid}/messages`, { key_version: 1, nonce: NONCE, ciphertext: CT });
    const msg = ((await sent.json()) as { id: number }).id;
    expect((await member.call('POST', `/gdms/${gid}/messages/${msg}/reactions`, { emoji: '👍' })).status).toBe(204);
    expect((await member.call('POST', `/gdms/${gid}/leave`, {})).status).toBe(204);
    expect((await owner.call('POST', `/gdms/${gid}/leave`, {})).status).toBe(204);
    expect(rawCount('SELECT COUNT(*) c FROM reactions WHERE scope = ? AND message_id = ?', 'gdm', msg)).toBe(0);

    // hesap silme: mesajlar hard-silinir, yetim tepkiler süpürülür
    const gone = await makeUser(srv.baseUrl, 'rg');
    const r = await gone.call('POST', '/communities', {
      name: 'giden',
      channels: [{ name: 'genel', type: 'text', wrapped_key: W('S') }],
    });
    const j = (await r.json()) as { community: { id: string }; channels: { id: string }[] };
    expect(
      (await gone.call('POST', `/communities/${j.community.id}/members`, {
        user_id: member.userId,
        wrapped_keys: [{ channel_id: j.channels[0]!.id, wrapped_key: W('A') }],
      })).status,
    ).toBe(204);
    const sent2 = await gone.call('POST', `/channels/${j.channels[0]!.id}/messages`, {
      key_version: 1, nonce: NONCE, ciphertext: CT,
    });
    const msg2 = ((await sent2.json()) as { id: number }).id;
    expect((await member.call('POST', `/channels/${j.channels[0]!.id}/messages/${msg2}/reactions`, { emoji: '👍' })).status).toBe(204);
    expect((await gone.call('DELETE', '/users/me')).status).toBe(200);
    expect(rawCount('SELECT COUNT(*) c FROM reactions WHERE scope = ? AND message_id = ?', 'channel', msg2)).toBe(0);
  });
});