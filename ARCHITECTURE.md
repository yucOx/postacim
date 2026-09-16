# postacim — Mimari

Kod tabanının teknik referansı. Ürün vaadi ve tehdit modeli: [README.md](README.md). Görsel dil: [DESIGN.md](DESIGN.md).

## Genel akış

| Katman | Yığın | Sorumluluk |
|---|---|---|
| `web/` | React 19 + Vite + Zustand + libsodium (WASM) + hash-wasm | Tüm kripto tarayıcıda: anahtar türetme, sarma, mesaj şifreleme. Sunucuya yalnız opak blob |
| `server/` | Node 22 + Fastify + better-sqlite3 (WAL) | Oturum, üyelik, rate limit, sarılı anahtar dağıtımı, WS hub, LiveKit token. İçerik asla görmez |
| `livekit/` | LiveKit SFU (Docker) | Sesli/görüntülü medya rölesi. SFrame E2EE (HKDF → kanal anahtarı) — SFU bayt görür, çözemez |
| güvenlik yol haritası | [SECURITY-ROADMAP.md](SECURITY-ROADMAP.md) | Signal-parite programı (8 faz): Ed25519 imzalı mesajlar → disappearing → Tor rehberi → signed release → ratchet/MLS → key gossip → çoklu cihaz → audit hazırlığı. Her faz kendi docs + negatif testini getirir |

Akış: tarayıcı `web/` nginx'den yüklenir → `/api/*` server'a, `/ws` WS'e, `/livekit` SFU'ya reverse proxy. Oturum httpOnly `pgv_session` çereziyle taşınır (Bearer da kabul — testler/betikler). Canlı olaylar `/ws` üzerinden; mesaj gövdesi WS'te de şifreli gider.

## Anahtar yaşam döngüsü

1. Şifre → **Argon2id** (64 MiB, t=3, p=1, 64B çıktı; `web/src/crypto/argon2.ts`) — salt sunucudan (`GET /auth/kdf-params`, bilinmeyen nicke pseudo-salt)
2. 64B ikiye bölünür (`authStore.ts`): ilk 32B **authMaterial** → sunucuda argon2id verifier olarak saklanır (şifre gönderilmez); son 32B **KEK** — tarayıcıdan çıkmaz, memory-only (reload'da şifre yeniden istenir)
3. KEK, X25519 private key blob'unu açar: `key_blob` = nonce(24) ‖ XChaCha20-Poly1305(privateKey), AAD `postacim/v1/identity` (`crypto/identity.ts`)
4. Private key, kanal anahtarlarının **sealed-box** (`crypto_box_seal`) wrapped_key satırlarını açar (`unwrapMyKey`)
5. Kanal anahtarı (32B rastgele) → mesaj: **XChaCha20-Poly1305**, AAD = `scope:channelId:v<key_version>` + opsiyonel client binding (`crypto/message.ts`). Scope: `ch` (topluluk kanalı) / `dm` / `gdm`. Per-gönderici ratchet: `msg_key_i = H(root_i)`, zincir `H(epok anahtarı ‖ 'ratchet' ‖ sender_id)` kökünden türetilir — güncel kök sızarsa geçmiş korunur; plaintext boyut bucket padding'li (magic `0x01`/`0x02` v2 ratchet'li)
6. Gönderen atfı: v3 mesaj = AEAD çıktısı ‖ Ed25519 detached imza (imza girdisi = ciphertext baytları ‖ utf8(AAD) — AAD epok, index, binding'i kapsar). Alıcı, açmadan ÖNCE göndericinin anahtar defterinden gelen imza public key'iyle doğrular (`lib/signkeys.ts`); `SIGN_CUTOVER_MS`'ten sonraki imzasız mesajlar reddedilir. Eski hesaplar ilk açılışta/imza anahtarı yoksa ilk gönderimde Ed25519 çifti üretip `POST /keys/sign` ile yayınlar (blob v2 rewrap KEK RAM'deyken)
6. Client binding: UUID + client timestamp AAD'ye girer, sunucu `client_id` + `sent_at_client` kolonlarında echo eder → bant dışı tekrar oynatma ve timestamp sahteciliği tespit edilebilir (`lib/replay.ts` istemcide dedupe eder)
7. Ses/görüntü: aynı kanal anahtarı → LiveKit **SFrame** (HKDF türevi). DM araması aynı DM anahtarını kullanır
8. Epoklar: her sarma yeni `key_version`; eski satırlar kalır → rotasyon öncesi geçmiş okunur. Üye çıkarma = `needs_rekey` → kanal donar, staff rotate edene kadar yazı/ses/davet/üye ekleme kapalı
9. BIP-39 kurtarma: 12 kelime → aynı Argon2id zinciri (`crypto/recovery.ts`) → identity blob ikinci kez sarılır (`recovery_blob`). Şifre kaybı hesap kaybı değil; ikisi de kaybolursa hesap kurtarılamaz. v1 kurtarma blob'u imza private key taşımaz → kurtarma sonrası yeni imza kimliği üretilir (deftere yeni satır — kanıtlı key değişimi)
10. Cihaz kilidi (ops.): WebAuthn PRF'ten cihaz KEK'i → private key'ler + auth_material XChaCha20 ile sarılıp IndexedDB'ye (`pgv-device`, `crypto/devicekey.ts`) — F5'te parmak izi/PIN, şifre akışı fallback. Cihaz payload'u `sk` (Ed25519 private) içerir; eski kayıtlarda yoksa açılışta tamamlanır
11. Anahtar defteri: kayıtta public key + imza public key `key_log`'a append-only satır düşer; istemci boot'ta `GET /keys/log` ile zinciri doğrular, kendi kaydını kontrol eder, head'i localStorage'a yazar (`lib/keytransparency.ts`); doğrulanmış zincirdeki imza anahtarları `lib/signkeys.ts` haritasına beslenir (artımlı tazeleme: `loadBootstrap` tetikli)

## DB şeması

Kaynak: `server/src/migrations.ts` (v1–v15, sıralı, `schema_version` tablosuyla takip). Tüm tablolar `server/src/db.ts` açar (WAL, FK açık).

| Tablo | Kolonlar | Amaç | Yazan/okuyan route'lar |
|---|---|---|---|
| `users` | `id` TEXT PK · `nick` TEXT UNIQUE NOCASE · `kdf_salt` TEXT · `verifier` TEXT · `public_key` TEXT · `sign_public_key` TEXT (n) · `key_blob` TEXT · `created_at` INT · `recovery_salt`/`recovery_blob`/`recovery_verifier` TEXT (n) · `avatar_data` BLOB (n) · `avatar_updated_at` INT (n) | Kimlik + argon2id verifier + KEK altında sarılı private key blob'ları (v2 blob: X25519 + Ed25519 private); imza public key dağıtım kolonu; kurtarma ikinci sarma; küçük avatar | auth (register/login/password/recovery/recover), keys (sign), users (pubkey/avatar/me DELETE) |
| `key_log` | `id` INT PK AUTOINC · `user_id` TEXT (bilinçli FK değil — kanıt hesap silinse de kalır) · `public_key` TEXT · `sign_public_key` TEXT (n) · `prev_hash`/`entry_hash` TEXT · `created_at` INT · `idx_key_log_user` | Append-only public key defteri; `entry_hash = sha256(prev_hash ‖ '\x00' ‖ user_id ‖ '\x00' ‖ public_key)` (imza anahtarı varsa sonuna `‖ '\x00' ‖ sign_public_key`), genesis 64×'0' | keys (appendKeyLog — tek yazı yolu, yalnız INSERT), auth (register), boot (backfill), users (me DELETE dokunmaz) |
| `sessions` | `token_hash` TEXT PK (sha256) · `user_id` FK · `expires_at` INT · `created_at` INT | Oturum tokenları — ham token hiçbir yerde durmaz | auth (login/logout/password/recover), tüm auth hook (`index.ts`), janitor `pruneSessions` saatlik |
| `communities` | `id` TEXT PK · `name` TEXT · `owner_id` FK · `created_at` INT · `join_kdf_salt`/`join_verifier` TEXT (n) | Topluluk + opsiyonel katılım şifresi argon2 verifier'ı | communities (create/join-password), bootstrap |
| `members` | (`community_id`,`user_id`) PK · `role` CHECK(owner/admin/member) · `joined_at` INT | Üyelik + rol | communities (members/admins/bans/join-requests/approve), invites complete, access.ts |
| `bans` | (`community_id`,`user_id`) PK · `banned_by` TEXT · `created_at` INT | Kalıcı ban — davet/başvuru/üye ekleme kapısı | communities (bans), invites (redeem kontrolü) |
| `channels` | `id` TEXT PK · `community_id` FK · `name` TEXT · `type` CHECK(text/voice) · `key_version` INT · `needs_rekey` INT · `created_at` INT · UNIQUE(community,name,type) | Kanal + anahtar epoku + rekey dondurma bayrağı | channels (rotate), communities (channels), messages, voice, invites |
| `wrapped_channel_keys` | (`channel_id`,`user_id`,`key_version`) PK · `wrapped_key` TEXT | Üyeye sealed-box sarılı kanal anahtarı, epok başına | communities/channels/invites/bootstrap, voice (varlık kanıtı) |
| `messages` | `id` INT PK AUTOINC · `channel_id` FK · `sender_id` FK · `key_version` INT · `nonce`/`ciphertext` TEXT (n) · `sent_at` INT · `client_id` TEXT (n) · `sent_at_client` INT (n) · `deleted` INT · `deleted_by` TEXT (n) · `deleted_at` INT (n) | Topluluk kanalı mesajları; silinen satır tombstone — içerik silinir, satır kalır | messages (GET/POST), messageDel (`ch`), users (me DELETE) |
| `invites` | `id` TEXT PK · `community_id` FK · `code` TEXT UNIQUE · `target_user_id` TEXT (n) · `max_uses` INT (n) · `uses` INT · `expires_at` INT (n) · `created_by` TEXT · `created_at` INT | Açık/hedefli davet linki + limitler | invites (create/list/delete/peek/complete), communities (kick/ban temizliği) |
| `invite_keys` | (`invite_id`,`channel_id`) PK · `key_version` INT · `wrapped_key` TEXT | Davetle dağıtılan anahtar seti (ephemeral veya hedef kimliğine sarılı) | invites (create/peek/complete), channels rotate (eski epok siler) |
| `join_requests` | (`community_id`,`user_id`) PK · `status` CHECK(pending/denied) · `created_at` INT | Ad bilerek başvuru; red sonrası tekrar başvurulur | communities (join-requests/approve/deny), bootstrap (sayaç) |
| `join_pw_keys` | `channel_id` TEXT PK FK · `key_version` INT · `wrapped_key` TEXT | Katılım şifresi Argon2id JW anahtarıyla XChaCha20 sarılı kanal anahtarları | communities (join-password), invites (redeem-password), channels rotate |
| `friend_requests` | (`from_user`,`to_user`) PK · `created_at` INT | Bekleyen arkadaşlık isteği | friends (requests/accept/decline), bootstrap |
| `friends` | (`user_a`,`user_b`) PK · `created_at` INT | Kabul edilmiş arkadaşlık — DM kapısı | friends (accept/remove), dms/gdms (areFriends kontrolü), bootstrap |
| `dm_channels` | `id` TEXT PK · `user_a`/`user_b` FK · `key_version` INT · `created_at` INT · UNIQUE(user_a,user_b) | 1:1 DM kanalı | dms (create/list/messages/call-token), social.ts |
| `dm_keys` | (`channel_id`,`user_id`,`key_version`) PK · `wrapped_key` TEXT | DM anahtarının iki kimliğe sarması | dms, bootstrap |
| `dm_messages` | `messages` ile aynı kolon seti (kanal `dm_channels`, `sender_id` FK'sız) | DM mesajları | dms (GET/POST), messageDel (`dm`), users (me DELETE) |
| `gdm_channels` | `id` TEXT PK (`gdm_*`) · `name` TEXT · `creator_id` FK · `key_version` INT · `created_at` INT | Grup DM; üye ekleme/ayrılma rekey zorunlu | gdms (create/members/leave) |
| `gdm_members` | (`channel_id`,`user_id`) PK · `added_at` INT | Grup üyeliği | gdms, users (me DELETE — creator devri) |
| `gdm_keys` | (`channel_id`,`user_id`,`key_version`) PK · `wrapped_key` TEXT | Grup anahtar epok sarmaları | gdms (create/members/leave), bootstrap |
| `gdm_messages` | `dm_messages` ile aynı kolon seti (kanal `gdm_channels`) | Grup DM mesajları | gdms (GET/POST), messageDel (`gdm`), users (me DELETE) |

## API referansı

Tümü `/api` önekli. `index.ts` auth hook'u: `PUBLIC_PATHS` dışında her şey oturum ister (Bearer veya çerez). Rate limit kovaları: oturumlu istek kullanıcı başına (token hash), anonim istek IP başına; IP = `clientIp` (CF arkasında `CF-Connecting-IP`).

### Auth (`routes/auth.ts`) — açık uçlar public

| Uç | Amaç | Auth | Limit |
|---|---|---|---|
| GET `/auth/kdf-params?nick=` | istemci KDF salt'ı (bilinmeyen nick → pseudo-salt) | hayır | 20/dk |
| POST `/auth/register` | hesap aç: kdf_salt + auth_material + public_key + key_blob (+ recovery, turnstile) | hayır | 3/sa |
| POST `/auth/login` | auth_material verify → token + cookie + key_blob; pencere içi art arda hatada IP kademeli blok (1→15 dk) | hayır | 5/dk |
| GET `/auth/me` | reload sonrası oturum/blob geri yükleme | evet | — |
| POST `/auth/logout` | oturum iptali + çerez sil | evet | — |
| POST `/auth/password` | eski material verify → yeni salt/verifier/blob; tüm oturumlar düşer | evet | 5/dk |
| GET `/auth/recovery-params?nick=` | kurtarma KDF salt'ı | hayır | 20/dk |
| POST `/auth/recovery` | giriş yapmış hesaba ifade bağla | evet | 5/sa |
| POST `/auth/recover/unlock` | ifade kanıtı → recovery_blob + public_key | hayır | 5/sa |
| POST `/auth/recover/finish` | ifade kanıtı + yeni şifre materyali → yeni blob + oturum | hayır | 5/sa |
| GET `/users/:id/avatar` | avatar baytı, `?v=` cache anahtarı; yoksa 204 | evet | — |
| PATCH `/users/me/avatar` | avatar yükle/sil (data URL, ≤16 KB, magic-byte doğrulaması) | evet | 10/sa |

### Bootstrap (`routes/bootstrap.ts`)

| Uç | Amaç | Auth |
|---|---|---|
| GET `/bootstrap` | tüm uygulama hidrasyonu: topluluklar + üyeler + kanallar + güncel epok sarılı anahtarlarım + public key'ler + arkadaşlar + DM'ler + grup DM'ler | evet |

### Topluluklar (`routes/communities.ts`)

| Uç | Amaç | Auth | Limit |
|---|---|---|---|
| POST `/communities` | topluluk + ilk kanallar + kendime sarılı anahtarlar | evet | 5/sa |
| POST `/communities/:id/channels` | yeni kanal; wrapped_keys tüm üyeleri kapsamalı (staff) | evet | 20/sa |
| DELETE `/communities/:id/members/:uid` | üye çıkar → kanallar donar (needs_rekey), davetler ölür, ses odasından atılır (staff) | evet | — |
| POST `/communities/:id/admins` · DELETE `…/admins/:uid` | admin atama/kaldırma (yalnız sahip) | evet | — |
| POST `/communities/:id/bans` · GET `…/bans` · DELETE `…/bans/:uid` | ban listesi yönetimi (staff) | evet | — |
| POST `/communities/:id/members` | üye ekleme; wrapped_keys tüm kanalları kapsamalı; rekey beklemede 409 (staff) | evet | 20/sa |
| GET `/users/lookup?nick=` | nick → id + public_key (DM/arkadaş kurulumu) | evet | 20/dk |
| POST `/communities/:id/join-requests` | ad bilerek başvurma | evet | — |
| GET `/communities/:id/join-requests` | bekleyen başvurular + public key'ler (staff) | evet | — |
| POST `/communities/:id/join-requests/:uid/approve` · POST `…/deny` | onay (anahtarlar başvuranın kimliğine sarılır) / red (staff) | evet | — |
| POST `/communities/:id/join-password` · DELETE `…/join-password` | katılım şifresi kur/kaldır — Argon2id verifier + JW altında kanal anahtarları (yalnız sahip) | evet | 5/sa |
| GET `/communities/:id/public-keys` | üye public key'leri | evet | — |
| GET `/communities/by-name/:name` | ad → topluluk id (başvuru sinyali; listeleme yok) | evet | 20/dk |

### Kanallar ve mesajlar (`routes/channels.ts`, `routes/messages.ts`, `routes/messageDel.ts`)

| Uç | Amaç | Auth | Limit |
|---|---|---|---|
| GET `/channels/:id/my-key` | güncel epokta sarılı kanal anahtarım | evet | — |
| POST `/channels/:id/rotate` | rekey: yeni epok + tüm üyelere sarım; eski davet/şifre anahtar setleri silinir (staff) | evet | — |
| GET `/channels/:id/messages?before=&limit=` | geçmiş sayfalama (imleç `before`, 1–100) | evet | — |
| POST `/channels/:id/messages` | mesaj gönder; needs_rekey → 409, eski epok → 409 | evet | 60/dk |
| DELETE `/messages/ch/:channelId/:messageId` | tombstone: gönderen veya staff; nonce/ciphertext silinir, satır kalır | evet | 30/dk |
| DELETE `/messages/dm/:channelId/:messageId` | tombstone: yalnız gönderen (alıcı kendisi için gizler) | evet | 30/dk |
| DELETE `/messages/gdm/:channelId/:messageId` | tombstone: gönderen veya grup kurucusu | evet | 30/dk |

### Ses (`routes/voice.ts`)

| Uç | Amaç | Auth |
|---|---|---|
| POST `/channels/:id/voice-token` | LiveKit oda token'ı (`ch_<id>` odası, 15 dk TTL); sarılı anahtar varlığı kanıt | evet |

Token içeriği kaynak limitlerini taşır (`livekit.ts`): `RoomConfiguration`
(`maxParticipants: 12`, 2 vCPU/3 GB hedefi — 12×11=132 downtrack sınırı;
`emptyTimeout: 300 sn`) ve `SCREEN_SHARE=off` iken
`canPublishSources: [camera, microphone]` — ekran paylaşımı sunucu tarafından
fiziksel engellenir. İstemci tarafı yayın optimizasyonları (simulcast+dynacast+
adaptiveStream, ekran VP9, contentHint) `web/src/state/voiceStore.ts`'te;
ayrıca `publishDefaults.videoEncoding.maxBitrate: 1_500_000` ile uplink
1.5 Mbps'de sınırlı (4K yayınlayan kullanıcı encoder'ı 1.5 Mbps'ye
sıkıştırır, gizlilik için sorun yok — SFrame içeriği şifreli). Ayrıntı
README "Medya: kalite, limitler ve optimizasyon" bölümünde.

### Davetler (`routes/invites.ts`)

| Uç | Amaç | Auth | Limit |
|---|---|---|---|
| POST `/communities/:id/invites` | davet üret: açık (ephemeral) veya hedefli; kullanım/süre limiti (staff) | evet | 20/sa |
| GET `/communities/:id/invites` · DELETE `…/invites/:inviteId` | davet listeleme/iptal (staff) | evet | — |
| GET `/invites/:code` | peek — tüketmez; anahtar seti ya da `requires_password` + salt | evet | 20/dk |
| POST `/invites/:code/redeem-password` | katılım şifresi kanıtı (argon2 verify) → JW altındaki anahtar seti | evet | 20/dk |
| POST `/invites/:code/complete` | atomik tüketim + üyelik; kendi kimliğime yeniden sarım | evet | 20/dk |

### Arkadaşlar (`routes/friends.ts`)

| Uç | Amaç | Auth |
|---|---|---|
| POST `/friends/requests` | nick ile arkadaşlık isteği | evet |
| GET `/friends` | arkadaşlar + gelen/giden istekler | evet |
| POST `/friends/requests/:uid/accept` · POST `…/decline` | isteği sonlandır | evet |
| DELETE `/friends/:uid` | arkadaşlığı bitir — DM yazışı kapanır, geçmiş kalır | evet |

### DM (`routes/dms.ts`)

| Uç | Amaç | Auth | Limit |
|---|---|---|---|
| POST `/dms` | DM aç (idempotent; anahtarı açan taraf iki kimliğe sarar) — yalnız arkadaş | evet | — |
| GET `/dms` | DM listesi + güncel sarılı anahtar + son mesaj zamanı | evet | — |
| GET `/dms/:id/messages?before=&limit=` | DM geçmişi | evet | — |
| POST `/dms/:id/messages` | DM mesajı (`dm:` kapsamlı AAD); arkadaşlık bittiyse 403 | evet | 60/dk |
| POST `/dms/:id/my-key` | güncel epok sarılı DM anahtarım | evet | — |
| POST `/dms/:id/call-token` | 1:1 arama için LiveKit token (aynı DM anahtarı) | evet | — |

### Grup DM (`routes/gdms.ts`)

| Uç | Amaç | Auth | Limit |
|---|---|---|---|
| POST `/gdms` | grup kur (≤21 üye, hepsi arkadaş; tüm üyelere epok-1 sarım) | evet | — |
| GET `/gdms` | gruplarım + üyeler + sarılı anahtar | evet | — |
| POST `/gdms/:id/members` | üye ekle → zorunlu rekey (yeni üye geçmişi okuyamaz) | evet | — |
| POST `/gdms/:id/leave` | ayrıl → kalanlara yeni epok sarımı (ayrılan geleceği okuyamaz) | evet | — |
| GET `/gdms/:id/messages` · POST `/gdms/:id/messages` | grup geçmişi / mesaj (gönderenin güncel anahtarı şart) | evet | POST 60/dk |

### Kullanıcı (`routes/users.ts`)

| Uç | Amaç | Auth | Limit |
|---|---|---|---|
| GET `/users/:id/pubkey` | herhangi bir kullanıcının public key'i (safety number için) | evet | 30/dk |
| DELETE `/users/me` | kalıcı hesap silme — tek transaction: kendi mesaj satırları, DM kanalları, grup üyeliği (kurucu devri), davetler, sahip olduğu topluluklar, kimlik | evet | 5/sa |

### Anahtar defteri (`routes/keys.ts`)

| Uç | Amaç | Auth | Limit |
|---|---|---|---|
| GET `/keys/log?after=&limit=` | defter sayfalama (limit 1–500, default 200) + her sayfada güncel head; istemce `entry_hash`'leri yeniden hesaplayıp zinciri doğrular | hayır | 30/dk (anonim IP kovası) |
| POST `/keys/sign` | imza anahtarı yayınla: Ed25519 public key deftere yazılır; opsiyonel `key_blob` (v2 rewrap) yalnız `auth_material` doğrulanınca güncellenir — yalnız çerez ele geçiren oturum mağdur adına imza kimliği yayınlayamaz | evet | 5/sa |

Ayrıca: GET `/api/health` → `{"ok":true}` (public).

## WS protokolü

Sunucu: `server/src/ws/` — `/ws`, maxPayload 1 MiB, ilk kare auth zorunlu (aksi halde `4001 önce auth`; hatalı JSON `4002`; geçersiz oturum `4003`; auth frame 10 sn'de gelmezse `4004`), token yerine `pgv_session` çerezi de kabul. Ping/pong reaper 30 sn'de bir süpürür. İstemci: `web/src/ws/socket.ts` (auth frame'siz — çerez taşınır; sonsuz reconnect, 500 ms→30 s üstel backoff + ±%20 jitter, `ws/backoff.ts`).

Client → server:

| Kare | Alanlar | Amaç |
|---|---|---|
| `auth` | `token?` | socket kimliği (çerez yeterli) |
| `voice_state` | `channel_id`, `state: joined\|left` | ses odası presence'ı |
| `call:ring` / `call:accept` / `call:decline` / `call:cancel` | `channel_id` | 1:1 DM arama sinyali (yalnız DM üyesi; media LiveKit'te) |

Server → client (hub: oda bazlı `broadcast`, kullanıcı bazlı `sendToUser(s)`):

| Kare | Alanlar | Amaç |
|---|---|---|
| `ready` | — | auth tamam |
| `message:new` | `channel_id`, `message` | topluluk kanalına canlı mesaj |
| `message:deleted` | `channel_id`, `id` | tombstone yayını |
| `channel:created` | `community_id`, `channel` | yeni kanal |
| `channel:rotated` | `channel_id`, `key_version` | rekey tamam → istemci yeni anahtarı ister |
| `community:member_added` | `community_id`, `user`, `public_key` | üye katıldı (kick/ban/approve/davetle) |
| `community:member_removed` | `community_id`, `user_id`, `affected_channel_ids` | üye çıktı — etkilenen kanallar donar |
| `community:roles_updated` | `community_id` | admin değişimi |
| `community:join_password` | `community_id` | katılım şifresi kuruldu/kaldırıldı |
| `join_request:new` | `community_id`, `user` | yeni başvuru (staff'a) |
| `friend_request:new` | `user` | gelen arkadaşlık isteği |
| `friend:new` | — | arkadaşlık kuruldu (iki tarafa) |
| `friend:removed` | `user_id` | arkadaşlık bitti |
| `dm:new` | `channel_id`, `from` | yeni DM kanalı |
| `dm:message` | `message` | DM canlı mesaj |
| `gdm:new` | `channel_id`, `name` | yeni gruba eklendin |
| `gdm:updated` | `channel_id` | grup rekey/üye değişimi |
| `gdm:message` | `message` | grup canlı mesaj |
| `voice:update` | `community_id`, `channel_id`, `participants[{user_id,nick}]` | ses odası kadrosu (bellek içi, sidebar UI) |
| `call:incoming` | `channel_id`, `from` | karşı taraf arıyor |
| `call:accepted` / `call:declined` / `call:cancelled` | `channel_id` | arama yanıtları |
| `call:ended` | `channel_id`, `reason` (`declined`\|`cancelled`\|`peer_disconnected`) | arama kapandı — socket düşüşünde de hub üretir |

İstemci kablo dağılımı: `appStore.wireEvents` (bootstrap yenileme + üyelik olayları), `chatStore` (`message:new`/`message:deleted`), `dmChatStore` (`dm:message`/`gdm:message`/`message:deleted`), `voiceStore` (`voice:update`, `channel:rotated`, tüm `call:*`).

## Modül haritası

### web/src

| Dosya | Amaç |
|---|---|
| `crypto/argon2.ts` | Argon2id (64 MiB, t=3) → 64B: authMaterial + KEK |
| `crypto/bip39.ts` + `bip39-words.ts` | 12 kelime üretim (128-bit entropi + checksum), doğrulama, quiz konumları; kelime listesi |
| `crypto/bytes.ts` | b64/hex/concat/randomBytes yardımcıları |
| `crypto/fingerprint.ts` | 40 haneli safety number (sıralı X25519 çifti; iki tarafın Ed25519 anahtarı da biliniyorsa sıralı imza çifti de kapsanır — v2 damga) + 16 hex'lik kısa iz |
| `crypto/identity.ts` | X25519 keypair + Ed25519 imza keypair; blob seal/open (KEK altında; payload v1 = X25519 private, v2 = 0x02 ‖ X25519 ‖ Ed25519); sealed-box wrap/unwrap |
| `crypto/invite.ts` | davet linki kur/ayrıştır (`#/davet/<code>/<eph-priv>` fragment); ephemeral anahtarla açma |
| `crypto/joinpw.ts` | katılım şifresi JW anahtarı altında kanal anahtarı seal/open |
| `crypto/message.ts` | XChaCha20-Poly1305 mesaj AEAD; AAD = scope + kanal + epok + client binding; per-gönderici ratchet zinciri (msg_key_i) + boyut bucket padding; v3: AEAD çıktısına Ed25519 imza eklenir + cutover politika |
| `crypto/devicekey.ts` | WebAuthn PRF cihaz kilidi: passkey üret/enroll, cihaz KEK türetimi, blob sar/çöz, IndexedDB `pgv-device` |
| `crypto/recovery.ts` | kurtarma ifadesinden Argon2id anahtar türetme (şifre yoluyla aynı zincir) |
| `crypto/sodium.ts` | libsodium hazır olma sözü (WASM) |
| `state/authStore.ts` | kayıt/giriş/reauth (needs_password)/şifre değişimi/kurtarma; KEK memory-only; passkey unlock boot dalı |
| `state/appStore.ts` | bootstrap hidrasyonu, topluluk/kanal seçimi, üye/rol/davet/başvuru yönetimi, WS kabloları |
| `state/chatStore.ts` | kanal geçmişi + sayfalama + canlı mesaj akışı, anahtar açma |
| `state/dmChatStore.ts` | DM + grup DM sohbet state'i, gizli mesaj filtresi |
| `state/voiceStore.ts` | LiveKit bağlantısı, SFrame E2EE, ses durumu, 1:1 arama akışı (zil/kabul/PiP) |
| `state/joinStore.ts` | davet/başvuru katılım akışı (link ayrıştırma, şifre kanıtı, anahtar sarma) |
| `state/hiddenStore.ts` | "benim için sil" — yalnız istemcide mesaj gizleme (localStorage) |
| `state/unreadStore.ts` | okunmadı sayacı — sunucu neyi okuduğunu bilmez (localStorage) |
| `state/securityStore.ts` | defter doğrulama uyarıları — Shell üstünde kırmızı güvenlik bandı |
| `api/client.ts` | fetch sarmalayıcı (çerez auth, ApiError) |
| `api/types.ts` | API tip tanımları |
| `ws/socket.ts` | WS istemcisi: auth frame, olay dağıtımı, reconnect |
| `ws/backoff.ts` | reconnect gecikme matematiği (test edilebilir saf fonksiyon) |
| `lib/avatar.ts` | istemci tarafı avatar küçültme (64×64 JPEG ~3-8 KB) |
| `lib/format.ts` | saat/gün biçimleme (tr-TR) |
| `lib/keypins.ts` | TOFU public-key pin store — sunucu anahtar değişimini yakalar |
| `lib/keytransparency.ts` | anahtar defteri: zincir doğrulama, head localStorage, kendi kayıt kontrolü, head damga formatı |
| `lib/signkeys.ts` | gönderen atfı: doğrulanmış defterden Ed25519 public key haritası (kullanıcı başına çoklu — key yenilemesi), artımlı tazeleme; imzalı mesaj doğrulaması yalnız bu haritadan beslenir |
| `lib/nick.ts` | userId → nick çözümleyici (tüm bilinen kaynaklardan) |
| `lib/replay.ts` | client_id dedupe — sunucu ciphertext'i yeni satır olarak yeniden enjekte edemez |
| `lib/safety.ts` | 30 haneli safety number (sıralı public key hash) |
| `lib/sound.ts` | WebAudio bildirim sesi (asset yok) |
| `App.tsx` / `main.tsx` / `router.ts` | kök bileşen, giriş, hash tabanlı yönlendirme (davet linkleri) |
| `index.css` | tasarım token sözleşmesi (`@theme`) + bileşen sınıfları — bkz. DESIGN.md |
| `components/Brand.tsx` | marka atomları: PigeonMark, SealMark, Postmark |
| `components/Shell.tsx` | uygulama kabuğu: rota plakası, drawer, modal/arama katmanları, güvenlik uyarı bandı |
| `components/Login.tsx` | giriş/kayıt/kurtarma formları (posta senedi kartı) |
| `components/JoinScreen.tsx` | davet/başvuru ile katılma ekranı |
| `components/ServerRail.tsx` | sol dikey topluluk rayı |
| `components/ChannelSidebar.tsx` | topluluk kanal listesi + rekey şeridi |
| `components/DmSidebar.tsx` / `DmHome.tsx` / `DmChat.tsx` | DM ana yüzeyleri |
| `components/ChatView.tsx` / `MessageRow.tsx` / `Composer.tsx` | topluluk sohbeti, mesaj satırı, yazma alanı |
| `components/MemberList.tsx` | üye listesi + ekleme/rol/ban eylemleri |
| `components/CommunitySettings.tsx` | ⚙️ ayarlar: admin/ban/davet/şifre/rotate |
| `components/VoiceRoom.tsx` | topluluk sesli odası (LiveKit) |
| `components/CallView.tsx` / `CallControls.tsx` / `CallQualityPicker.tsx` / `IncomingCall.tsx` / `PiPWidget.tsx` | 1:1 arama yüzeyleri: tam ekran, kontroller, kalite, gelen arama, küçük pencere |
| `components/Avatar.tsx` | avatar bileşeni (initial + renk fallback) |
| `components/Modal.tsx` / `ConfirmDialog.tsx` / `Toast.tsx` | diyalog ve bildirim altyapısı |
| `components/DeviceLockModal.tsx` | "bu cihazda hatırla" passkey teklif diyaloğu |
| `components/PasswordInput.tsx` | şifre alanı + güç heuristiği |
| `components/MsgDelete.tsx` | mesaj silme diyaloğu (herkes/benim için) |
| `components/KeyFingerprintModal.tsx` | safety number karşılaştırma diyaloğu |
| `components/SafetyModal.tsx` | güvenlik bilgisi/pin uyarıları |
| `components/ProfileModal.tsx` | profil: avatar yükleme, şifre, kurtarma ifadesi, anahtar defteri damgası |
| `components/Turnstile.tsx` | Cloudflare Turnstile widget (sunucuda secret varsa) |
| `components/SponsorNote.tsx` | dağıtım notu |

### server/src

| Dosya | Amaç |
|---|---|
| `index.ts` | Fastify app: trustProxy, auth hook (PUBLIC_PATHS), rate-limit kovaları, sansürlü req log (query/IP'siz), route kaydı, WS mount |
| `config.ts` | env (port, dataDir, LiveKit, TTL, Turnstile, CF-IP); bilinen zayıf secret reddi; `clientIp` |
| `db.ts` | SQLite aç (WAL, FK, busy_timeout) + sırayla migration uygula |
| `migrations.ts` | v1–v13 sıralı şema betikleri (bkz. DB şeması) |
| `schemas.ts` | NICK_REGEX + kayıt/giriş JSON şemaları (istemci/sunucu tek kaynak) |
| `types.ts` | Fastify tip genişletmesi: `req.user`, `req.sessionToken` |
| `livekit.ts` | oda token üretimi (offline JWT, 15 dk) + `evictFromRooms` (kick/ban'da canlı bağlantı düşürme) |
| `auth/sessions.ts` | token üret (sha256 saklanır)/verify/iptal; rolling refresh; saatlik janitor |
| `routes/auth.ts` | kayıt/giriş/çerez/logout/şifre değişimi/avatar/BIP-39 kurtarma; nick enumeration karşıtı pseudo-salt + timing-parity; login kademeli IP bloğu; register defter satırı |
| `routes/bootstrap.ts` | tek çağrılık tam hidrasyon |
| `routes/communities.ts` | topluluk/kanal/üye/rol/ban/başvuru/katılım şifresi |
| `routes/channels.ts` | my-key + rotate (rekey) |
| `routes/messages.ts` | kanal geçmişi + gönderim (needs_rekey/epok kontrolleri) |
| `routes/messageDel.ts` | üç kapsamda tombstone silme (idempotent) |
| `routes/voice.ts` | LiveKit token köprüsü |
| `routes/invites.ts` | davet üret/listele/iptal/peek/şifreli redeem/complete |
| `routes/friends.ts` | arkadaşlık isteği akışı |
| `routes/dms.ts` | DM aç/liste/geçmiş/gönder/anahtar/arama token'ı |
| `routes/gdms.ts` | grup DM: kur/üye ekle (rekey)/ayrıl (rekey)/geçmiş/gönder |
| `routes/users.ts` | pubkey dağıtımı + kalıcı hesap silme |
| `routes/keys.ts` | anahtar defteri: appendKeyLog (tek yazı yolu), GET /keys/log, boot backfill |
| `ws/hub.ts` | socket kaydı, oda/kullanıcı yayını, ses kadro haritası, DM arama takibi |
| `ws/index.ts` | WS upgrade + auth-first-frame (10 sn'de 4004 timeout) + voice_state/call sinyal işleme |
| `lib/access.ts` | üyelik/rol/kanal/topluluk erişim sorguları (isStaff, needsRekey) |
| `lib/social.ts` | arkadaş/DM yardımcıları (areFriends, findDmByPair, dm id üretimi) |