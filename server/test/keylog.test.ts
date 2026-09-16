// Key transparency: register deftere append-only satır düşürür; zincir
// doğrulanabilir, sayfalanabilir; hesap silinse de kanıt kalır; UPDATE/DELETE
// kod yolu yoktur. v15+: imza anahtarlı kayıtlar genişletilmiş hash formülü.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { b64 } from '../../web/src/crypto/bytes';
import { makeUser, startServer, type TestServer, type TestUser } from './helpers';

let srv: TestServer;

const GENESIS = '0'.repeat(64);
const entryHash = (prev: string, userId: string, key: string, sign?: string | null): string =>
  crypto
    .createHash('sha256')
    .update(sign ? `${prev}\x00${userId}\x00${key}\x00${sign}` : `${prev}\x00${userId}\x00${key}`)
    .digest('hex');

interface Entry {
  id: number;
  user_id: string;
  public_key: string;
  sign_public_key: string | null;
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
  let alice: TestUser, bob: TestUser, carol: TestUser, dave: TestUser;

  it('register → genesis satırı düşer, entry_hash doğrulanır', async () => {
    alice = await makeUser(srv.baseUrl, 'kloga');
    const { entries, head } = await getLog();
    expect(entries).toHaveLength(1);
    const e = entries[0]!;
    expect(e.id).toBe(1);
    expect(e.user_id).toBe(alice.userId);
    expect(e.public_key).toBe(b64(alice.id.publicKey));
    expect(e.sign_public_key).toBe(b64(alice.sign.signPublicKey));
    expect(e.prev_hash).toBe(GENESIS);
    expect(e.entry_hash).toBe(entryHash(GENESIS, alice.userId, e.public_key, e.sign_public_key));
    expect(head).toEqual({ id: 1, entry_hash: e.entry_hash });
  });

  it('ikinci kayıt zinciri büyütür — prev_hash öncekinin entry_hash’i', async () => {
    bob = await makeUser(srv.baseUrl, 'klogb');
    const { entries, head } = await getLog();
    expect(entries).toHaveLength(2);
    const [e1, e2] = entries;
    expect(e2!.id).toBe(2);
    expect(e2!.prev_hash).toBe(e1!.entry_hash);
    expect(e2!.entry_hash).toBe(entryHash(e1!.entry_hash, e2!.user_id, e2!.public_key, e2!.sign_public_key));
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

  it('POST /keys/sign eski hesap için imza anahtarı yayınlar — zincir büyür, key_blob değişir', async () => {
    // v15 öncesi hesabı simüle et: imzasız kayıtlı bir kullanıcı üret
    dave = await makeUser(srv.baseUrl, 'klogd');
    const Database = (await import('better-sqlite3')).default;
    const db = new Database(path.join(srv.dataDir, 'posta.db'));
    db.prepare('UPDATE users SET sign_public_key = NULL WHERE id = ?').run(dave.userId);
    db.prepare('DELETE FROM key_log WHERE user_id = ?').run(dave.userId);
    db.close();
    const before = await getLog();
    const lastBefore = before.entries[before.entries.length - 1]!;
    expect(lastBefore.user_id).not.toBe(dave.userId); // dave satırı yok

    const { deriveKeys } = await import('../../web/src/crypto/argon2');
    const { b64: b64u } = await import('../../web/src/crypto/bytes');
    const { sealIdentityBlob, generateSignIdentity } = await import('../../web/src/crypto/identity');
    const real = await deriveKeys(dave.password, dave.salt);
    const newSign = generateSignIdentity();
    const newBlob = sealIdentityBlob(dave.id.privateKey, real.kek, newSign.signPrivateKey);

    const bad = await dave.call('POST', '/keys/sign', {
      sign_public_key: b64u(newSign.signPublicKey),
      key_blob: newBlob,
      auth_material: b64u(dave.id.privateKey.slice(0, 32)),
    });
    expect(bad.status).toBe(401); // yanlış auth material — yayın + blob değişimi reddedilir

    const good = await dave.call('POST', '/keys/sign', {
      sign_public_key: b64u(newSign.signPublicKey),
      key_blob: newBlob,
      auth_material: b64u(real.authMaterial),
    });
    expect(good.status).toBe(204);

    const after = await getLog();
    const row = after.entries[after.entries.length - 1]!;
    expect(row.user_id).toBe(dave.userId);
    expect(row.sign_public_key).toBe(b64u(newSign.signPublicKey));
    expect(row.public_key).toBe(b64u(dave.id.publicKey));
    expect(row.entry_hash).toBe(entryHash(row.prev_hash, row.user_id, row.public_key, row.sign_public_key));
    expect(after.head).toEqual({ id: row.id, entry_hash: row.entry_hash });
    // key_blob gerçekten güncellendi + defterde olmayan public key girmez
    const rowDb = new Database(path.join(srv.dataDir, 'posta.db'));
    const u = rowDb.prepare('SELECT sign_public_key, key_blob FROM users WHERE id = ?').get(dave.userId) as {
      sign_public_key: string;
      key_blob: string;
    };
    rowDb.close();
    expect(u.sign_public_key).toBe(b64u(newSign.signPublicKey));
    expect(u.key_blob).toBe(newBlob);
  });

  it('key_log’a giden tek yazı yolu INSERT — UPDATE/DELETE kod yolu yok', () => {    const dir = path.resolve(__dirname, '../src');
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