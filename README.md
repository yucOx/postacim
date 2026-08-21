# postacim 🕊️

Gizlilik odaklı, uçtan uca şifreli (E2EE) Discord-benzeri sohbet uygulaması.
Sunucu yalnızca şifreli veri taşır — mesajların, sesin, görüntünün ve anahtarların
düz hâlini **hiçbir zaman** görmez.

## Özellikler

- **Kayıt: sadece nick + şifre** — e-posta/telefon yok, zero-knowledge
- **Yazı odaları** — XChaCha20-Poly1305 ile istemci tarafında şifreli, gerçek zamanlı (WebSocket)
- **Sesli/görüntülü odalar** — LiveKit SFU üzerinde SFrame ile gerçek E2EE, onlarca katılımcı
- **Topluluklar** — Discord benzeri sunucu → kanal yapısı, sahip/üye rolleri
- **Anahtar dağıtımı** — kanal anahtarları her üyeye sealed-box ile sarılır; sunucu açamaz
- **Üye çıkarma = rekey** — çıkarılan üye sonrası tüm kanallar yeni anahtara döner
- **Şifre değiştirme** — kimlik blob yeniden sarılır, kanal anahtarları etkilenmez
- **Ekran paylaşımı** — aynı E2EE hattı üzerinden

### Moderasyon ve katılım

- **Roller**: sahip → admin → üye. Admin: üye ekleme/atma+rekey, ban, kanal, davet, başvuru onayı. Admin atama ve katılım şifresi yalnız sahipte.
- **Kalıcı ban**: banlı üye yeniden eklenemez, davet kullanamaz, başvuramaz; ban listesi ⚙️ altından yönetilir.
- **Davet linkleri** (`↗` → üret): **açık** davet — geçici X25519 anahtarın özel yarısı linkin `#` fragmentında taşınır, sahip offline olsa bile katılım çalışır; **hedefli** davet — anahtarlar doğrudan hedefin kimliğine sarılır, kod sızsa bile başkası kullanamaz. Kullanım sayısı/süre sınırı, iptal.
- **Başvurular**: topluluk adını bilen başvurur (`↗`); sahip/admin onaylayınca anahtarlar onun kimliğine sarılır; red sonrası tekrar başvurulabilir.
- **Katılım şifresi** (sahip, ⚙️ → Şifre): davet linkine ek ikinci faktör. Argon2id ile türetilen anahtar kanal anahtarlarını sarar — sunucu yalnızca verifier görür.
- **Topluluklar gizlidir**: hiçbir yerde listelenmez; yalnız üyeler görür. Ad bilmek başvuru için giriş sinyalidir.

## Kripto mimarisi

| Amaç | Yöntem |
|---|---|
| Şifreden anahtar türetme | Argon2id (64 MiB, t=3), 64B çıktı: ilk 32B auth kanıtı (sunucuda argon2id verifier), son 32B KEK (tarayıcıdan çıkmaz) |
| Kimlik | X25519 keypair; private key KEK ile XChaCha20-Poly1305 şifreli blob olarak sunucuda |
| Kanal anahtarı | 32B rastgele; üyelere `crypto_box_seal` (sealed box) ile sarılı |
| Mesajlar | XChaCha20-Poly1305, AAD = `ch:<kanal>:v<epok>` (yeniden konumlandırmaya dayanıklı) |
| Ses/görüntü | Aynı kanal anahtarı → LiveKit SFrame (HKDF) — SFU opak bayt görür |
| Anahtar epokları | `key_version`; eski epoklar saklanır → rotasyon öncesi geçmiş okunmaya devam eder |

**Bilinen sınırlar (MVP):** MLS/forward-secrecy yok (çıkarılan üye öncesi mesajları zaten görmüşse okur); tek kimlik blob'u (cihaz iptali yok); kanal anahtarı rotasyonu açık davet linklerini ve katılım şifresi anahtarlarını geçersiz kılar (yeni üretilmeli — başvuru onayı etkilenmez); ban, yeni nick açılmasını engellemez (e-postasız sistemde yapısal sınır — katılım şifresi buna karşı direnir); kanal adları/üye listesi/zaman damgaları/roller/davet metadata'sı sunucuya açıktır (içerik değil).

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
- `LIVEKIT_URL` — tarayıcının LiveKit'e ulaşabildiği adres. Sunucu makinesinde
  `http://localhost:7880`; LAN üzerinden erişim için `http://<sunucu-ip>:7880` yap.
- `LIVEKIT_API_KEY` / `LIVEKIT_SECRET` — LiveKit ile server'ın ortak anahtarı;
  prod için güçlü çift üret: `docker run --rm livekit/livekit-server:v1.13.1 generate-keys`
- `WEB_PORT` — web'in yayın portu (default 80)

Güncelleme: `git pull && docker compose up -d --build`.

## Geliştirme (konteynersiz)

Gereksinimler: Node 22+, Docker.

```bash
npm install
docker compose up -d livekit      # yalnız LiveKit (localhost:7880)
npm -w server run dev             # API  (localhost:4000)
npm -w web run dev                # Web  (localhost:5173)
```

Doğrulama: `curl localhost:4000/api/health` → `{"ok":true}`

## Test (iki tarayıcı profili)

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
