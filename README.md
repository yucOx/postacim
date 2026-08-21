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

**Bilinen sınırlar (MVP):** MLS/forward-secrecy yok (çıkarılan üye öncesi mesajları zaten görmüşse okur); tek kimlik blob'u (cihaz iptali yok); şifre **ve** kurtarma ifadesi ikisi birden kaybolursa hesap kurtarılamaz (ifade kurtarma verisi de kimlik gibi uçtan uca sarılı — sunucu açamaz); kanal anahtarı rotasyonu açık davet linklerini ve katılım şifresi anahtarlarını geçersiz kılar (yeni üretilmeli — başvuru onayı etkilenmez); ban, yeni nick açılmasını engellemez (e-postasız sistemde yapısal sınır — katılım şifresi buna karşı direnir); kanal adları/üye listesi/zaman damgaları/roller/davet metadata'sı sunucuya açıktır (içerik değil). Oturum httpOnly+SameSite=Strict çerezle taşınır (XSS çalamaz), CSP/HSTS dahil; TLS için `docker-compose.tls.yml` overlay'i hazır — ağ üzerinden erişimde mutlaka kullan.

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

**`.env` ayarları:**
- `LIVEKIT_URL` — tarayıcının LiveKit'e ulaşabildiği adres. Web proxy'si `/livekit`
  yolunu SFU'ya ilettiği için aynı origin kullanılır: sunucu makinesinde
  `http://localhost/livekit`; LAN erişimi için `http://<sunucu-ip>/livekit`
  (TLS modunda `https://<sunucu-ip>/livekit`).
- `LIVEKIT_API_KEY` / `LIVEKIT_SECRET` — LiveKit ile server'ın ortak anahtarı;
  prod için güçlü çift üret: `docker run --rm livekit/livekit-server:v1.13.1 generate-keys`
  (bilinen örnek değerlerde sunucu açılmayı reddeder)
- `WEB_PORT` — web'in yayın portu (default 80)

Güncelleme: `git pull && docker compose up -d --build`.

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
npm test    # 52 test: kripto birim + kara kutu entegrasyon (geçici sunucu + geçici DB)
```

- `web/src/crypto/crypto.test.ts` — AEAD/AAD bağlama (kanal/sürüm/kapsam değişince reddetme), kimlik sarma, BIP-39 checksum, davet linki ayrıştırma
- `server/test/auth.test.ts` — kayıt/giriş, IP başına limitler, httpOnly çerez + WS çerez auth, şifre değişimi oturum düşürme, BIP-39 kurtarma döngüsü
- `server/test/moderation.test.ts` — roller, kick→dondur→rotate, ban, kanal limiti
- `server/test/join.test.ts` — açık/hedefli davet, süre/kullanım limiti, başvurular, katılım şifresi
- `server/test/social.test.ts` — arkadaşlık, DM, grup DM rekey, WS canlı olay
- `server/test/boot.test.ts` — zayıf secret reddi, taze DB migration zinciri

## Elle test (iki tarayıcı profili)

1. Profil A: kayıt ol (ör. `alice`) → topluluk oluştur → `genel` yazı odasına mesaj yaz
2. Profil B: kayıt ol (`bob`) → Alice üye listesinden `+` ile bob'u ekle
3. Bob otomatik topluluğu görür; iki taraf şifreli sohbet eder
4. Sesli odaya tıkla → mikrofon/kamera izni → iki profil aynı odada E2EE görüşür
5. Sahip bob'u çıkarır → kanallar rekey; bob yeni mesajları göremez
6. Kanıt: `node -e "console.log(require('better-sqlite3')('data/posta.db',{readonly:true}).prepare('SELECT nonce,ciphertext FROM messages LIMIT 3').all())"` — yalnızca opak veri

## Güvenlik notları

- Rate limit: kayıt 3/sa, giriş 5/dk, lookup/kdf-params 20/dk, mesaj 60/dk
- Oturum token'ları DB'de sha256; 30 gün TTL; Authorization header'ı loglardan redakte
- WS: ilk kare auth zorunlu (aksi halde 4001 ile kapanır), maxPayload 1 MiB, ping reaper
- Dev: localhost secure context; prod için Caddy (HTTPS) + LiveKit TLS + coturn TLS önerilir — MVP dışı
- LiveKit anahtarları `.env` üzerinden livekit (`--keys`) ve server'a aynı anda dağıtılır — tek kaynak

## Durum

- [x] Faz 0 — iskelet
- [x] Faz 1 — auth + kimlik blob (kayıt/giriş, zero-knowledge)
- [x] Faz 2 — topluluk/kanal/üye + sarılı anahtar dağıtımı
- [x] Faz 3 — E2EE yazı sohbeti
- [x] Faz 4 — LiveKit sesli/görüntülü odalar (E2EE)
- [x] Faz 5 — cilalama (rekey, şifre değiştirme, ekran paylaşımı)
