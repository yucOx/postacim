# posta-guvercini 🕊️

Gizlilik odaklı, uçtan uca şifreli (E2EE) Discord-benzeri sohbet uygulaması.
Sunucu yalnızca şifreli veri taşır — mesajların, medyanın ve anahtarların düz
hâlini hiçbir zaman görmez.

## Mimari

- **server/** — Node 22 + Fastify + SQLite. Bearer token auth, WS (`/ws`)
  gerçek zamanlı yayın, LiveKit access token üretimi. Şifreli taşıyıcı.
- **web/** — React 19 + Vite + Tailwind v4. Tüm kripto tarayıcıda:
  Argon2id KDF, X25519 kimlik, sealed-box anahtar dağıtımı,
  XChaCha20-Poly1305 mesajlar, LiveKit SFrame (video E2EE).
- **livekit/** — self-host LiveKit SFU (Docker). Sesli/görüntülü odalar,
  onlarca katılımcı. SFU medyayı çözmez, yalnızca opak şifreli bayt aktarır.

## Geliştirme

Gereksinimler: Node 22+, Docker.

```bash
npm install
docker compose up -d livekit      # LiveKit SFU (localhost:7880)
npm -w server run dev             # API  (localhost:4000)
npm -w web run dev                # Web  (localhost:5173)
```

Doğrulama: `curl localhost:4000/api/health` → `{"ok":true}`

## Durum

- [x] Faz 0 — iskelet
- [x] Faz 1 — auth + kimlik blob (kayıt/giriş, zero-knowledge)
- [x] Faz 2 — topluluk/kanal/üye + sarılı anahtar dağıtımı
- [ ] Faz 3 — E2EE yazı sohbeti
- [ ] Faz 4 — LiveKit sesli/görüntülü odalar (E2EE)
- [ ] Faz 5 — cilalama (rekey, şifre değiştirme, ekran paylaşımı)
