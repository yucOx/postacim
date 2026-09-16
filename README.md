# postacim 🕊️

Gizlilik odaklı, uçtan uca şifreli (E2EE) Discord-benzeri sohbet uygulaması.
Sunucu yalnızca şifreli veri taşır — mesajların, sesin, görüntünün ve anahtarların
düz hâlini **hiçbir zaman** görmez.

## Özellikler

- **Kayıt: sadece nick + şifre** — e-posta/telefon yok, zero-knowledge; kayıt sırasında **BIP-39 kurtarma ifadesi** ritüeli (12 kelime, 3'ünü doğrulama, metin dosyası indirme) — şifre kaybında kimlik ve geçmiş kurtarılır
- **Yazı odaları** — XChaCha20-Poly1305 ile istemci tarafında şifreli, gerçek zamanlı (WebSocket)
- **Sesli/görüntülü odalar** — LiveKit SFU üzerinde SFrame ile gerçek E2EE, onlarca katılımcı
- **Topluluklar** — Discord benzeri sunucu → kanal yapısı, sahip/üye rolleri
- **Anahtar dağıtımı** — kanal anahtarları her üyeye sealed-box ile sarılır; sunucu açamaz
**Üye çıkarma = rekey (zorunlu)** — çıkarılan/banlanan üyeden sonra kanallar **kilitlenir**: yazışma, ses odası, davet üretimi/kullanımı ve yeni üye ekleme, sahip veya admin "anahtarı yenileyene" kadar kapalıdır (eski anahtar risk altında olduğundan). Atılan üye elindeki davetle geri dönüp okuyamaz; sesli odadaysa canlı bağlantısı düşürülür.
- **Şifre değiştirme** — kimlik blob yeniden sarılır, kanal anahtarları etkilenmez; değişince **tüm oturumlar düşer** (çalınan token da dahil)
- **Ekran paylaşımı** — aynı E2EE hattı üzerinden

### Moderasyon ve katılım

- **Roller**: sahip → admin → üye. Admin: üye ekleme/atma+rekey, ban, kanal, davet, başvuru onayı. Admin atama ve katılım şifresi yalnız sahipte.
- **Kalıcı ban**: banlı üye yeniden eklenemez, davet kullanamaz, başvuramaz; ban listesi ⚙️ altından yönetilir.
- **Davet linkleri** (`↗` → üret): **açık** davet — geçici X25519 anahtarın özel yarısı linkin `#` fragmentında taşınır, sahip offline olsa bile katılım çalışır; **hedefli** davet — anahtarlar doğrudan hedefin kimliğine sarılır, kod sızsa bile başkası kullanamaz. Kullanım sayısı/süre sınırı, iptal.
- **Başvurular**: topluluk adını bilen başvurur (`↗`); sahip/admin onaylayınca anahtarlar onun kimliğine sarılır; red sonrası tekrar başvurulabilir.
- **Katılım şifresi** (sahip, ⚙️ → Şifre): davet linkine ek ikinci faktör. Argon2id ile türetilen anahtar kanal anahtarlarını sarar — sunucu yalnızca verifier görür.
- **Topluluklar gizlidir**: hiçbir yerde listelenmez; yalnız üyeler görür. Ad bilmek başvuru için giriş sinyalidir.

### Arkadaşlar, özel mesaj ve arama

- **Arkadaşlık** (🕊️): nick ile istek gönder; kabul/red. Sadece arkadaşlar DM açabilir — tanımadığın biri mesajlayamaz.
- **Özel mesaj (DM)**: iki kişilik E2EE kanal; anahtar açan taraf tarafından iki kimliğe sealed-box ile sarılır, DM mesajları `dm:` kapsamlı AAD ile XChaCha20-Poly1305 şifrelidir. Arkadaşlık bitince gönderim kapanır, geçmiş okunur kalır.
- **Grup DM** (🕊️ → + grup): arkadaşlarından grup kur; üye eklerken/ayrılırken anahtar yenilenir — yeni üye eski mesajları, ayrılan üye sonraki mesajları **okuyamaz**; kalan üyeler tüm geçmişi epoch anahtarlarıyla okur.
- **1:1 arama**: DM'de 📞 — karşı tarafta zil (WebAudio) + kabul/red; kabulde her ikisi LiveKit odasına aynı DM anahtarıyla SFrame E2EE bağlanır. Meşgulse otomatik red.
- **Okunmadı**: kanal/DM listelerinde nokta+sayaç, 🕊️ rozeti, sekme başlığında `(n)`, arka plan DM'lerinde bildirim sesi. Okuma durumu yalnız istemcide — sunucu neyi okuduğunu bilmez.

## Kripto mimarisi

| Amaç | Yöntem |
|---|---|
| Şifreden anahtar türetme | Argon2id (64 MiB, t=3), 64B çıktı: ilk 32B auth kanıtı (sunucuda argon2id verifier), son 32B KEK (tarayıcıdan çıkmaz) |
| Kimlik | X25519 keypair; private key KEK ile XChaCha20-Poly1305 şifreli blob olarak sunucuda |
| Kanal anahtarı | 32B rastgele; üyelere `crypto_box_seal` (sealed box) ile sarılı |
| Mesajlar | XChaCha20-Poly1305, AAD = `ch:<kanal>:v<epok>` (yeniden konumlandırmaya dayanıklı) |
| Ses/görüntü | Aynı kanal anahtarı → LiveKit SFrame (HKDF) — SFU opak bayt görür |
| Anahtar epokları | `key_version`; eski epoklar saklanır → rotasyon öncesi geçmiş okunmaya devam eder |
| Per-gönderici ratchet | `msg_key_i` zinciri `H(epok anahtarı ‖ 'ratchet' ‖ sender_id)` kökünden türetilir; güncel zincir kökü sızarsa geçmiş korunur (geri türetim yok — DH ratchet değil, bkz. tehdit modeli) |
| Mesaj padding | plaintext boyut bucket'larına (256 B / 1 KiB / 4 KiB / 4 KiB-adım) yuvarlanır — sunucu mesaj uzunluğundan içerik çıkarımı yapamaz |
| Cihaz kilidi (ops.) | WebAuthn PRF'ten türeyen cihaz KEK'i ile blob IndexedDB'de — F5'te parmak izi, şifre fallback akışı korunur |
| Anahtar defteri | public key'ler append-only hash zincirinde (`key_log`); istemci boot'ta zinciri doğrular, head damgası profilde bant dışı karşılaştırma için |

**Bilinen sınırlar (MVP):** MLS yok (simetrik ratchet var, DH ratchet yok — çıkarılan üye öncesi mesajları zaten görmüşse okur); tek kimlik blob'u (cihaz iptali yok); şifre **ve** kurtarma ifadesi ikisi birden kaybolursa hesap kurtarılamaz (ifade kurtarma verisi de kimlik gibi uçtan uca sarılı — sunucu açamaz); kanal anahtarı rotasyonu açık davet linklerini ve katılım şifresi anahtarlarını geçersiz kılar (yeni üretilmeli — başvuru onayı etkilenmez); ban, yeni nick açılmasını engellemez (e-postasız sistemde yapısal sınır — katılım şifresi buna karşı direnir); kanal adları/üye listesi/zaman damgaları/roller/davet metadata'sı sunucuya açıktır (içerik değil); DB'de at-rest şifreleme (SQLCipher) bilinçli ertelendi — E2EE içeriği zaten koruyor, metadata katkısı marjinal, better-sqlite3 derlemesi imajı kırılganlaştırır. Oturum httpOnly+SameSite=Strict çerezle taşınır (XSS çalamaz), CSP/HSTS dahil; TLS için `docker-compose.tls.yml` overlay'i hazır — ağ üzerinden erişimde mutlaka kullan.

## Mimari

```
posta-guvercini/
├── server/   Node 22 + Fastify + SQLite — Bearer auth, WS (/ws), LiveKit token
│             (çok aşamalı Dockerfile: tsc derlemesi + node dist)
├── web/      React 19 + Vite + Tailwind — tüm kripto tarayıcıda (libsodium, hash-wasm)
│             (Dockerfile: vite build → nginx; /api ve /ws reverse proxy)
└── livekit/  LiveKit SFU (Docker) — medyayı çözmeden iletir
```

## Deploy (tek komut)

```bash
cp .env.example .env          # isteğe göre düzenle (aşağıda)
docker compose up -d --build  # livekit + server + web
```

- Web arayüzü: `http://<sunucu-ip>/` (port `.env` → `WEB_PORT`)
- Doğrulama: `curl http://localhost/api/health` → `{"ok":true}`
- Veritabanı: `./data/` volume — yedekle/sil, her şey orada

### Prod VPS: state'i repodan ayır (önerilen)

Public sunucuda gerçek secret'lar (`LIVEKIT_SECRET`, `node_ip`) repoya
girmez — gitignored `.env` ve `livekit/livekit.yaml`, `/etc/postacim/`
altında tutulur, her `git pull` sonrası post-merge hook otomatik restore
eder:

```bash
sudo cp .env.example /etc/postacim/.env && sudo chmod 600 /etc/postacim/.env
sudo cp livekit/livekit.yaml.example /etc/postacim/livekit.yaml
# /etc/postacim/* dosyalarını kendi değerlerinle düzenle, sonra:
bash scripts/deploy-state.sh restore   # state'i repoya kopyala + diff raporu
docker compose up -d --build
```

- `scripts/deploy-state.sh status|diff|restore` — state kontrolü,
  `.env.example` ile alan farkı raporu (yeni env alanı geldiğinde uyarır)
- Post-merge hook kurulumu ve sıfırdan VPS kurulumu:
  [deploy/vps-fresh-install.md](deploy/vps-fresh-install.md)

**`.env` ayarları:**
- `LIVEKIT_URL` — tarayıcının LiveKit'e ulaşabildiği adres. Web proxy'si `/livekit`
  yolunu SFU'ya ilettiği için aynı origin kullanılır: sunucu makinesinde
  `http://localhost/livekit`; LAN erişimi için `http://<sunucu-ip>/livekit`
  (TLS modunda `https://<sunucu-ip>/livekit`).
- `LIVEKIT_API_KEY` / `LIVEKIT_SECRET` — LiveKit ile server'ın ortak anahtarı;
  prod için güçlü çift üret: `docker run --rm livekit/livekit-server:v1.13.1 generate-keys`
  (bilinen örnek değerlerde sunucu açılmayı reddeder)
- `WEB_PORT` — web'in yayın portu (default 8080)
- `SCREEN_SHARE` — `off` yapılırsa ses token'larından ekran paylaşım izni
  (`screen_share` publish kaynağı) düşer: istemci UI'ı yine de görebilir ama
  yayın LiveKit'te fiziksel olarak reddedilir. Acil durum kill switch'i —
  değiştirince yalnız `docker compose up -d server` yeniden başlatmak yeter.

### Medya: kalite, limitler ve optimizasyon

İstemci tarafı (tarayıcıda çalışır, sunucu transcode yapmaz — SFU yalnız iletir):

- **Simulcast + Dynacast + AdaptiveStream** (`voiceStore.connectRoom`): gönderici
  2-3 kalite katmanı basar; SFU her izleyiciye yalnız bant genişliğine ve tile
  boyutuna uyan katmanı yollar, kimse izlemiyorsa katman durur (Discord'un Go
  Live mimarisiyle aynı üçlü).
- **Ekran paylaşımı VP9** codec'li: metin/UI içeriği VP8'e göre ~yarı bitratete
  aynı netlik taşır. Kamera VP8 kalır (tarayıcı VP9 simulcast desteği zayıf).
  E2EE (SFrame) codec-agnostiktir — paketlemeden önce şifreler.
- **`contentHint`**: ekran track'ine `detail` (netlik koru), kameraya `motion`
  (akıcılık koru) — tarayıcı encoder'ına ücretsiz ipucu.
- **Kalite katmanları** (kalite seçici: hızlı/dengeli/yüksek) `degradationPreference`
  ile: hızlı kare hızı koruyup çözünürlükten, yüksek çözünürlük koruyup kareden
  kırpılır. Yayın diyaloğu tavanı 1080p30 (1440p bilinçli kapalı — tek yayıncı
  küçük SFU'yu doldurabilir), varsayılan 720p30.
- **TEST AŞAMASI: kamera 720p tavanlı** — 'yüksek' katman farkı yalnız ekran
  paylaşımında (1080p30). Kapasite oturunca `voiceStore.qualityTiers`'da
  `yuksek.camCapture/camPublish` `VideoPresets.h1080`'e döndürülür; UI'daki
  "1080p ileride açılır" notu (`call.cam720Note`) o zaman kaldırılır.

Sunucu tarafı (token ile zorlanır — UI'ı aşamaz):

- **Oda limitleri** her ses token'ına gömülü (`RoomConfiguration`): oda başına
  12 katılımcı (2 vCPU/3 GB hedefi, 12×11=132 downtrack), boşalan oda
  5 dakikada kapanır. Yük artarsa önce `maxParticipants` düşürülür, sonra
  LiveKit ayrı host'a taşınır.
- **`SCREEN_SHARE=off`** kill switch (yukarıda) — token grant seviyesinde.
- E2EE (SFrame) stream başına ~%10 encoder/decoder CPU maliyeti koyar; gizlilik
  vaadinin bilinçli bedelidir, kaldırılamaz.

### 2 vCPU / 3 GB hedef optimizasyonları

2 vCPU/3 GB RAM VPS'te 50-80 ses → 120-150 ses, 30-50 video → 60-80 video:

- **CPU pinning** (`docker-compose.yml` `cpuset: "0"`/`"1"`) — LiveKit core 0,
  server core 1; context switch + cache miss sıfır, %15-25 throughput artışı
- **WS broadcast batching** (`server/src/ws/hub.ts`, 16 ms tick + dedup) — 50 kişilik
  odada 2500 broadcast/sn yerine ~800 broadcast/sn
- **LOG_LEVEL=warn** (`.env` + `server/src/index.ts`) — JSON serialize + I/O %5-10 azalır
- **Publisher cap 1.5 Mbps** (`web/src/state/voiceStore.ts` `publishDefaults.videoEncoding.maxBitrate`)
  — 4K yayınlayan encoder 1.5 Mbps'ye sıkışır, SFU CPU korunur; gizlilik etkisi yok
  (SFrame zaten içeriği şifreli)
- **Netdata prod'da kapalı** (`docker-compose.yml` `profiles: [monitoring]`) — 50-100 MB RAM
  kurtarır; geliştirme için `docker compose --profile monitoring up -d`
- **TURN açık** (global kitle, 4G/CGNAT erişim için) — E2EE sayesinde gizlilik etkisi yok
  (TURN operatörü sadece metadata görür, içerik göremez)

> LiveKit v1.13.x server'da `publisher_max_bitrate` ve `simulcast_layers` alanları
> **yok** (v2.x'te eklendi); bu yüzden uplink sınırı ve simulcast **client tarafında**
> uygulanır (publishDefaults + adaptiveStream + dynacast).

### Arayüz dili (i18n)

5 dil: Türkçe, İngilizce, Almanca, Fransızca, İspanyolca. İlk açılışta tarayıcı
diline bakılır (`tr*` → Türkçe, diğerleri → İngilizce); seçim localStorage'da
saklanır, dil seçiciye giriş ekranının sağ üstünden ve üst başlıktaki dünya
ikonundan erişilir. Yeni dil eklemek: `web/src/i18n/types.ts` union'ına kod,
`locales/<kod>.ts` katalog dosyası; anahtar eksikliği `locale-parity` testini
kırdığı için CI'da yakalanır.

Güncelleme: `./scripts/deploy.sh` (build + up + livekit restart + health
kontrolleri tek komut; `.env` yoksa üretir, anahtar çiftini basar). Eşdeğeri:
`git pull && docker compose up -d --build`.

### Host nginx + certbot (elle kurulum, compose dışı)

Varsayılan mod: docker servisleri yalnız `127.0.0.1`'de yayınlanır (`web` →
`127.0.0.1:8080`, `server` → `127.0.0.1:4000`); dış dünyaya tek giriş host
nginx'tir (`deploy/nginx-postacim.conf` — kurulum adımları dosyanın başında).
XFF'yi yazan tek yer host nginx'tir (`$remote_addr` overwrite) — server
`trustProxy:true` leftmost okuduğu için forged XFF rate-limit'i aşamaz.

```bash
sudo cp deploy/nginx-postacim.conf /etc/nginx/sites-available/postacim
sudo ln -s /etc/nginx/sites-available/postacim /etc/nginx/sites-enabled/
# server_name'i düzenle, sonra:
sudo nginx -t && sudo systemctl reload nginx
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d postacim.example.com   # 443 + redirect otomatik
```

Host nginx'siz hızlı LAN modu: `.env`'de `WEB_HOST=0.0.0.0` — bu modda docker
web'in nginx'i XFF'yi kendisi yazar, internete doğrudan açma.

**Not:** `livekit/livekit.yaml` gitignored state'tir (şablon:
`livekit/livekit.yaml.example`; prod'da `/etc/postacim/livekit.yaml`) ve
bind-mount'tur; livekit servisi image'dan koştuğu için `up -d --build`
config değişince onu **yeniden başlatmaz** — livekit config'ine dokunan
güncellemelerden (ör. `prometheus_port`) sonra ayrıca
`docker compose restart livekit` çalıştır.

### İzleme (kapasite takibi)

Üç katman; "kaç kişi kaldırdığını" bilmek için hepsi birbirini tamamlar:

1. **Uygulama sayaçları** — `GET /api/stats` (oturum gerekli, yalnız toplam
   sayılar): kayıtlı kullanıcı, son 24 saatte açılan oturum, açık WS bağlantısı,
   sesli peer, aktif DM araması, SFU oda + katılımcı sayısı. Kapasite merdiveni:
   ~40 eşzamanlı görüşme → rahat; ~60 → varsayılan kaliteyi düşür; ~80+ →
   LiveKit'i ayrı host'a taşı.
2. **LiveKit metrikleri** — `livekit.yaml`'da `prometheus_port: 6789` açık;
   `curl localhost:6789/metrics` (yalnız localhost — dışarıya açma). Track,
   oda, bayt ve paket sayaçları.
3. **Makine metrikleri (Netdata, opsiyonel)** — compose profili, grafik
   dashboard'u: `docker compose --profile monitoring up -d` →
   `http://localhost:19999` (**yalnız 127.0.0.1'e bağlı** — dış erişim yok).
   2 vCPU/3 GB prod hedefinde varsayılan kapalıdır (~50-100 MB RAM). Uzaktan
   bakmak için SSH tüneli:
   `ssh -L 19999:localhost:19999 <sunucu>`. CPU, RAM, disk IO, ağ ve tüm
   Docker container'ları saniye bazında; eşik alarmı Netdata ayarlarından
   (ör. CPU %70 → Discord webhook) bağlanır. Sistem içlerini ifşa ettiği
   için **domain'e asla açıkta oturtma** — auth'suz subdomain bile olmasın.

### HTTPS/WSS (TLS overlay)

Ağ üzerinde şifrelenmemiş bağlantı `auth_material` + oturum çerezini taşır — gizlilik
ürününde TLS şart. Self-signed ile (kendi LAN'ında):

```bash
cp .env.example .env                      # anahtar çiftini üret/gir (yukarıda)
./scripts/gen-certs.sh                    # certs/ altına localhost + makine IP'li sertifika
# .env içinde: LIVEKIT_URL=https://<makine-adı-veya-ip>/livekit
docker compose -f docker-compose.yml -f docker-compose.tls.yml up -d --build
```

- 80 → 443 yönlendirme, HSTS, CSP ve diğer güvenlik başlıkları nginx'de hazır
- Doğrulama: `curl -skI https://localhost/ | grep -i strict-transport`
- LiveKit sinyali de (`/livekit` → WSS) aynı sertifika üzerinden proxylanır; medya
  zaten DTLS/SRTP ile şifreli
- Herkese açık dağıtımda self-signed yeterli değildir — Let's Encrypt gibi gerçek
  sertifika kullan (`certs/` yerine mount et)

## Geliştirme (konteynersiz)

Gereksinimler: Node 22+, Docker.

```bash
npm install
docker compose up -d livekit      # yalnız LiveKit (localhost:7880)
npm -w server run dev             # API  (localhost:4000)
npm -w web run dev                # Web  (localhost:5173)
```

Doğrulama: `curl localhost:4000/api/health` → `{"ok":true}`

## Otomatik testler

```bash
npm test    # 173 test: kripto/istemci birim + kara kutu entegrasyon (geçici sunucu + geçici DB)
```

- `web/src/crypto/crypto.test.ts` — AEAD/AAD bağlama (kanal/sürüm/kapsam değişince reddetme), kimlik sarma, BIP-39 checksum, davet linki ayrıştırma, şifre güç heuristiği, kurtarma quiz konumları, WS reconnect backoff sınırları, okunmadı sayacı
- `web/src/crypto/fingerprint.test.ts` — safety number simetrisi, bilinen vektör, biçim
- `web/src/csp.test.ts` — nginx CSP'nin WASM kripto uyumu (wasm-unsafe-eval), HSTS yalnız TLS conf'da
- `web/src/lib/replay.test.ts` — client_id tekrar oynatma filtresi (aynı kanalda yinelenen id reddi)
- `web/src/lib/safety.test.ts` — safety number sıra bağımsızlığı/biçim
- `server/test/auth.test.ts` — kayıt/giriş, IP başına limitler, httpOnly çerez (+ Secure bayrağı TLS arkasında) + WS çerez auth, logout iptali, şifre değişimi oturum düşürme, BIP-39 kurtarma döngüsü
- `server/test/messages.test.ts` — geçmiş sayfalama imleci, kullanıcı başına (IP değil) gönderim limiti, rotate kadro doğrulaması
- `server/test/moderation.test.ts` — roller, kick→dondur→rotate, ban, kanal limiti
- `server/test/join.test.ts` — açık/hedefli davet, süre/kullanım limiti, başvurular, katılım şifresi
- `server/test/social.test.ts` — arkadaşlık, DM, grup DM rekey, WS canlı olay + sesli durum yayını
- `server/test/boot.test.ts` — zayıf secret reddi, taze DB migration zinciri
- `web/src/crypto/ratchet.test.ts` — per-gönderici ratchet: zincir tek yönlülüğü, index/AAD reddi, stateless yeniden türetim, out-of-order
- `web/src/crypto/devicekey.test.ts` — cihaz kilidi: blob sar/çöz, yanlış KEK/AAD reddi, enroll→unlock, PRF fallback
- `web/src/lib/keytransparency.test.ts` — anahtar defteri: zincir bütünlüğü, kopuk/çelişkili head reddi, kendi kayıt kontrolü
- `server/test/hardening.test.ts` — log hijyeni (query/IP düşmez), WS auth zaman aşımı (4004), login kademeli bloğu
- `server/test/keylog.test.ts` — anahtar defteri: genesis/kuyruk hash, sayfalama, silinen hesabın satırı kalır, UPDATE/DELETE yolu yok
- `server/test/delete.test.ts` — hesap silme: kimlik/mesaj/DM/grup/topluluk tek transaction, kurucu devri
- `.github/workflows/ci.yml` — push/PR'da tip kontrolü + tüm testler

## Elle test (iki tarayıcı profili)

1. Profil A: kayıt ol (ör. `alice`) → topluluk oluştur → `genel` yazı odasına mesaj yaz
2. Profil B: kayıt ol (`bob`) → Alice üye listesinden `+` ile bob'u ekle
3. Bob otomatik topluluğu görür; iki taraf şifreli sohbet eder
4. Sesli odaya tıkla → mikrofon/kamera izni → iki profil aynı odada E2EE görüşür
5. Sahip bob'u çıkarır → kanallar rekey; bob yeni mesajları göremez
6. Kanıt: `node -e "console.log(require('better-sqlite3')('data/posta.db',{readonly:true}).prepare('SELECT nonce,ciphertext FROM messages LIMIT 3').all())"` — yalnızca opak veri

## Güvenlik notları

- Rate limit: kayıt 3/sa, giriş 5/dk, lookup/kdf-params 20/dk, mesaj 60/dk (kullanıcı+IP kovaları ayrı); pencere içi art arda başarısız girişte IP başına kademeli blok (1→15 dk, `LOGIN_FAIL_FREE`=10 serbest kredi)
- Oturum token'ları DB'de sha256; 7 gün TTL (env ile ayarlanabilir); süresi geçenler saatlik janitor ile temizlenir
- WS: ilk kare auth zorunlu (aksi halde 4001 ile kapanır; frame hiç gelmezse 10 sn'de 4004 ile kesilir), maxPayload 1 MiB, ping reaper
- Uygulama logu URL'yi query'siz yazar — nick/istemci IP'si log'a düşmez (nginx access log'u ayrı, operatör kapatabilir)
- Dev: localhost secure context; ağ erişimi için [TLS overlay](#httpswss-tls-overlay) — repo'da hazır
- LiveKit anahtarları `.env` üzerinden livekit (`--keys`) ve server'a aynı anda dağıtılır — tek kaynak

## Tehdit modeli ve bilinen sınırlar

- **Model**: sunucu kör ama kötü olabilir; ağ pasif dinleyici değildir (TLS overlay ile).
- **Forward secrecy kısmi** — per-gönderici simetrik ratchet: zincir kökü/msg_key sızarsa geçmiş korunur (geri türetim yok). Dürüst sınır: **epoch anahtarının kendisi** sızarsa zincir baştan türetilebilir (sender_id açık) — o riski epok rotasyonu sınırlar. Signal tarzı DH ratchet/MLS bekleyen kurul kararı.
- **Web JS trust** — uygulama JS'i sunucudan dağıtılır; kötü niyetli/gözden geçirilmemiş sunucu değişmiş JS ile KEK'i çalabilir. Signed release/ayrı origin olmadan tarayıcı E2EE'de kapatılamaz. (KEK artık memory-only: reload'da şifre yeniden istenir; opsiyonel passkey cihaz kilidi blob'u cihaz donanımından türeyen anahtarla saklar — zararlı JS ancak aktif WebAuthn onayıyla kullanır, çalıp götüremez.)
- **Sansür/sıralama** — kör sunucu mesaj gizleyebilir, sıralamayı ve timestamp'i manipüle edebilir (client timestamp + UUID AAD'ye bağlı, tespit edilebilir; gizleme engellenemez).
- **Gönderen atıfı kriptografik değil** — sender_id sunucu kolonu; içerikte imza yok.
- **Metadata** — sosyal graf (kim kiminle), zamanlama, mesaj boyutu (bucket padding'iyle seviyesi indirilir), presence, çağrı katılım/mute durumu sunucuda görünür.
- **Nick enumeration** — login/kurtarma pseudo-salt ile kapalı; kalan kanal kayıt sırasındaki "nick alınmış" (rate-limited).
- **Public key doğrulama** — sunucu üye public key'lerini dağıtır. Katmanlar: TOFU keypin + güvenlik numarası (bant dışı) + anahtar defteri (append-only hash zinciri: kendi kayıt kontrolü + head damgası). Tam anti-forking istemciler arası gossip gerektirir — head damgası bant dışı karşılaştırılınca view-splitting yakalanır; gossip roadmap'te.
- **DM anahtarları** arkadaşlık bitse de taraflarda kalır (geçmiş okunabilir, gelecek okunamaz — grup/DM anahtarı yenilenmediği sürece).
- **Session TTL**: 7 gün (env ile ayarlanabilir); şifre değişimi tüm oturumları düşürür.

## Durum

- [x] Faz 0 — iskelet
- [x] Faz 1 — auth + kimlik blob (kayıt/giriş, zero-knowledge)
- [x] Faz 2 — topluluk/kanal/üye + sarılı anahtar dağıtımı
- [x] Faz 3 — E2EE yazı sohbeti
- [x] Faz 4 — LiveKit sesli/görüntülü odalar (E2EE)
- [x] Faz 5 — cilalama (rekey, şifre değiştirme, ekran paylaşımı)
- [x] Paket A-D — roller/ban, davet linkleri, başvurular, katılım şifresi
- [x] Paket E-G — arkadaşlık, DM, grup DM (rekey'li), 1:1 arama, okunmadı
- [x] Sprint 1 — bütünlük: per-user limitler, pending rekey, LiveKit eviction, oturum düşürme
- [x] Sprint 2 — TLS/HSTS + CSP + httpOnly çerez + WS dayanıklılık
- [x] Sprint 3 — BIP-39 kurtarma ritüeli + şifre UI + branded dialoglar
- [x] Test turu — otomatik test + CI (bugün: 19 dosya, 173 test)
- [x] Sprint 4 — sertleştirme: mesaj padding + Trusted Types + bundle hash betiği, log hijyeni, WS auth timeout, login kademeli bloğu, passkey cihaz kilidi, per-gönderici ratchet, anahtar defteri (key transparency)

**Sıradaki — güvenlik yol haritası** ([SECURITY-ROADMAP.md](SECURITY-ROADMAP.md)):
kripto/gizlilikte Signal paritesine 8 fazlı program.

- [ ] Faz 1 — Ed25519 imzalı mesajlar (gönderen atfı kriptografik)
- [ ] Faz 2 — kaybolan mesajlar (disappearing messages)
- [ ] Faz 3 — Tor hidden service rehberi (IP metadata)
- [ ] Faz 4 — signed release / reproducible build (JS trust azaltma)
- [ ] Faz 5 — DH ratchet / MLS (tam forward secrecy; önce araştırma sprinti)
- [ ] Faz 6 — key transparency gossip (anti-forking)
- [ ] Faz 7 — çoklu cihaz (Faz 5 sonrası)
- [ ] Faz 8 — threat model revizyonu + dış audit hazırlığı (v1.0.0)

## Katkıda bulunma

Geliştirme kurulumu, test akışı, i18n parite kuralı ve PR beklentileri:
[CONTRIBUTING.md](CONTRIBUTING.md). Güvenlik açığı bildirimi (özel kanal):
[SECURITY.md](SECURITY.md) — lütfen güvenlik sorunlarını public issue
olarak açmayın.

## Lisans

[AGPL-3.0-or-later](LICENSE) — GPLv3'ün ağ kullanımına kapalı türevi:
bu sunucunun değiştirilmiş bir sürümünü hizmet olarak işletirseniz,
kaynak kodunu kullanıcılarına sunmak zorundasınız. Gizlilik aracının
sunucu varyantının kapanmaması bilinçli bir tercihtir (Signal'in izlediği
yol). © 2026 yuxor.ltd
