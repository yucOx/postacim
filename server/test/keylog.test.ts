// Key transparency: register deftere append-only satır düşürür; zincir
// doğrulanabilir, sayfalanabilir; hesap silinse de kanıt kalır; UPDATE/DELETE
// kod yolu yoktur.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { b64 } from '../../web/src/crypto/bytes';
import { makeUser, startServer, type TestServer, type TestUser } from './helpers';

let srv: TestServer;

const GENESIS = '0'.repeat(64);
const entryHash = (prev: string, userId: string, key: string): string =>
  crypto.createHash('sha256').update(`${prev}\x00${userId}\x00${key}`).digest('hex');

interface Entry {
  id: number;
  user_id: string;
  public_key: string;
  prev_hash: string;
  entry_hash: string;
  created_at: number;
}
interface Page {
  entries: Entry[];
  head: { id: number; entry_hash: string } | null;
}

const getLog = async (query = ''): Promise<Page> => {
  const r = await fetch(`${srv.baseUrl}/keys/log${query}`); // bilinçli auth'suz — public
  expect(r.status).toBe(200);
  return (await r.json()) as Page;
};

beforeAll(async () => {
  srv = await startServer();
});
afterAll(() => srv.stop());

describe('GET /keys/log (anahtar defteri)', () => {
  let alice: TestUser, bob: TestUser, carol: TestUser;

  it('register → genesis satırı düşer, entry_hash doğrulanır', async () => {
    alice = await makeUser(srv.baseUrl, 'kloga');
    const { entries, head } = await getLog();
    expect(entries).toHaveLength(1);
    const e = entries[0]!;
    expect(e.id).toBe(1);
    expect(e.user_id).toBe(alice.userId);
    expect(e.public_key).toBe(b64(alice.id.publicKey));
    expect(e.prev_hash).toBe(GENESIS);
    expect(e.entry_hash).toBe(entryHash(GENESIS, alice.userId, e.public_key));
    expect(head).toEqual({ id: 1, entry_hash: e.entry_hash });
  });

  it('ikinci kayıt zinciri büyütür — prev_hash öncekinin entry_hash’i', async () => {
    bob = await makeUser(srv.baseUrl, 'klogb');
    const { entries, head } = await getLog();
    expect(entries).toHaveLength(2);
    const [e1, e2] = entries;
    expect(e2!.id).toBe(2);
    expect(e2!.prev_hash).toBe(e1!.entry_hash);
    expect(e2!.entry_hash).toBe(entryHash(e1!.entry_hash, e2!.user_id, e2!.public_key));
    expect(head).toEqual({ id: 2, entry_hash: e2!.entry_hash });
  });

  it('after/limit sayfalama — head her sayfada güncel', async () => {
    const p1 = await getLog('?after=0&limit=1');
    expect(p1.entries).toHaveLength(1);
    expect(p1.entries[0]!.id).toBe(1);
    expect(p1.head!.id).toBe(2); // son sayfada olmasa da head güncel

    const p2 = await getLog('?after=1');
    expect(p2.entries).toHaveLength(1);
    expect(p2.entries[0]!.id).toBe(2);
    expect(p2.head).toEqual(p1.head);

    const p3 = await getLog('?after=999');
    expect(p3.entries).toHaveLength(0);
    expect(p3.head!.id).toBe(2);
  });

  it('limit kenarları: 1..500 dışı kırpılır', async () => {
    const p = await getLog('?limit=0'); // alt sınır → 1
    expect(p.entries).toHaveLength(1);
    const q = await getLog('?limit=9999'); // üst sınır → 500'e kırpılır
    expect(q.entries).toHaveLength(2);
    const r = await getLog('?limit=ceviz'); // sayı değil → default 200
    expect(r.entries).toHaveLength(2);
  });

  it('silinen hesabın defter satırı kalır — kanıt silinmez', async () => {
    carol = await makeUser(srv.baseUrl, 'klogc');
    const before = await getLog();
    expect(before.entries).toHaveLength(3);
    expect(before.entries[2]!.user_id).toBe(carol.userId);
    expect((await carol.call('DELETE', '/users/me')).status).toBe(200);
    const after = await getLog();
    expect(after.entries).toHaveLength(3); // satır yerinde — append-only
    expect(after.entries[2]!.user_id).toBe(carol.userId);
    expect(after.head).toEqual(before.head);
  });

  it('key_log’a giden tek yazı yolu INSERT — UPDATE/DELETE kod yolu yok', () => {
    const dir = path.resolve(__dirname, '../src');
    const files: string[] = [];
    const walk = (d: string): void => {
      for (const f of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, f.name);
        if (f.isDirectory()) walk(p);
        else if (f.name.endsWith('.ts')) files.push(p);
      }
    };
    walk(dir);
    for (const f of files) {
      const src = fs.readFileSync(f, 'utf8');
      for (const line of src.split('\n')) {
        if (!/key_log/.test(line)) continue;
        expect(
          /\b(UPDATE\s+key_log|DELETE\s+FROM\s+key_log)/i.test(line),
          `${f}: ${line.trim()}`,
        ).toBe(false);
      }
    }
  });
});