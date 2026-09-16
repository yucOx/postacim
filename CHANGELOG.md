# Sürüm notları

Biçim: [Keep a Changelog](https://keepachangelog.com/tr/1.1.0/) — kategoriler
Eklenen / Değişen / Düzeltilen / Güvenlik. Her `v*` tag'i CI'da web bundle SHA
manifest'i üretilir (bkz. README "Doğrulama"); sürüm kesme kararı sahipte.

## [Unreleased]

### Eklenen

- **Faz 1 — Ed25519 imzalı mesajlar**: gönderen atfı kriptografik — her mesaj
  göndericinin imza anahtarıyla imzalı, alıcı anahtar defterinden doğrular;
  imzasız mesajlara cutover sonrası red (`9294cc3`)
- **Faz 2 — kaybolan mesajlar**: composer'dan mesaj başına TTL (1 sa / 1 gün /
  1 hafta), kanal/DM başına hatırlanır; sunucu janitor tombstone + istemci
  render süresi (`3501b02`)
- **Faz 3 — Tor hidden service rehberi**: v3 onion kurulumu, https-onion
  önerisi, WebRTC medya sınırının dürüst belgelenmesi (`f0d8b43`)
- **Faz 4 — dağıtım bütünlüğü**: `v*` tag'inde web bundle SHA-256 + SRI
  manifest'i GitHub Release asset'i olarak yayınlanır; README "Doğrulama"
  bölümü ile self-host kullanıcısı sunucudan inen JS'i manifestle
  karşılaştırabilir (`2d1f8c2`)

### Önceki sprintler (özet)

- E2EE çekirdek: XChaCha20-Poly1305 mesajlar, sealed-box anahtar dağıtımı,
  per-gönderici ratchet, mesaj padding, epok/rotation + rekey kilidi
- Kimlik: Argon2id zero-knowledge kayıt, BIP-39 kurtarma ritüeli, passkey
  cihaz kilidi, güvenlik numarası + anahtar defteri (key transparency)
- Sertleştirme: TLS/HSTS + CSP + httpOnly çerez, rate limit + login kademeli
  blok, WS auth timeout, log hijyeni
- Ürün: topluluk/kanal, roller/ban, davet linkleri + katılım şifresi,
  arkadaş/DM/grup DM, 1:1 arama, okunmadı, LiveKit SFrame E2EE ses/görüntü
