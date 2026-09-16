# Katkı Rehberi

postacim'e ilginiz için teşekkürler! Bu rehber geliştirme kurulumunu, kod
standartlarını ve PR beklentilerini içerir.

## Geliştirme kurulumu

Gereksinimler: **Node 22+**, **Docker** (yalnız LiveKit için).

```bash
git clone https://github.com/yucOx/postacim.git
cd postacim
npm install
docker compose up -d livekit     # yalnız SFU (localhost:7880)
cp .env.example .env             # lokal geliştirme değerleriyle çalışır
npm run dev:server               # API  (localhost:4000)
npm run dev:web                  # Web  (localhost:5173)
```

Doğrulama: `curl localhost:4000/api/health` → `{"ok":true}`

VPS/production kurulumu için: [deploy/vps-fresh-install.md](deploy/vps-fresh-install.md).

## Testler

```bash
npm test                # tüm suite: kripto birim + kara kutu entegrasyon
npx vitest run server/test/auth.test.ts   # tek dosya
```

- Her test dosyası kendi process'inde koşar (geçici sunucu + geçici DB).
- **CI**: push/PR'da tip kontrolü (server + web) + tüm testler
  (`.github/workflows/ci.yml`).

**Kural: her PR test geçirir duruma gelmeli.** Kripto değişiklikleri
(`web/src/crypto/*`) mutlaka yeni test içermeli — AEAD/AAD bağlama ve
negatif senaryolar (yanlış anahtar/AAD/scope reddi) şart.

## i18n — dil parite kuralı

Arayüz 5 dilde (tr/en/de/es/fr): `web/src/i18n/locales/`.

**Yeni bir UI anahtarı eklediğinizde 5 locale dosyasına da eklemek
ZORUNLU** — eksik anahtar `locale-parity` testini kırar ve CI yeşile
çıkamaz. Çeviriniz mükemmel olmasa da olur; sonradan düzeltilebilir, ama
anahtar **her dilde var olmalı**.

## Kod standartları

- **TypeScript strict** — hem server hem web; `tsc --noEmit` CI'da.
- **Mevcut stili takip edin** — dosyanın kendi konvansiyonu precedanstır.
- **Gizlilik invariant'ları koruyun**: sunucu koduna hiçbir yerde plaintext
  mesaj/anahtar içeriği düşmez (bkz. `server/test/hardening.test.ts` log
  hijyeni). Yeni route eklerken: içerik görmeyen, sadece opak blob taşıyan
  tasarım varsayılandır.
- **Kripto kodu**: `web/src/crypto/` altına dokunan PR'larda tasarımı
  PR açıklamasında açıklayın (hangi invariant korunuyor, hangi saldırıya
  karşı ne değişti). Threat model: README "Tehdit modeli ve bilinen sınırlar".

## Commit ve PR akışı

1. Fork → feature branch (`feat/…`, `fix/…`, `docs/…`).
2. Commit mesajları conventional: `feat:`, `fix:`, `docs:`, `perf:`,
   `chore:` (git log'a bakın).
3. Küçük, odaklı PR'lar — tek PR'da birden çok konu karışmasın.
4. PR açıklaması: ne, neden, nasıl test edildi.

## Güvenlik konulu değişiklikler

Güvenlik açığı **keşfettiyseniz** PR açmayın —
[SECURITY.md](SECURITY.md)'deki özel kanalı kullanın.

Güvenlik **davranışını değiştiren** değişiklikler (rate limit, CSP, auth
akışı, kripto) için: PR'da değişikliğin hangi saldırı yüzeyini daralttığını
/genişlettiğini belirtin. Maintaincer ile threat model üzerinden konuşmadan
büyük kripto yeniden yazımlarına girmeyin — ısrarla düşünelim, erken değil
geç olmaktan iyidir.

## Lisans

Katkılarınız **AGPL-3.0-or-later** lisansıyla projeye dahil edilir
([LICENSE](LICENSE)). Gönderi göndererek bunu kabul etmiş olursunuz.
