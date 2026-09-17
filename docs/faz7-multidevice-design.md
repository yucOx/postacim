# Faz 7 — Çoklu cihaz (multi-device) tasarımı

> MLS tetikleyicisi yeniden doğrulandı (Faz 6 kapatılırken): openmls-wasm
> hâlâ "Experiment", `wasm32-unknown-unknown` ana tabloda "Unsupported, but
> built on CI", IndexedDB storage dokümante değil, stabil sürüm + storage
> docs + resmî npm paketi yok. Faz 5 (c+) kararı korundu: hafif çift-DH
> ratchet + per-cihaz uzantısı.

## Kapsam

- **Kapatır:** "Tek kimlik blob'u (cihaz iptali yok)" (README Bilinen sınırlar)
- **Açar:** cihaz listesi UI, cihaz linking (WS tabanlı onay, MVP), cihaz iptali
  = identity rotation, per-cihaz DH step state, per-cihaz fingerprint

## Cihaz modeli

- Her cihaz bağımsız X25519 + Ed25519 keypair taşır (kendi blob'u, kendi
  IndexedDB'si, kendi DH step state'i)
- Kullanıcı kimliği = `users` satırı (mevcut) + `users_devices` tablosu (yeni,
  v17)
- **Primary cihaz**: hesabı ilk açan cihaz (kayıt anındaki) — yetki sahibi:
  diğer cihazları onaylar/iptal eder
- **Linked cihaz**: primary tarafından onaylanmış ek cihazlar — mesaj
  okuyabilir/yazabilir, cihaz iptal edemez (yetki yalnız primary'da)

### Geriye uyumluluk

- `users.public_key` / `users.sign_public_key` korunur (eski blob v2
  okunmaya devam eder)
- Eski tek-cihaz hesaplar `users_devices`'e otomatik backfill ile "primary"
  cihaz olarak yazılır (migration v17)
- Yeni cihazlar eklenince peer'lar onları `users_devices.public_key` üzerinden
  tanır (bootstrap'taki `public_keys` map'i cihaz public key'lerini de içerir)

## v3 blob (genişletilmiş kimlik blob'u)

Mevcut v2 = `0x02 ‖ X25519 priv (32) ‖ Ed25519 priv (64)`.
**v3 = `0x03 ‖ X25519 priv (32) ‖ Ed25519 priv (64) ‖ device_id (16B random)`**.

- `device_id` UUIDv4-benzeri 16 byte — cihazı tekil tanımlar
- v1/v2 blob'lar hâlâ açılır; `device_id` eksikse cihaz primary sayılır
  (geriye uyumluluk şartı: eski kullanıcılar cihaz iptaline kadar primary)

## Linking protokolü (MVP — WS tabanlı onay)

İki cihaz aynı server'a bağlı ve authed. QR yerine WS kullanılır çünkü:
- QR kamera erişimi ister; sunucu üzerinden geçen eşleşme daha kolay UX
- Aynı tehdit modeli (sunucu opak relay, kriptografik doğrulama alıcıda)

**Akış:**

1. **Joinee** (eklenecek cihaz): `POST /devices/link/start` body
   `{ name, ephemeral_pub }` → server `link_token` (opak) döner + WS ile
   primary'a `device:link_request` frame yayınlar (yalnız primary'ın
   kullanıcısına)
2. **Primary** (`device:link_request` alır): modal gösterir — joinee'in
   cihaz adı + fingerprint (ephemeral pub hash). Onaylarsa:
   `POST /devices/link/approve { link_token }` → server primary'ın mevcut
   X25519 private'ıyla DH türetip (`X25519(primary_priv, joinee_ephemeral_pub)`)
   `shared_secret` üretir, primary'ın Ed25519'iyle imzalanmış approval
   mesajı döner + WS ile joinee'e `device:link_approved` frame yayınlar
3. **Joinee** (`device:link_approved` alır): kendi tarafında da aynı DH'yi
   türetir (`X25519(joinee_ephemeral_priv, primary_pub)`), approval'ı
   imzadan doğrular, shared secret'i türetir (aynı 32B). Sonra
   `POST /devices/link/finish { link_token, name, x25519_public_key,
   ed25519_public_key, encrypted_blob }` ile kendi kimliğini sunucuya
   yazar — `encrypted_blob` = cihaz KEK'i (PRF'den) veya şifre KEK'i ile
   sarılı v3 blob (mevcut devicekey.ts mantığı, identity için)

**Not:** MVP'de linking iki cihazın aynı anda açık olmasını gerektirir.
Aynı cihazda birden çok hesap açılması zaten yasak (cihaz başına tek
oturum); linking de bu varsayıma uyar.

## Cihaz iptali (identity rotation)

`POST /devices/:id/revoke`:

- Kullanıcının **primary** cihazında yeni X25519 + Ed25519 keypair üret
- Tüm DM/kanal/gdm `wrapped_keys` yeni public key'e yeniden sar
- `key_log`'a yeni satır (imza anahtarı dahil) — public key değişimi kanıtlı
- Tüm peer'lara WS ile yeni public key bildirimi (mevcut `dh_update`
  frame'i genişletilir veya yeni `device:rotated` frame'i)
- İptal edilen cihaz artık yeni mesajları açamaz (eski private'ı yeni DH
  çıktısını üretemez), eski mesajlar eski anahtarla okunabilir kalır (eski
  epoklar `wrapped_keys`'te mevcut)

**Yetki:** yalnız primary cihaz revoke edebilir. Joinee'lerin revoke
yetkisi YOK.

## Per-cihaz DH step state

Mevcut `loadDhStep(channelId, version)` → `localStorage.pgv.dhstep.${channelId}.${version}`.
Yeni: `loadDhStep(channelId, version, deviceId)` → ad alanı
`pgv.dhstep.${channelId}.${version}.${deviceId}`.

- Primary cihaz (eski hesaplar): `deviceId = 'primary'` alias'ı kullanır
  (geriye uyumluluk — mevcut ad alanıyla birebir aynı yere yazar)
- Yeni cihazlar: `deviceId = gerçek cihaz UUID`
- Aynı kullanıcının farklı cihazları farklı ephemeral → farklı DH pub → DH
  çıktısı farklı → alıcı bunları ayrı gönderici sayar (header'daki DH pub
  farklı). `dh_update` zaten her cihaz bağımsız pin'i destekler (5d).

## Per-cihaz fingerprint

Mevcut `fingerprintPair(myPublicKey, peerPublicKey, mySignPublicKey, peerSignPublicKey)`.
Aynı mantık — peer'ın `users_devices.public_key` + `users_devices.sign_public_key`
ile çalışır. Primary ve joinee'lerin farklı sayıları olur (farklı X25519 +
Ed25519 çiftleri).

UI: Ayarlar → Güvenlik → "Cihazlar" sekmesi → her cihaz için kısa fingerprint
(4 grup × 4 hex) + "bu cihazın tam güvenlik numarası" toggle.

## Sunucu invariant'ları (korunur)

- **Sunucu plaintext görmez**: linking flow'da `encrypted_blob` opaque;
  approve/finish mesajlarında yalnız public key alanları
- **Sunucu private key saklamaz**: `users_devices` yalnız public key'ler +
  cihaz adı + cihaz meta'sı; kimlik blob'u primary'da
- **WS relay only**: `device:link_request` / `device:link_approved` /
  `device:rotated` çerçeveleri sunucu tarafından yorumlanmaz

## DB şeması (v17)

```sql
CREATE TABLE users_devices(
  id TEXT PRIMARY KEY,             -- cihaz UUID
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,              -- kullanıcının verdiği cihaz adı
  x25519_public_key TEXT NOT NULL,
  ed25519_public_key TEXT NOT NULL,
  is_primary INTEGER NOT NULL DEFAULT 0,  -- 1 = hesabı açan cihaz
  linked_at INTEGER NOT NULL,      -- ilk kayıt/linking zamanı
  last_seen_at INTEGER,            -- WS bağlantısı (opsiyonel, güncelleme)
  revoked_at INTEGER               -- iptal zamanı (NULL = aktif)
);
CREATE INDEX idx_users_devices_user ON users_devices(user_id) WHERE revoked_at IS NULL;
```

**Backfill (v17'in CREATE TABLE'ından sonra):** `INSERT INTO users_devices
SELECT ...` mevcut kullanıcılar için primary satır. `id = 'legacy_primary'`
veya `randomUUID()` — geriye uyumluluk için stable `id` üretmek lazım
(identity blob'taki `device_id` ile eşleşme).

## API yüzeyleri

- `GET /api/devices` — kullanıcının aktif cihaz listesi (id, name, public keys, is_primary, linked_at, last_seen_at). Authed.
- `POST /api/devices/link/start` — joinee ephemeral public + name → link_token. Authed.
- `POST /api/devices/link/approve` — primary onayı (link_token). Authed + primary only.
- `POST /api/devices/link/finish` — joinee identity submission (link_token, public keys, encrypted_blob). Authed.
- `POST /api/devices/:id/revoke` — cihaz iptali (rekey tetikler). Authed + primary only.

## WS frame'leri

- `device:link_request { device_name, ephemeral_pub, fingerprint }` — primary'a
- `device:link_approved { approval (signed), shared_secret_hint }` — joinee'e
- `device:rotated { new_public_key, new_sign_public_key }` — tüm peer'lara
  (kullanıcının key_log'una yeni satır düştü)

## Threat model — neyi kapatır, neyi kapatmaz

**Kapanır:** tek kimlik blob'u (cihaz iptali yok) — cihaz kaybında hesap
kilitli kalır riski. İptal edilen cihaz yeni mesajları okuyamaz.

**Dürüst sınırlar (kapanmaz):**
- Linking sırasında iki cihaz aynı anda açık olmalı (MVP). QR tabanlı
  async linking roadmap'te (out-of-band verification için ek protokol gerekir)
- Primary cihazın tamamen kaybı = hesap erişilemez (mevcut tek-cihaz model
  ile aynı risk). Kurtarma ifadesi hâlâ tek çıkış (identity'yi yeni cihazda
  geri yükle)
- Sunucu primary'ın onayını taklit edemez (Ed25519 imzası doğrulanır) AMA
  primary'ı zaten ele geçirmişse sunucu joinee'leri de onaylatabilir (bilinen
  cihaz güvenlik sınırı)
- Per-cihaz DH step state reload sonrası kaybolur (5c ile aynı) — yeni
  adım otomatik tetiklenir

## Testler

- v3 blob açma/kapama + geriye uyumluluk (v1/v2 açılır)
- Linking flow: ephemeral DH türetme, shared secret iki tarafta aynı,
  imza doğrulama, sahte primary reddi
- Cihaz iptali: rekey tüm kanallarda, iptal edilen cihaz yeni mesajı
  açamaz (negatif)
- Per-cihaz DH step: aynı channel + farklı deviceId = farklı ephemeral
- Per-cihaz fingerprint: iki farklı cihaz = farklı sayı
- Sunucu: `users_devices` CRUD, primary constraint, revoke rekey kanıtı
- WS relay: link_request yalnız primary'a, link_approved yalnız joinee'e

## Spec uyumu

- Mevcut F5 per-sender modeli: cihaz = ayrı gönderici sayılır (farklı DH
  pub başlığı). peer tarafında `signkeys` zaten birden çok public kabul
  eder (5d test vektörü).
- Mevcut F5d dh_update: cihaz iptalinde tetiklenen `device:rotated` mevcut
  `dh_update` duyurusuyla aynı kanaldan gider (genişletilmiş payload).
- Mevcut F6 key gossip: her cihaz kendi keylog kontrolünü yapar
  (`runKeyLogCheck` userId + publicKey ile, cihaz public key'i parametre).
