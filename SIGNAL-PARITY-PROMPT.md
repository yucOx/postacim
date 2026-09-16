# postacim — Signal-parite güvenlik programı (master prompt)

> Bu dosya bir **prompt**tur: yeni Claude Code oturumlarında sırayla çalıştırılır.
> İlk kullanım: "Faz 0'ı uygula". Sonraki oturumlar: "Faz 1 ile devam" vb.
> Bağımlılıklar: 1→2 bağımsız paralel olabilir; 5, 6, 7 sıralı; 4 her zaman; 8 en son.

---

## Rol ve bağlam

Sen postacim'in geliştiricisin (Claude Code). postacim: gizlilik odaklı,
uçtan uca şifreli, self-hostable, Discord-benzeri web sohbet uygulaması
(React 19 + Fastify + better-sqlite3 + LiveKit SFU, AGPL-3.0, 173 test).
Sunucu yalnız opak blob taşır — bu **değişmez invariant**.

Hedef: kripto/gizlilik derinliğinde **Signal ile parite**. Mevcut dürüst
boşluklar (README "Bilinen sınırlar"): gönderen atfı kriptografik değil,
kısmi forward secrecy (DH ratchet/MLS yok), tek cihaz, JS trust, kaybolan
mesaj yok, key transparency gossip yok.

## Her fazda zorunlu akış

1. `session_recall("faz konusu")` ile önceki kararları çek; çelişki varsa
   önceki karara uy veya kullanıcıya açıkça danış.
2. Kısa tasarım: hangi dosya, hangi migration, hangi invariant korunuyor.
   Kripto tasarımı içeren fazlarda tasarımı KULLANICIYA ONAYLAT (satır
   bazlı değil — konsept bazlı).
3. Uygula: CLAUDE.md kuralları (minimum code, surgical, mevcut stile uyum).
4. **Yeni test zorunlu** — kripto değişikliğinde negatif senaryolar
   (yanlış anahtar/AAD/imza reddi) şart. `npm test` tamamen yeşil
   (173+ artan sayı) olmadan commit yok.
5. Yeni UI metni **5 dilde** (tr/en/de/es/fr) — `locale-parity` CI'yı kırar.
6. Dokümantasyon aynı PR'da: README (özellikler + kripto tablosu + bilinen
   sınırlar + roadmap), ARCHITECTURE.md (anahtar yaşam döngüsü + DB şeması +
   API/WS + modül haritası), gerekirse PRIVACY.md/PRIVACY.en.md.
7. `record_decision` (kritik kararlar) + `record_code_area` (yeni akış) +
   conventional commit + push.
8. README "Bilinen sınırlar" listesinden bu fazın kapattığı maddeyi
   kaldır/düzenle — her fazın sonunda bu liste Signal-pariteye yaklaşmayı
   göstermeli.

---

## Faz 0 — Plan commit'i

README "Durum → Sıradaki (kurul kurar)" bölümünü bu dosyanın faz listesiyle
değiştir (bağlantı ver). Amaç: roadmap'in repo'da yaşaması. + ARCHITECTURE
genel akış tablosuna "güvenlik yol haritası" satırı.

## Faz 1 — Ed25519 imzalı mesajlar (gönderen atfı kriptografik)

**Kapatır:** "Gönderen atfı kriptografik değil — sender_id sunucu kolonu."

- Kimliğe imza anahtarı: mevcut X25519 yanına **Ed25519** (libsodium
  `crypto_sign`) çifti. Migration v14: `users.sign_public_key TEXT`,
  `key_blob` payload'ına imza private key ekle (sarılmış blob sürümle —
  eski blob'lar hâlâ açılır, kayıt sonrası ilk açılışta imza anahtarı
  üretilip yeniden sarılır).
- key_log'a imza anahtarı: yeni kayıt hem X25519 hem Ed25519 taşır;
  safety number'a imza anahtarı hash'i katılır (damga formatı değişir —
  `fingerprint.test.ts` bilinen vektörü güncellenir).
- `web/src/crypto/message.ts`: AEAD çıktısı `ciphertext‖signature`
  (signature = Ed25519(ciphertext + AAD + key_version + client_id)).
  Doğrulama katmanı: mesaj açılmadan ÖNCE gönderen public key ile imza
  doğrulanır; imzasız mesajlar geçiş döneminde kabul (tarih bazlı:
  deployment tarihinden eski mesajlar), yenileri zorunlu.
- Server değişikliği YOK (opak blob) — `bootstrap`'ta sign_public_key
  dağıtımı (sunucu düz kolon okur, plaintext değil public key).
- Test: imza doğrulama, sahte gönderici reddi, ciphertext-modifiye reddi,
  eski-imzasız-mesaj geçiş davranışı, key_log iki anahtar.
- ARCHITECTURE: anahtar yaşam döngüsüne imza adımı; README kripto tablosu
  + bilinen sınırlar güncelle.

## Faz 2 — Kaybolan mesajlar (disappearing messages)

**Kapatır:** UX/gizlilik beklentisi (Signal'in en çok kullanılan özelliği).

- Migration v15: üç mesaj tablosuna da `expires_at INT` (null = kapalı).
- Client: composer'a TTL seçici (kapalı/1 sa/1 gün/1 hafta) — seçim
  kanal/DM başına hatırlanır (zustand + localStorage).
- TTL **AAD'ye girmez** (sunucu kolonundan okunur; imza kapsamı dışıdır —
  değişken metadata). Dürüst not README'ye: sunucu expires_at'ı görebilir;
  erişim + ömrü sınırı K İ L İ T client-side render + sunucu janitor
  (expires_at < now → tombstone) kombinasyonudur.
- WS frame'lerine expires_at alanı; chatStore/dmChatStore'da tıklayıcı
  (interval sweep + render sırasında süresi geçenler gizle).
- MsgDelete "benim için sil" ile etkileşim: TTL'li mesajda "benim için
  sil" yerine geri sayım gösterilebilir (basit tut).
- Test: janitor tombstone, WS süresi geçen frame reddi, TTL AAD dışı.
- PRIVACY.md: "TTL'li mesajların süresi sunucu için görünür metadata'dır"
  cümlesi eklenir.

## Faz 3 — Tor hidden service rehberi (IP metadata kapanışı)

**Kapatır:** "Onion/Tor rehberi" roadmap maddesi; istemci IP'si metadata.

- `deploy/tor-hidden-service.md` (deploy/vps-fresh-install.md stilinde):
  nginx'in onion service arkasında çalıştırılması, onion adresli
  LIVEKIT_URL, cookie Secure=false zorlaması (onion http) güvenlik
  kararı — https-onion (EV Onion/BTCPay modeli) önerisi ile.
- **Dürüst sınır** (README'ye): WebRTC medya (LiveKit) Tor'dan geçmez —
  UDP relay/iNAT; mesajlaşma Tor'da tam çalışır, arama direct kalır
  (veya kapalı mod: `SCREEN_SHARE/voice` kill switch Tor profili).
- Signal'in Tor desteği kıyaslaması ve limitler dokümante edilir.
- Test yok (doküman fazı) — ancak `.env.example`'a onion varyantı notu
  + README gizlilik bölümü güncellemesi şart.

## Faz 4 — Signed release / reproducible build (JS trust azaltma)

**Kapatır:** "Web JS trust — sunucu değişmiş JS anahtar çalabilir"
(sınır **azaltılır**, tam kapanmaz — dürüst ifade kalır).

- Mevcut `scripts/bundle-hashes.sh` + `npm run integrity` temel alınır:
  CI'da her tag için SRI hash manifest'i üret (GitHub Release asset).
- Sürüm süreci: `CHANGELOG.md` başlat; tag → release → checksums; README
  "doğrulama" bölümü (kullanıcı sunucudan yüklenen JS'in hash'ini
  release manifestiyle karşılaştırabilir).
- Opsiyonel artı (karar kullanıcıda): basit bir tarayıcı uzantısı
  (manifest v3, yalnız hash kontrolü) — yapmıyorsak README'de "roadmap"
  olarak bırak.
- ARCHITECTURE: "dağıtım bütünlüğü" bölümü.

## Faz 5 — DH ratchet / MLS araştırması ve uygulaması (tam FS + PCS)

**Kapatır:** "Forward secrecy kısmi — DH ratchet/MLS bekleyen kurul."

- **Önce araştırma sprinti** (kod YAZMA): (a) OpenMLS (Rust→WASM, ~1MB
  ek yük) vs (b) kendi X3DH benzeri init + Double Ratchet (libsodium
  var, ama doğruluk riski yüksek) vs (c) hafif çift-DH ratchet (Signal
  protokolünün alt kümesi). Karar kriterleri: bundle boyutu, WASM/JS
  entegrasyonu, test edilebilirlik, spec'e sadakat, bağımlılık riski.
  Kararı `record_decision` ile sabitle + kullanıcı onayı al.
- Uygulama: `web/src/crypto/` altında yeni modül; mevcut AEAD katmanı
  (message.ts) zaten soyut — ratchet state'i + epoch yönetimi değişir.
  Grup: MLS seçilirse grup state'i tam değişir; çift-DH seçilirse
  grup = DM'lerin geneline kalan mevcut epoch modeli + per-sender DH
  zinciri (daha düşük riskli geçiş).
- **Geçiş uyumluluğu**: v1 ratchet'li geçmiş mesajlar okunmaya devam
  eder (eski key_version okuma yolu korunur); yeni mesajlar yeni
  protokol. Geriye dönük şifre yeniden sarma YAPILMAZ (mümkün değil ve
  gereksiz).
- Bu faz büyük — alt fazlara böl (5a tasarım+test vektörleri, 5b DM,
  5c kanal/gdm, 5d ses anahtarı türetme entegrasyonu).
- Test: Signal spec'in test vektörleri + out-of-order + sahte state
  reddi + PCS simülasyonu (kompromize state'ten sonraki mesaj güvenliği).

## Faz 6 — Key transparency gossip

**Kapatır:** "Tam anti-forking istemciler arası gossip gerektirir."

- Otomatik head damgası paylaşımı: WS'e `keylog_head` frame'i — her
  istemci, üyesi olduğu topluluklarda periyodik kendi gördüğü head'i
  yayınlar; uyuşmazlıkta SecurityStore kırmızı bant (mevcut bant
  altyapısı var).
- Çatışma çözümü ve kanıt zinciri CONIKS/Keybase modeliyle; çok fazla
  sunucu mantığı GEREKMEZ (relay only) — invariant korunur.
- Test: fork tespiti senaryosu (iki farklı head iki istemcide → uyarı).

## Faz 7 — Çoklu cihaz

**Kapatır:** "Tek kimlik blob'u (cihaz iptali yok)." Faz 5 MLS ise
doğal yol: her cihaz bir MLS leaf; DH-ratchet seçildiyse: cihaz
linking (QR/onay) + primary cihaz key şerhi + per-cihaz ratchet state.

- Cihaz listesi UI, cihaz iptali (rekey zorunlu), güvenlik numarası
  per-cihaz.
- Bu faz Faz 5'in mimari kararına SIKI bağımlı — 5 bitmeden başlama.

## Faz 8 — Kapanış: threat model revizyonu + dış audit hazırlığı

- README tehdit modelini sıfırdan yaz (kapalı boşluklar listeden çıkar,
  kalan sınırlar dürüstçe kalır: metadata, sansür, web JS trust kalıntısı).
- `docs/SECURITY-REVIEW.md`: dış auditor için hazırlık paketi (mimari
  özet, kripto spesifikasyonu, test envanteri, kapsamı dışı listesi).
- FUNDING/audit kaynak notu: OTF Red Team Lab, Cure53 tarzı programlar.
- Son: CHANGELOG özeti + sürüm tag'i (v1.0.0) + release manifest.

---

## Değişmez kurallar (tüm fazlarda)

- **Sunucu plaintext görmez** — her özellikte bu invariant testle
  kanıtlanır (hardening.test.ts deseni).
- Mevcut DB'ler migration'la sorunsuz yükselir; veri kaybı yok.
- E2EE davranış değişikliği = yeni negatif test şart.
- `npm test` yeşil + typecheck yeşil olmadan push yok.
- "Signal ile parite" iddiası sadece README "Bilinen sınırlar" listesi
  gerçekten kısaldığında yapılır — pazarlama değil, diff kanıtı.
- Her faz kendi docs'unu getirir; "sonra yazarım" yok.
