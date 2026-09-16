import type { FastifyInstance } from 'fastify';
import argon2 from 'argon2';
import crypto from 'node:crypto';
import { db } from '../db.js';

// Anahtar şeffaflığı: public key'ler append-only hash zincirinde (key_log).
// Amaç bir kötü sunucunun üye key'ini fark ettirmeden değiştirmesini
// imkânsız değil ama KANITSIZ kılmak — her değişim zincirde kalıcı bir iz
// bırakır, istemci çelişkiyi görür (web/src/lib/keytransparency.ts). Tehdit
// modeli README'de: sunucu key dağıtım noktası olduğundan MITM olabilir.
//
// DÜRÜST SINIR: bu tam anti-forking DEĞİLDİR — sunucu iki istemciye iki
// farklı zincir gösterebilir (view-splitting). Burada olan: zincir bütünlüğü
// + head'in bant dışı karşılaştırılması + kendi kaydı kontrolü. İstemciler
// arası gossip roadmap'te.

/** genesis — zincirin ilk prev_hash'i */
export const GENESIS_HASH = '0'.repeat(64);

/** entry_hash = sha256(prev_hash || '\x00' || user_id || '\x00' || public_key)
 *  — imza anahtarı varsa sonuna bir segment daha: prev ‖ '\0' ‖ user ‖ '\0'
 *  ‖ public ‖ '\0' ‖ sign_public. İstemci aynı formülü doğrulamak için
 *  kullanır, byte byte aynı olmalı. Eski satırlar (sign yok) eski formülle. */
export function entryHash(prevHash: string, userId: string, publicKey: string, signPublicKey?: string | null): string {
  const base = `${prevHash}\x00${userId}\x00${publicKey}`;
  return crypto
    .createHash('sha256')
    .update(signPublicKey ? `${base}\x00${signPublicKey}` : base)
    .digest('hex');
}

/** deftere bir satır ekle — sunucudaki TEK yazı yolu (INSERT). Kimlik public
 *  key'i hayat boyu değişmez; ileride key değişimi desteklenirse yeni satır
 *  yine buradan düşer (API versiyonlu, eski istemci kırılmaz). */
export function appendKeyLog(userId: string, publicKey: string, signPublicKey?: string | null): void {
  const head = db
    .prepare('SELECT entry_hash FROM key_log ORDER BY id DESC LIMIT 1')
    .get() as { entry_hash: string } | undefined;
  const prev = head?.entry_hash ?? GENESIS_HASH;
  db.prepare(
    'INSERT INTO key_log(user_id, public_key, sign_public_key, prev_hash, entry_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(userId, publicKey, signPublicKey ?? null, prev, entryHash(prev, userId, publicKey, signPublicKey), Date.now());
}

/** bu özellikten önce kaydolmuş hesaplar için de birer satır — 'kendi kaydı'
 *  kontrolü herkes için çalışsın. Boot'ta çağrılır; eksiği olan kalmayınca
 *  no-op. Yine de sadece ekler. */
export function backfillKeyLog(): void {
  const rows = db
    .prepare(
      'SELECT id, public_key FROM users WHERE id NOT IN (SELECT user_id FROM key_log) ORDER BY created_at',
    )
    .all() as { id: string; public_key: string }[];
  for (const u of rows) appendKeyLog(u.id, u.public_key);
}

export async function keyRoutes(app: FastifyInstance): Promise<void> {
  // Defter herkes tarafından okunabilir (kdf-params public — bu da öyle
  // olsun; giriş yapmamış istemci de zinciri doğrulayabilsin). after/limit
  // sayfalı; head her sayfada güncel.
  app.get(
    '/keys/log',
    { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (req) => {
      const q = req.query as { after?: string; limit?: string };
      const after = Math.max(0, Number.parseInt(q.after ?? '0', 10) || 0);
      const parsed = Number.parseInt(q.limit ?? '200', 10);
      const limit = Math.min(500, Math.max(1, Number.isNaN(parsed) ? 200 : parsed));
      const entries = db
        .prepare(
          'SELECT id, user_id, public_key, sign_public_key, prev_hash, entry_hash, created_at FROM key_log WHERE id > ? ORDER BY id ASC LIMIT ?',
        )
        .all(after, limit);
      const head = (db
        .prepare('SELECT id, entry_hash FROM key_log ORDER BY id DESC LIMIT 1')
        .get() as { id: number; entry_hash: string } | undefined) ?? null;
      return { entries, head };
    },
  );

  // Bu özellikten önce kaydolmuş hesaplar imza anahtarını buradan yayınlar:
  // Ed25519 public key deftere yazılır; KEK hâlâ RAM'deyken key_blob da v2'ye
  // yeniden sarılır. auth_material her durumda doğrulanır — yalnız çerez
  // ele geçirmiş bir oturum, mağdurun adına imza anahtarı yayınlayamaz.
  app.post(
    '/keys/sign',
    {
      config: { rateLimit: { max: 5, timeWindow: '1 hour' } },
      schema: {
        body: {
          type: 'object',
          required: ['sign_public_key', 'auth_material'],
          additionalProperties: false,
          properties: {
            sign_public_key: { type: 'string', minLength: 44, maxLength: 44 },
            key_blob: { type: 'string', minLength: 48, maxLength: 1024 },
            auth_material: { type: 'string', minLength: 44, maxLength: 44 },
          },
        },
      },
    },
    async (req, reply) => {
      const body = req.body as { sign_public_key: string; key_blob?: string; auth_material: string };
      const row = db
        .prepare('SELECT verifier, public_key FROM users WHERE id = ?')
        .get(req.user.id) as { verifier: string; public_key: string } | undefined;
      if (!row) return reply.code(404).send({ error: 'kullanıcı bulunamadı' });
      const ok = await argon2.verify(row.verifier, body.auth_material).catch(() => false);
      if (!ok) return reply.code(401).send({ error: 'şifre doğrulanamadı' });
      const tx = db.transaction(() => {
        if (body.key_blob) {
          db.prepare('UPDATE users SET sign_public_key = ?, key_blob = ? WHERE id = ?').run(
            body.sign_public_key,
            body.key_blob,
            req.user.id,
          );
        } else {
          db.prepare('UPDATE users SET sign_public_key = ? WHERE id = ?').run(body.sign_public_key, req.user.id);
        }
        appendKeyLog(req.user.id, row.public_key, body.sign_public_key);
      });
      tx();
      return reply.code(204).send();
    },
  );
}