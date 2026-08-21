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

## Kripto mimarisi

| Amaç | Yöntem |
|---|---|
| Şifreden anahtar türetme | Argon2id (64 MiB, t=3), 64B çıktı: ilk 32B auth kanıtı (sunucuda argon2id verifier), son 32B KEK (tarayıcıdan çıkmaz) |
| Kimlik | X25519 keypair; private key KEK ile XChaCha20-Poly1305 şifreli blob olarak sunucuda |
| Kanal anahtarı | 32B rastgele; üyelere `crypto_box_seal` (sealed box) ile sarılı |
| Mesajlar | XChaCha20-Poly1305, AAD = `ch:<kanal>:v<epok>` (yeniden konumlandırmaya dayanıklı) |
| Ses/görüntü | Aynı kanal anahtarı → LiveKit SFrame (HKDF) — SFU opak bayt görür |
| Anahtar epokları | `key_version`; eski epoklar saklanır → rotasyon öncesi geçmiş okunmaya devam eder |

**Bilinen sınırlar (MVP):** MLS/forward-secrecy yok (çıkarılan üye öncesi mesajları zaten görmüşse okur); tek kimlik blob'u (cihaz iptali yok); üye eklemek için sahipin çevrimiçi olması gerekir; kanal adları/üye listesi/zaman damgaları sunucuya açık metadata'dır.

## Mimari

```
posta-guvercini/
├── server/   Node 22 + Fastify + SQLite — Bearer auth, WS (/ws), LiveKit token
├── web/      React 19 + Vite + Tailwind — tüm kripto tarayıcıda (libsodium, hash-wasm)
└── livekit/  LiveKit SFU (Docker) — medyayı çözmeden iletir
```

## Çalıştırma

Gereksinimler: Node 22+, Docker.

```bash
npm install
docker compose up -d livekit      # LiveKit SFU (localhost:7880)
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
- LiveKit secret'ı `docker-compose.yml` + `livekit/livekit.yaml` içinde eşleşmeli; prod'da değiştirin

## Durum

- [x] Faz 0 — iskelet
- [x] Faz 1 — auth + kimlik blob (kayıt/giriş, zero-knowledge)
- [x] Faz 2 — topluluk/kanal/üye + sarılı anahtar dağıtımı
- [x] Faz 3 — E2EE yazı sohbeti
- [x] Faz 4 — LiveKit sesli/görüntülü odalar (E2EE)
- [x] Faz 5 — cilalama (rekey, şifre değiştirme, ekran paylaşımı)
