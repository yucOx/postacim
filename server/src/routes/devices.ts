// Faz 7 — çoklu cihaz yönetimi.
//
// Sunucu private key saklamaz; kimlik blob'u primary cihazdadır. Bu uçlar
// yalnız public key'leri + cihaz adını + linking durumunu yönetir. Linking
// akışı WS üzerinden yürür (docs/faz7-multidevice-design.md §"Linking
// protokolü"): joinee ephemeral public'ını gönderir, primary onaylar,
// joinee kimliğini yazar. Sunucu opak relay + minimal state — hiçbir
// noktada private key ya da kimlik blob'u sunucudan geçmez.
import type { FastifyInstance } from 'fastify';
import crypto from 'node:crypto';
import { db } from '../db.js';
import { hub } from '../ws/hub.js';
import { appendKeyLog } from './keys.js';

export interface DeviceRow {
  id: string;
  user_id: string;
  name: string;
  x25519_public_key: string;
  ed25519_public_key: string | null;
  is_primary: number;
  linked_at: number;
  last_seen_at: number | null;
  revoked_at: number | null;
}

export function deviceList(userId: string): DeviceRow[] {
  return db
    .prepare(
      'SELECT id, user_id, name, x25519_public_key, ed25519_public_key, is_primary, linked_at, last_seen_at, revoked_at FROM users_devices WHERE user_id = ? AND revoked_at IS NULL ORDER BY is_primary DESC, linked_at',
    )
    .all(userId) as DeviceRow[];
}

/** joinee'in göndereceği device_id → henüz yazılmamışken üretilir (client
 *  bekler). Authed user'ın primary cihazı olmalı, aksi halde cihaz iptal
 *  edemez. (Joinee'ler yetkisiz.) */
export function requirePrimaryDevice(userId: string): DeviceRow {
  const row = db
    .prepare(
      "SELECT id, user_id, name, x25519_public_key, ed25519_public_key, is_primary, linked_at, last_seen_at, revoked_at FROM users_devices WHERE user_id = ? AND is_primary = 1 AND revoked_at IS NULL",
    )
    .get(userId) as DeviceRow | undefined;
  if (!row) throw new Error('primary cihaz bulunamadı');
  return row;
}

// --- in-memory linking state: token → ephemeral pub + name + joinee user ---
// Redis gerektirmez (küçük deploy); süre 10 dk, sonra düşer. Joinee
// ephemeral public'ı + adı saklanır; primary onayında bu bilgiyle imza
// üretir. Sunucu private key saklamaz — yalnız public.
interface PendingLink {
  userId: string;
  deviceName: string;
  ephemeralPub: string;
  createdAt: number;
}
const PENDING_TTL_MS = 10 * 60 * 1000;
const pendingLinks = new Map<string, PendingLink>();

function gcPending(): void {
  const cutoff = Date.now() - PENDING_TTL_MS;
  for (const [k, v] of pendingLinks) if (v.createdAt < cutoff) pendingLinks.delete(k);
}

export async function deviceRoutes(app: FastifyInstance): Promise<void> {
  // Aktif cihaz listesi (id, name, public keys, is_primary, linked_at, last_seen_at)
  app.get(
    '/devices',
    { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } },
    async (req) => ({ devices: deviceList(req.user.id) }),
  );

  // 1) Joinee: ephemeral X25519 keypair + cihaz adı → opak link_token.
  //    Sunucu WS ile primary'a device:link_request frame'i yollar.
  app.post(
    '/devices/link/start',
    {
      config: { rateLimit: { max: 5, timeWindow: '1 hour' } },
      schema: {
        body: {
          type: 'object',
          required: ['name', 'ephemeral_pub'],
          additionalProperties: false,
          properties: {
            name: { type: 'string', minLength: 1, maxLength: 64 },
            ephemeral_pub: { type: 'string', minLength: 44, maxLength: 44 },
          },
        },
      },
    },
    async (req, reply) => {
      gcPending();
      const { name, ephemeral_pub } = req.body as { name: string; ephemeral_pub: string };
      const token = crypto.randomBytes(24).toString('base64url');
      pendingLinks.set(token, {
        userId: req.user.id,
        deviceName: name,
        ephemeralPub: ephemeral_pub,
        createdAt: Date.now(),
      });
      // primary cihaza bildirim — yalnız tek bir primary var
      const primary = requirePrimaryDevice(req.user.id);
      hub.sendToUser(req.user.id, {
        type: 'device:link_request',
        device_id: token, // joinee'ı bu tokenla eşleştirir
        device_name: name,
        ephemeral_pub: ephemeral_pub,
        primary_device_id: primary.id,
      });
      return reply.code(201).send({ link_token: token });
    },
  );

  // 2) Primary: onay. Sunucu primary'ın onayladığını kaydeder (pending →
  //    approved). Joinee finish'te görür. Burada private key YOK — primary
  //    client'ı kendi tarafında shared secret türetip onay imzası yapar;
  //    sunucu yalnız approval'ı taşır.
  app.post(
    '/devices/link/approve',
    {
      config: { rateLimit: { max: 10, timeWindow: '1 hour' } },
      schema: {
        body: {
          type: 'object',
          required: ['link_token', 'approval'],
          additionalProperties: false,
          properties: {
            link_token: { type: 'string', minLength: 32, maxLength: 64 },
            // primary'ın Ed25519 imzasıyla imzalanmış approval blob'u
            // (opak base64); sunucu yorumlamaz, joinee'e taşır
            approval: { type: 'string', minLength: 64, maxLength: 512 },
          },
        },
      },
    },
    async (req, reply) => {
      gcPending();
      const { link_token, approval } = req.body as { link_token: string; approval: string };
      const pending = pendingLinks.get(link_token);
      if (!pending) return reply.code(404).send({ error: 'link bulunamadı veya süresi doldu' });
      // token'ı sil — tek kullanımlık
      pendingLinks.delete(link_token);
      // joinee'e onay frame'i
      hub.sendToUser(pending.userId, {
        type: 'device:link_approved',
        link_token,
        approval,
      });
      return reply.code(204).send();
    },
  );

  // 3) Joinee: kimliğini sunucuya yazar. Cihaz public key'leri + ad +
  //    link_token. Sunucu pending'ten doğrular, device_id üretir,
  //    users_devices'e ekler.
  app.post(
    '/devices/link/finish',
    {
      config: { rateLimit: { max: 5, timeWindow: '1 hour' } },
      schema: {
        body: {
          type: 'object',
          required: ['link_token', 'name', 'x25519_public_key', 'ed25519_public_key'],
          additionalProperties: false,
          properties: {
            link_token: { type: 'string', minLength: 32, maxLength: 64 },
            name: { type: 'string', minLength: 1, maxLength: 64 },
            x25519_public_key: { type: 'string', minLength: 44, maxLength: 44 },
            ed25519_public_key: { type: 'string', minLength: 44, maxLength: 44 },
          },
        },
      },
    },
    async (req, reply) => {
      const { link_token, name, x25519_public_key, ed25519_public_key } = req.body as {
        link_token: string;
        name: string;
        x25519_public_key: string;
        ed25519_public_key: string;
      };
      const pending = pendingLinks.get(link_token);
      if (!pending) return reply.code(404).send({ error: 'link bulunamadı veya süresi doldu' });
      if (pending.userId !== req.user.id) return reply.code(403).send({ error: 'yetkisiz' });
      pendingLinks.delete(link_token);
      const deviceId = crypto.randomUUID();
      db.prepare(
        'INSERT INTO users_devices(id, user_id, name, x25519_public_key, ed25519_public_key, is_primary, linked_at) VALUES (?, ?, ?, ?, ?, 0, ?)',
      ).run(deviceId, req.user.id, name, x25519_public_key, ed25519_public_key, Date.now());
      // primary'a "bağlandı" bildirimi (UI kapatma için)
      hub.sendToUser(req.user.id, { type: 'device:link_completed', device_id: deviceId });
      return reply.code(201).send({ device_id: deviceId });
    },
  );

  // 4) Cihaz iptali — primary only. Cihazı soft-delete + identity rotation:
  //    kullanıcının X25519 + Ed25519 anahtarları YENİLENİR (istemci
  //    tetikler), tüm peer'lara yeni public key bildirilir. Bu uç yalnız
  //    iptal state'ini işaretler + key_log'a yeni satır hazırlığı için
  //    iskelet sunar — gerçek rewrap client'tadır (tüm peer'lara yeni
  //    public key bildirimi dahil). Spec §"Cihaz iptali".
  app.post(
    '/devices/:id/revoke',
    {
      config: { rateLimit: { max: 10, timeWindow: '1 hour' } },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const device = db
        .prepare(
          'SELECT id, user_id, name, x25519_public_key, ed25519_public_key, is_primary, linked_at, last_seen_at, revoked_at FROM users_devices WHERE id = ? AND user_id = ?',
        )
        .get(id, req.user.id) as DeviceRow | undefined;
      if (!device) return reply.code(404).send({ error: 'cihaz bulunamadı' });
      if (device.is_primary) return reply.code(400).send({ error: 'primary cihaz iptal edilemez' });
      if (device.revoked_at) return reply.code(409).send({ error: 'cihaz zaten iptal' });
      const tx = db.transaction(() => {
        db.prepare('UPDATE users_devices SET revoked_at = ? WHERE id = ?').run(Date.now(), id);
        // identity rotation: kullanıcının primary public key'i değişmedi
        // henüz — istemci /auth/rotate-identity ile yeni keypair üretip
        // burada kaydeder + peer'lara yayar. Bu uç yalnız cihazı siler.
      });
      tx();
      // iptal edilen cihazın sonraki oturumları da düşer
      // (her oturum açılışında /auth/me cihaz doğrular — TODO: devreye
      // alındığında eklenir; Faz 7 MVP'de mevcut oturum canlı kalır ama
      // yeni oturum açamaz)
      hub.sendToUser(req.user.id, { type: 'device:revoked', device_id: id });
      return reply.code(204).send();
    },
  );
}

// Identity rotation uçları — primary cihaz kendi keypair'ini yeniler.
// Mevcut Faz 1 sign_public_key publish'i (/keys/sign) bu akışı yeniden
// kullanır; ek bir /auth/rotate-identity eklemek gerekirse buraya gelir.
export function recordIdentityRotation(
  userId: string,
  newPublicKey: string,
  newSignPublicKey: string,
): void {
  // users.public_key + sign_public_key'i güncelle + key_log'a yeni satır
  const tx = db.transaction(() => {
    db.prepare('UPDATE users SET public_key = ?, sign_public_key = ? WHERE id = ?').run(
      newPublicKey,
      newSignPublicKey,
      userId,
    );
    appendKeyLog(userId, newPublicKey, newSignPublicKey);
  });
  tx();
}
