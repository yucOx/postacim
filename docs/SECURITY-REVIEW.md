# Security Review — v1.0.0 audit hazırlık paketi

> Dış güvenlik denetçisi (external auditor) için tek-giriş paketi.
> Kapsam, mimari, kripto spesifikasyonu, test envanteri, kapsam dışı
> ve önerilen denetim öncelikleri. Ürün vaadi ve kullanıcı-odaklı tehdit
> modeli: [README.md "Tehdit modeli ve bilinen sınırlar"](../README.md#tehdit-modeli-ve-bilinen-sınırlar).
>
> Kod tabanı sürümü: `main` @ commit `e797fbb` (Faz 7 merge).
> Faz 8'de bu doküman + README tehdit modeli sıfırdan yazımı + v1.0.0
> tag hazırlığı (karar kullanıcıda).

## 1. Kapsam

Bu paket üç katmandaki tüm E2EE yüzeyini kapsar:

| Katman | Yol | Sorumluluk |
|---|---|---|
| İstemci kriptosu | `web/src/crypto/` | Tüm anahtar türetme, sarma, mesaj şifreleme, imza, ratchet, ses anahtarı türetimi |
| İstemci protokol | `web/src/lib/`, `web/src/state/` | Anahtar defteri, key transparency gossip, self-update işleme, replay filtresi, TOFU pin, TTL, per-cihaz DH step |
| Sunucu | `server/src/` | Oturum, üyelik, sarılı anahtar dağıtımı, WS hub, LiveKit token, anahtar defteri (append-only), DH-rekey broadcast, cihaz yönetimi |
| Canlı medya | `livekit/` | SFrame E2EE (SFU bayt görür, çözemez); relay-token köprüsü |

**Kapsam dışı** (SECURITY.md "Kapsam dışı" ile aynı):
- Cihaz üzerindeki saldırgan (çalınmış tarayıcı, malware, fiziksel erişim)
- Browser/Node platform güvenliği (üçüncü parti CVE taraması zaten CI'da)
- Ağ katmanı TLS konfigürasyonu (certbot + nginx rehberi, `deploy/`)
- ML sistemi çıktıları (nick brute force vs.) — rate limit zaten sınırlıyor
- Üçüncü parti sağlayıcılar (Cloudflare Turnstile — opsiyonel, devre dışı kalabilir)

## 2. Tehdit modeli (özet)

Tam sınıflama: [README §Tehdit modeli](../README.md#tehdit-modeli-ve-bilinen-sınırlar).
Burada denetçi için ana hatlar:

- **Malicious server** (birincil): içeriği görmez ama mesaj gizleyebilir,
  sırayı/timestamp'i manipüle edebilir, sahte `key_log` gösterebilir.
  **İçerik gizliliği** invariant'ı testle sabit
  (`server/test/hardening.test.ts`); **sıralama bütünlüğü** client
  binding ile tespit edilir (engellenemez).
- **Network passive** (TLS ile kapatılır): TLS overlay zorunlu; onion
  varyantı rehberle anlatılır.
- **Network active** (MITM): TLS + tarayıcı CA deposu; onion varyantı için
  HTTPS-onion önerisi.
- **Compromised peer device**: ele geçirilen cihaz mevcut hesabı
  kullanabilir; kurbanın çıkışı self-update (`dh_update`) + cihaz iptali
  (= rekey zorunlu) ile sınırlı toparlanma. Tam PCS-formel yok
  (tetikleyici: openmls-wasm stabil).

### Roadmap boşluklarının akıbeti

6 boşluk (Faz 1–7) akıbet tablosuyla sınıflı; kalan sınırlar
yapısal/kaynak kısıtı olarak işaretli (AYNI/GELECEK). Detay için
yukarıdaki README bağlantısı.

## 3. Mimari özet

### 3.1 Bileşenler

- **Web** (`web/`): React 19 + Vite + Zustand + libsodium (WASM) +
  hash-wasm. Tüm kripto tarayıcıda çalışır. Sunucuya yalnız opak
  blob (sealed-box anahtar, XChaCha20-Poly1305 mesaj) gider.
- **Server** (`server/`): Node 22 + Fastify + better-sqlite3 (WAL).
  Oturum, üyelik, rate limit, sarılı anahtar dağıtımı, WS hub,
  LiveKit token köprüsü, anahtar defteri (append-only), DH-rekey
  broadcast, cihaz yönetimi. **İçerik görmez** (invariant).
- **LiveKit SFU** (`livekit/`): Docker container. SFrame E2EE —
  passphrase DH zincirinden türetilir (5d). SFU bayt görür, çözemez.

### 3.2 Opak blob invariant (değişmez)

Sunucu hiçbir noktada düz metin/düz anahtar/özel anahtar/kimlik
blob'u **görmez, saklamaz, yorumlamaz**. Kanıt:

- `server/test/hardening.test.ts` — log hijyeni, plaintext invariant
  (satır/tablo oluşmaz), `dh_update` WS relay şifre içermez.
- `web/src/crypto/message.ts` — AAD bağlama, replay filtresi
  (`client_id` dedupe, `web/src/lib/replay.test.ts`).
- `web/src/crypto/identity.ts` — blob v1/v2/v3 KEK altında, sunucu
  yalnız ciphertext saklar.

### 3.3 Akış

```
tarayıcı (web/) → nginx → /api/* (server Fastify) — opak blob
                              ↓
                              /ws (WebSocket hub) — opak frame'ler
                              ↓
                              /livekit (LiveKit SFU) — SFrame E2EE
```

Oturum httpOnly `pgv_session` çereziyle taşınır (Bearer de kabul —
test/betik). WS ilk kare auth zorunlu (10 sn'de 4004 timeout).

## 4. Kripto spesifikasyonu

### 4.1 Algoritma ve kütüphane envanteri

| Katman | Algoritma | Kütüphane | Versiyon | Test vektörü |
|---|---|---|---|---|
| Şifre → anahtar | Argon2id (64 MiB, t=3, p=1, 64B) | libsodium `crypto_pwhash` | `libsodium-wrappers` (npm: `libsodium-wrappers-sumo`) | `crypto/argon2.ts` |
| Kimlik şifreleme | XChaCha20-Poly1305 (24B nonce) | libsodium `crypto_aead_xchacha20poly1305_ietf` | aynı | `crypto/identity.test.ts` |
| Anahtar dağıtımı | Sealed box (X25519 + XSalsa20-Poly1305) | libsodium `crypto_box_seal` | aynı | `crypto/crypto.test.ts` (wrap/unwrap) |
| Mesaj AEAD | XChaCha20-Poly1305 | libsodium `crypto_aead_xchacha20poly1305_ietf` | aynı | `crypto/crypto.test.ts` (AAD bağlama) |
| Gönderen atfı | Ed25519 detached imza | libsodium `crypto_sign_detached` | aynı | `crypto/signature.test.ts` (Faz 1 — sahte gönderici reddi, cutover) |
| DH ratchet | X25519 + BLAKE2b-256 zincir türetimi | libsodium `crypto_scalarmult` + `crypto_generichash` | aynı | `crypto/dh-ratchet.test.ts` (Faz 5 — KAT + FS/PCS-lite) |
| Kurtarma ifadesi | BIP-39 (128-bit entropi + checksum) | `hash-wasm` + `crypto/bip39.ts` | hash-wasm (npm) | `crypto/crypto.test.ts` (BIP-39 checksum, quiz) |
| Cihaz kilidi | WebAuthn PRF → KEK | tarayıcı PRF API | platform | `crypto/devicekey.test.ts` |
| Hash zinciri | SHA-256 (key_log `entry_hash`) | Node `crypto` | Node 22 | `lib/keytransparency.test.ts` |
| SFrame | HKDF → SFrame key | LiveKit client | `livekit-client` 2.22.x | manuel; voiceStore token köprüsü |
| Çevre dışı | TLS 1.2+ | nginx | sistem | sertifika yönetimi (certbot) |

### 4.2 Mesaj formatı (v4, tüm scope'lar)

Byte-seviyesi spec: [docs/faz5-dh-ratchet-design.md](faz5-dh-ratchet-design.md).
Özet:

```
v4 mesaj = DH_header(40) ‖ AEAD(nonce ‖ ct ‖ tag) ‖ Ed25519_sig(64)

DH_header   = eph_pub(32) ‖ u32LE(j) ‖ u32LE(step_base)
step_root_j = H(chain_seed ‖ 'dh' ‖ u32LE(j) ‖ DH_out)
root_{j,l}  = H(root_{j,l-1} ‖ 'step')
msg_key     = H(root_{j,l} ‖ 'msg')
```

- `chain_seed = H(epoch_key ‖ 'ratchet' ‖ sender_user_id)` (v2 ile aynı)
- **DM (5b hotfix)**: `anchor_dm = X25519base(H(epoch‖'dm-anchor'‖sorted(sender)‖sorted(peer)))`;
  `DH_out = X25519(eph_priv, anchor_dm.publicKey)` (alıcı: `X25519(anchor_dm.privateKey, dh_pub)`).
  Her iki taraf aynı çifti türetir → kendi mesajını da açar.
- **Kanal/gdm**: `DH_out = X25519(eph_priv, anchor_pub)`; `anchor = dhAnchor(epoch_key)`
  tüm üyeler aynı çifti türetir (alıcı stateless)
- Pencere: M=100 mesaj / T=24h (reload = zorunlu yeni adım)
- AAD: `ch:<kanal>:v<epok>:d<dh_pub_hex>` + `client_id + sent_at_client` (replay filtresi)
- İmza girdisi: `ciphertext ‖ utf8(AAD)` (Faz 1 — gönderen atfı)

### 4.3 Anahtar yaşam döngüsü (12 adım)

Detay: [ARCHITECTURE.md "Anahtar yaşam döngüsü"](../ARCHITECTURE.md#anahtar-yaşam-döngüsü).

1. Şifre → Argon2id → 64B (32B authMaterial + 32B KEK)
2. KEK, `key_blob` (v1/v2/v3) açar — `postacim/v1/identity` AAD
3. Private key, sealed-box `wrapped_key` açar
4. Kanal anahtarı (32B rastgele) mesaj AEAD'i besler
5. v4 DH ratchet: ephemeral + chain_seed + DH_out → msg_key
6. Gönderen atfı: Ed25519 detached imza (cutover sonrası zorunlu)
7. Client binding: UUID + client ts AAD'de (replay tespiti)
8. Ses/görüntü: SFrame passphrase `H(step_root ‖ 'voice')` (5d — epok sabit)
9. Epoklar: her sarma yeni `key_version`; eski satırlar kalır
10. Cihaz kilidi (ops.): WebAuthn PRF → IndexedDB blob
11. Anahtar defteri: append-only hash zinciri (`key_log`)
12. Çoklu cihaz: her cihaz bağımsız keypair (v3 blob, per-cihaz DH step)

### 4.4 Kimlik blob evrimi

| Sürüm | Format | Ne zaman | Geriye uyum |
|---|---|---|---|
| v1 | `X25519 priv (32)` | Faz 0–1 | İlk açılışta otomatik v2'ye yükselir |
| v2 | `0x02 ‖ X25519 priv (32) ‖ Ed25519 priv (64)` | Faz 1 | İlk açılışta otomatik v3'e yükselir |
| v3 | `0x03 ‖ X25519 priv (32) ‖ Ed25519 priv (64) ‖ device_id (16B)` | Faz 7 | v1/v2 açılır, `deviceId = null` → primary alias |

Test: `web/src/crypto/identity.test.ts` (seal+open + geriye uyum + yanlış KEK reddi).

## 5. Test envanteri

**Toplam: 31 test dosyası, 293 test** (290 passed + 3 skipped).

> 3 skipped test bilinçli: locale parity (dev-only), bazı server timing
> testleri. Tam liste: `npm test -- --reporter=verbose` çıktısı.

### 5.1 Kriptografik doğruluk

| Test dosyası | Test sayısı | Ne kanıtlıyor |
|---|---|---|
| `web/src/crypto/crypto.test.ts` | ~25 | AEAD/AAD bağlama, kimlik sarma, BIP-39 checksum, davet linki ayrıştırma, şifre güç heuristiği, kurtarma quiz konumları, WS reconnect backoff sınırları, okunmadı sayacı |
| `web/src/crypto/fingerprint.test.ts` | ~6 | Safety number simetrisi, bilinen vektörler (v1 + v2 imza katkılı), biçim |
| `web/src/crypto/signature.test.ts` | ~12 | Gönderen atfı: imza doğrulama, sahte gönderici reddi, ciphertext/AAD modifiye reddi, bilinmeyen imza anahtarı reddi, cutover geçiş davranışı, imza düşürme (downgrade) reddi |
| `web/src/crypto/ratchet.test.ts` | ~10 | Per-gönderici ratchet: zincir tek yönlülüğü, index/AAD reddi, stateless yeniden türetim, out-of-order |
| `web/src/crypto/dh-ratchet.test.ts` | ~30 | DH ratchet v4: KAT vektörleri (`dh-ratchet.vectors.json`), FS/PCS-lite sızıntı simülasyonu (gönderici state sızıntısı → eski adım kapalı, sonraki adım güvenli), adım içi backward secrecy, out-of-order, tarama sınırı, AAD/imza/başlık takası negatifleri, self-update doğrulama, 5c epok DH çapası (kanal/gdm roundtrip) + rekey broadcast negatifleri, 5d ses anahtarı türetimi (çapa/DM KAT, iki tarafın aynı anahtarı, epok ayrımı, mesaj zincirinden alan ayrımı), **5b hotfix DM çapası (sıralı çift simetrisi, cross-device roundtrip, kendi mesajını açma, eski v4 okunamaz negatif)** |
| `web/src/crypto/devicekey.test.ts` | ~8 | Cihaz kilidi: blob sar/çöz, yanlış KEK/AAD reddi, enroll→unlock, PRF fallback |
| `web/src/crypto/identity.test.ts` | ~8 | v3 kimlik blob'u: deviceId ile seal+open, v1/v2 geriye uyumlu açılış, yanlış KEK reddi |
| `web/src/crypto/ttl-aad.test.ts` | ~5 | TTL'in AAD/imza dışı olması (sunucu metadata'sı) |
| `web/src/lib/dhupdate.test.ts` | ~10 | Self-update duyuru işleme: kanon ayrıştırma, yanlış Ed25519/bozuk kanon reddi, kanal/epok bağlama, TOFU pin, bant eşleşmesi (yalnız imza red bant tetikler) |
| `web/src/lib/dhstep-device.test.ts` | ~6 | Per-cihaz DH step namespace: aynı (channel, version) farklı deviceId = ayrı sayaç, pencere mantığı deviceId-bağımsız |
| `web/src/lib/keytransparency.test.ts` | ~8 | Anahtar defteri: zincir bütünlüğü, kopuk/çelişkili head reddi, kendi kayıt kontrolü |
| `web/src/lib/keygossip.test.ts` | ~12 | 4 durum makinesi (eşleşme/ileri/aynı-id-farklı-hash/biz-önde-uyuşmazlık) + periyodik yayın + hardening |
| `web/src/lib/replay.test.ts` | ~4 | client_id tekrar oynatma filtresi |
| `web/src/lib/safety.test.ts` | ~5 | Safety number sıra bağımsızlığı/biçim |
| `web/src/lib/ttl.test.ts` | ~5 | TTL seçenekleri + isExpired + useExpiryTick (30 sn tick) |

### 5.2 Sunucu invariant + saldırı yüzeyi

| Test dosyası | Test sayısı | Ne kanıtlıyor |
|---|---|---|
| `server/test/auth.test.ts` | ~20 | Kayıt/giriş, IP başına limitler, httpOnly çerez (+ Secure bayrağı TLS arkasında) + WS çerez auth, logout iptali, şifre değişimi oturum düşürme, BIP-39 kurtarma döngüsü |
| `server/test/messages.test.ts` | ~10 | Geçmiş sayfalama imleci, kullanıcı başına gönderim limiti, rotate kadro doğrulaması |
| `server/test/moderation.test.ts` | ~10 | Roller, kick→dondur→rotate, ban, kanal limiti |
| `server/test/join.test.ts` | ~10 | Açık/hedefli davet, süre/kullanım limiti, başvurular, katılım şifresi |
| `server/test/social.test.ts` | ~10 | Arkadaşlık, DM, grup DM rekey, WS canlı olay + sesli durum yayını |
| `server/test/boot.test.ts` | ~5 | Zayıf secret reddi, taze DB migration zinciri (v1–v17) |
| `server/test/hardening.test.ts` | ~12 | Log hijyeni (query/IP düşmez), WS auth zaman aşımı (4004), login kademeli bloğu, plaintext invariant |
| `server/test/keylog.test.ts` | ~8 | Anahtar defteri: genesis/kuyruk hash, sayfalama, silinen hesabın satırı kalır, UPDATE/DELETE yolu yok |
| `server/test/keygossip.test.ts` | ~7 | WS `keylog_head` relay invariant: kanal/gdm/dm kitlesi, üye olmayan reddi, sığ payload sınırı, plaintext invariant (satır/tablo oluşmaz), relay→ingest uçtan uca (geçerli + bozuk imza) |
| `server/test/dhupdate.test.ts` | ~5 | WS `dh_update` opak relay: kanal/gdm/dm kitlesi, üye olmayan reddi, sığ payload sınırı, plaintext invariant |
| `server/test/devices.test.ts` | ~12 | Cihaz yönetimi: GET liste, link 3-adım flow (start/approve/finish), primary iptal reddi, joinee iptal, token tek kullanımlık, başka user cihazı 404 |
| `server/test/delete.test.ts` | ~5 | Hesap silme: kimlik/mesaj/DM/grup/topluluk tek transaction, kurucu devri |
| `server/test/ttl.test.ts` | ~5 | TTL: üst sınır 30 gün, geçmiş timestamp 400, null = kapalı |
| `server/test/reactions.test.ts` | ~5 | Mesaj tepkileri (varsa) |
| `web/src/csp.test.ts` | ~5 | nginx CSP'nin WASM kripto uyumu (wasm-unsafe-eval), HSTS yalnız TLS conf'da |
| `web/src/locale-parity.test.ts` | ~3 | 5 dil anahtar parite (dev-only — bilinçli skipped) |

### 5.3 CI

`.github/workflows/ci.yml`: push/PR'da tip kontrolü + tüm testler.
Ek olarak `.github/workflows/release.yml` (Faz 4): `v*` tag push'unda
web bundle SHA-256 + SRI manifest üretimi.

## 6. Bilinen sınırlar + kapsam dışı

Tam sınıflama: [README §Tehdit modeli §2](../README.md#tehdit-modeli-ve-bilinen-sınırlar).
Burada denetçinin önceliklendirmesi için ana eksikler:

| Sınır | Nedeni | Yapısal/kaynak? | Çözüm yolu |
|---|---|---|---|
| MLS-formel yok | openmls-wasm stabil değil, IndexedDB storage docs yok (Faz 5 araştırma) | kaynak (ekosistem) | openmls-wasm stabil sürüm → Faz 9 |
| Web JS trust kalıntısı | tarayıcı yapısal sınırı | yapısal (platform) | tarayıcı uzantısı (opsiyonel artı, karar kullanıcıda) |
| Tor rehberi opsiyonel | uygulama operatör kararı | kaynak (operatör) | rehber uygulanırsa kapanır |
| Rate-limit anonimleştirme | TURN/onion yapısal sınır (anonim arkasında ortak kova) | yapısal (ağ) | tor mükerrer devreleri, kova-izolasyonu (büyük değişiklik) |
| Sansür/sıralama | kör sunucu yapısal sınır | yapısal | client binding ile tespit (mevcut); engelleme yok |
| Metadata | uygulama modeli gereği (sunucu sosyal graf, zamanlama, presence) | yapısal (model) | TURN/onion azaltır; tam gizleme roadmap'te değil |
| Ses/görüntü gönderen atfı | SFrame per-sender imza yok (SFU sınırı) | kaynak (LiveKit) | SFU fork veya başka E2EE transportu (yol haritası dışı) |
| WebRTC Tor | UDP/ICE Tor SOCKS'tan geçmez | yapısal (ağ) | `SCREEN_SHARE=off` + medya portları kapalı |
| Key transparency gossip gözlemsel | CONIKS/Keybase MAP kanıt ağacı yok (kapsam dışı) | kaynak (kapsam) | ek per-entry kanıt ağacı (yol haritası dışı) |
| Çoklu cihaz linking MVP | async QR/off-band yok | kaynak (UX) | roadmap (yol haritası dışı) |
| DB at-rest (SQLCipher) | bilinçli ertelendi (imaj kırılganlığı) | kaynak (opsiyonel) | LUKS/dm-crypt volume-layer (operatör kararı) |
| Şifre + kurtarma ifadesi kaybı | uçtan uca şifreleme yapısal | yapısal (E2EE) | engellenemez |

## 7. Audit tavsiyeleri

Denetçi için önerilen öncelik sırası (yüksek risk → düşük):

### P0 — yüksek (mutlaka bakılmalı)

1. **DH ratchet (v4) doğruluk** — `web/src/crypto/dhratchet.ts` +
   `web/src/crypto/message.ts` v4 yolu + KAT vektörleri
   (`web/src/crypto/dh-ratchet.vectors.json`). Saldırı senaryoları:
   - Aynı `step_root`'un iki farklı mesajdan türetilmesi (çakışma)
   - Adım atlatma (j atlama) ile geçmişe dönük anahtar üretimi
   - Kanal/gdm `dhAnchor` türetiminde bias (epok anahtarı sızması senaryosu)
   - `peer_static_pub` çapraz-protokol kullanım (DM vs kanal)
2. **AAD bağlama** — `web/src/crypto/message.ts` AAD montajı. Saldırı
   senaryoları: kanal-içi replay (client_id AAD'de mi?), cross-scope replay
   (ch ↔ dm ↔ gdm), cross-version replay (eski epok → yeni).
3. **Self-update (`dh_update`) doğrulama** — `web/src/lib/dhupdate.ts` +
   `server/src/ws/index.ts` relay. Saldırı: sahte Ed25519 imzası (bilinen
   anahtarla), aynı kanaldan iki farklı cihaz, kanal/epok bağlama bypass.
4. **İmza doğrulama akışı (`web/src/lib/signkeys.ts`)** — defter
   doğrulanmadan imza anahtarı kabul ediliyor mu? Boot sırası,
   artımlı tazeleme, replay (eski imza anahtarı sızması).
5. **Sunucu plaintext invariant** — `server/src/` içinde düz metin
   yolu yokluğu. `hardening.test.ts` + `keygossip.test.ts` + `dhupdate.test.ts`
   var; ek: WS frame payload'larında şifreli/şifresiz alan audit'i.

### P1 — orta (kapsamlı bakılmalı)

6. **Kimlik blob (v1/v2/v3) sarma/çözme** — `web/src/crypto/identity.ts`.
   Yükseltme yolunun güvenliği (eski blob → yeni blob sırasında bilgi
   sızıntısı), KEK türetme bağlama.
7. **Anahtar defteri (key_log) bütünlüğü** — `server/src/routes/keys.ts`
   + `web/src/lib/keytransparency.ts`. Append-only invariant, genesis
   hash, silinen hesabın satırı. Saldırı: sahte `entry_hash` (sunucu
   sahteciliği), sayfalama atlatma. **Faz 1 hotfix (race):** `resolveSignKeys`
   kendi userId'miz için RAM'deki `authStore.signPublicKey`'i kısayol
   olarak kabul eder; `chatStore`/`dmChatStore` `toDisplay` bunu kullanır —
   syncKeyLog tamamlanmadan kendi mesajımız decode olur, başkaları için
   yalnız zincir kanıtı geçerli (tehdit modeli bozulmaz). Test:
   `web/src/lib/signkeys.test.ts` (12 durum: self short-circuit, impostor
   reddi, harita birleşimi, key rotation).
8. **Key transparency gossip relay** — `server/src/ws/index.ts`
   `keylog_head` işleme. Sığ sınır, üye olmayan reddi, broadcast
   scope doğruluğu. Saldırı: büyük `communities` listesi DoS, geçersiz
   hash ile broadcast spam.
9. **Çoklu cihaz linking** — `server/src/routes/devices.ts` + WS
   `device:link_request`/`device:link_approved` akışı. Saldırı: link_token
   tek kullanımlık (5dk TTL), primary'ın başka user adına onay verememesi,
   joinee kimlik doğrulaması (Ed25519 imza + public key uyuşması).
10. **Rate limit + login kademeli blok** — `server/src/lib/rateLimit.ts` +
    `routes/auth.ts`. IP kovası + kullanıcı kovası ayrımı, XFF spoof
    (zaten kapatıldı: `trustProxy:true` + nginx `$remote_addr` overwrite),
    pencere içi art arda başarısız giriş → IP kademeli blok.
11. **TTL janitor + WS süresi geçen frame** — `server/src/lib/expire.ts`
    + `server/src/ws/index.ts`. Saldırı: janitor'un çalışmaması (TTL
    mesajı kalıcı), WS frame'de `expires_at` geçmiş olanı drop.
12. **WebAuthn PRF (cihaz kilidi)** — `web/src/crypto/devicekey.ts`.
    Saldırı: PRF değerinin tahmin edilebilirliği (tarayıcı tarafı),
    IndexedDB'den çalınan blob + PRF olmadan açılamaz kanıtı.

### P2 — düşük (zaman kalırsa)

13. **CSWSH (Cross-Site WebSocket Hijacking)** — çerez SameSite=Strict
    + WS auth-first-frame. Saldırı: üçüncü parti siteden WS bağlantısı.
14. **BIP-39 kurtarma** — `web/src/crypto/recovery.ts` + `web/src/crypto/bip39.ts`.
    Kelime listesi, checksum doğrulama, quiz konumu rastgeleliği.
15. **Davet linki ephemeral anahtar** — `web/src/crypto/invite.ts`.
    URL fragment'ta private key taşınması (fragment sunucuya gitmez),
    kod sızsa bile anahtar olmadan davet kullanılamaz.
16. **Katılım şifresi (Argon2id JW)** — `web/src/crypto/joinpw.ts`.
    JW türetme bağlama (salt + password), sızma senaryosu.

## 8. İletişim

Güvenlik açığı bildirimi (özel kanal):
[SECURITY.md](../SECURITY.md) — GitHub Private Vulnerability Reporting
(tercih), 72 saat ilk yanıt hedefi, 90 gün koordineli açıklama kuralı.

## 9. Referanslar

- Mimari: [ARCHITECTURE.md](../ARCHITECTURE.md)
- Ürün vaadi + tehdit modeli: [README.md](../README.md)
- Yol haritası: [SECURITY-ROADMAP.md](../SECURITY-ROADMAP.md)
- Faz 5 spec: [docs/faz5-dh-ratchet-design.md](faz5-dh-ratchet-design.md),
  [docs/faz5-ratchet-research.md](faz5-ratchet-research.md)
- Faz 6 spec: [docs/faz6-keygossip-design.md](faz6-keygossip-design.md)
- Faz 7 spec: [docs/faz7-multidevice-design.md](faz7-multidevice-design.md)
- Sürüm notları: [CHANGELOG.md](../CHANGELOG.md)
- Ağ/TLS: [docs/NETWORKING.md](NETWORKING.md),
  [deploy/vps-fresh-install.md](../deploy/vps-fresh-install.md)
- Tor: [deploy/tor-hidden-service.md](../deploy/tor-hidden-service.md)
- Kullanıcı gizlilik notu: [PRIVACY.md](../PRIVACY.md),
  [PRIVACY.en.md](../PRIVACY.en.md)
- Sertleştirme: [SECURITY.md "Kapsam dışı"](../SECURITY.md#kapsam-dışı--bilinen-ve-kabul-edilmiş-sınırlar)
- Test komutu: `npm test` (293 test, ~45 sn)
- CI: `.github/workflows/ci.yml`, `.github/workflows/release.yml`
