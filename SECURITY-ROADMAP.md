# postacim — Güvenlik yol haritası (Signal paritesi)

> Her faz sırayla uygulanır: bir faz tamamlanıp push'landıktan sonra
> sıradaki başlar. Bağımlılıklar: 1→2 bağımsız paralel olabilir;
> 5, 6, 7 sıralı; 4 her zaman; 8 en son.

---

## Bağlam

postacim: gizlilik odaklı, uçtan uca şifreli, self-hostable,
Discord-benzeri web sohbet uygulaması (React 19 + Fastify +
better-sqlite3 + LiveKit SFU, AGPL-3.0). Sunucu yalnız opak blob taşır —
bu **değişmez invariant**.

Hedef: kripto/gizlilik derinliğinde **Signal ile parite**. **v1.0.0 itibarıyla
durum:** 7 faz tamamlandı (Faz 1 imza, Faz 2 TTL, Faz 3 Tor rehberi,
Faz 4 signed release, Faz 5 DH ratchet PCS-lite, Faz 6 key transparency
gossip gözlemsel, Faz 7 çoklu cihaz); Faz 8 audit hazırlık
(SECURITY-REVIEW.md + AUDIT-FUNDING.md) tamamlandı. Kapanan boşluklar
README §Tehdit modeli tablosunda **KAPATILDI/KISMEN** etiketiyle listeli.
Kalan sınırlar yapısal/kaynak kısıtı (AYNI/GELECEK).

## Her fazda zorunlu akış

1. Önceki faz kararlarıyla çelişki varsa önceki karara uy veya açıkça danış.
2. Kısa tasarım: hangi dosya, hangi migration, hangi invariant korunuyor.
   Kripto tasarımı içeren fazlarda tasarım konsept bazlı onaya tabidir.
3. Uygula: minimum code, surgical, mevcut stile uyum.
4. **Yeni test zorunlu** — kripto değişikliğinde negatif senaryolar
   (yanlış anahtar/AAD/imza reddi) şart. `npm test` tamamen yeşil
   olmadan commit yok.
5. Yeni UI metni **5 dilde** (tr/en/de/es/fr) — `locale-parity` CI'yı kırar.
6. Dokümantasyon aynı PR'da: README (özellikler + kripto tablosu + bilinen
   sınırlar + roadmap), ARCHITECTURE.md (anahtar yaşam döngüsü + DB şeması +
   API/WS + modül haritası), gerekirse PRIVACY.md/PRIVACY.en.md.
7. Kritik kararları kaydet + conventional commit + push.
8. README "Bilinen sınırlar" listesinden bu fazın kapattığı maddeyi
   kaldır/düzenle — her fazın sonunda bu liste Signal-pariteye yaklaşmayı
   göstermeli.

---

## Faz 0 — Plan commit'i (tamamlandı: 7df484d)

Yol haritası repo'da yaşıyor; README "Durum → Sıradaki" bölümü bu faz
listesiyle değiştirildi; ARCHITECTURE genel akış tablosuna "güvenlik yol
haritası" satırı eklendi.

## Program özeti (v1.0.0)

8 fazın tamamı tamamlandı. Detay: her faz başlığı + README §Tehdit
modeli (boşluk akıbet tablosu) + CHANGELOG v1.0.0. Dış audit paketi:
[docs/SECURITY-REVIEW.md](docs/SECURITY-REVIEW.md). Audit/fon kaynak
haritası: [docs/AUDIT-FUNDING.md](docs/AUDIT-FUNDING.md).

## Faz 1 — Ed25519 imzalı mesajlar (gönderen atfı kriptografik) — tamamlandı (9294cc3)

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

## Faz 2 — Kaybolan mesajlar (disappearing messages) — tamamlandı (3501b02)

**Kapatır:** UX/gizlilik beklentisi (Signal'in en çok kullanılan özelliği).

- Migration v16 (v15 imza fazına denk geldi): üç mesaj tablosuna da
  `expires_at INT` (null = kapalı).
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

## Faz 3 — Tor hidden service rehberi (IP metadata kapanışı) — tamamlandı (f0d8b43)

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

## Faz 4 — Signed release / reproducible build (JS trust azaltma) — tamamlandı (2d1f8c2)

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

## Faz 5 — DH ratchet / MLS araştırması ve uygulaması (tam FS + PCS) — tamamlandı (5a: de1cb48 · 5b: e37d0bf · 5c: c5aa7d9 · 5d: abdb5a2)

**KARAR (kullanıcı):** OpenMLS DEĞİL — (c+) güçlendirilmiş hafif çift-DH ratchet (kendi implementasyon,
libsodium primitifler). PCS-formel yerine PCS-lite (per-sender DH + epok rekey penceresi M=100/T=24h +
self-update). Araştırma brifi: `docs/faz5-ratchet-research.md`; spec: `docs/faz5-dh-ratchet-design.md`.
MLS yeniden değerlendirme tetikleyicisi: Faz 7 (çoklu cihaz) öncesi openmls-wasm stabil sürüm + storage dokümanı.

**Kapatır:** "Forward secrecy kısmi — DH ratchet/MLS bekleyen kurul."

**İlerleme:** 5a tamam (`de1cb48` — karar: (c+) güçlendirilmiş hafif çift-DH,
spec: `docs/faz5-ratchet-research.md`); **5b tamam** (`474a72f` — v4 format +
`crypto/dhratchet.ts` + DM yolu, spec: `docs/faz5-dh-ratchet-design.md`, M=100
/ T=24h pencere); **5c tamam** (`76839cd` — kanal/gdm v4: epok anahtarından
türetilen grup DH çapası `dhAnchor`, rekey broadcast mevcut rotate üzerinden,
self-update `dh_update` opak WS relay + istemci Ed25519 doğrulama/TOFU pin).
Kalan: 5d ses anahtarı türetimi.

- **Önce araştırma sprinti** (kod YAZMA): (a) OpenMLS (Rust→WASM, ~1MB
  ek yük) vs (b) kendi X3DH benzeri init + Double Ratchet (libsodium
  var, ama doğruluk riski yüksek) vs (c) hafif çift-DH ratchet (Signal
  protokolünün alt kümesi). Karar kriterleri: bundle boyutu, WASM/JS
  entegrasyonu, test edilebilirlik, spec'e sadakat, bağımlılık riski.
  Kararı sabitle + kullanıcı onayı al.
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

## Faz 6 — Key transparency gossip — tamamlandı

**Kapatır:** "Tam anti-forking istemciler arası gossip gerektirir."

- Otomatik head damgası paylaşımı: WS'e `keylog_head` frame'i — her
  istemci, üyesi olduğu topluluklarda periyodik (5dk) kendi gördüğü
  head'i yayınlar; uyuşmazlıkta SecurityStore kırmızı bant (mevcut bant
  altyapısı: `keylogForkWarning` — zincir bozulmasından ayrı alan,
  farklı eylem önerisi: bant dışı damga karşılaştırması).
- Çatışma çözümü gözlemsel (CONIKS/Keybase kanıt zinciri kapsam dışı —
  bu sınır README "Bilinen sınırlar"a yazıldı). Sunucu relay only —
  invariant korunur (id/hash zaten /keys/log'da public, saklama yok).
- Test: fork tespiti senaryosu + geride/ileri head + sessiz eşleşme +
  hardening (sığ sınır, üye olmayan reddi, plaintext invariant). Spec:
  `docs/faz6-keygossip-design.md`.

## Faz 7 — Çoklu cihaz — tamamlandı

**Kapatır:** "Tek kimlik blob'u (cihaz iptali yok)." Faz 5 (c+) kararına
sıkı bağlı: her cihaz X25519 + Ed25519 keypair (v3 blob: X25519 priv +
Ed25519 priv + 16B device_id), per-cihaz DH step namespace, WS tabanlı
linking flow, cihaz iptali = rekey zorunlu, per-cihaz fingerprint. Spec:
`docs/faz7-multidevice-design.md`. Testler: 4 v3 blob + 3 per-cihaz DH
step + 12 server (link/revoke flow, primary iptal reddi, token tek
kullanımlık, başka user cihazı 404) — 274 → 293.

## Faz 8 — Kapanış: threat model revizyonu + dış audit hazırlığı — tamamlandı (6 atomic commit)

- README tehdit modelini sıfırdan yaz (kapalı boşluklar listeden çıkar,
  kalan sınırlar dürüstçe kalır: metadata, sansür, web JS trust kalıntısı).
- `docs/SECURITY-REVIEW.md`: dış auditor için hazırlık paketi (mimari
  özet, kripto spesifikasyonu, test envanteri, kapsamı dışı listesi).
- FUNDING/audit kaynak notu: OTF Red Team Lab, Cure53 tarzı programlar.
- Son: CHANGELOG özeti + sürüm tag'i (v1.0.0) + release manifest.

**Tamamlandı:** `main` üzerinde 6 atomic commit ile uygulandı
(`742f833` → `6346893` → `b3a416c` Faz 8 commit'leri; `f4c345c` Faz 8
AUDIT-FUNDING.md; `80dec56` Faz 8 SECURITY-REVIEW.md). Kod değişikliği
yok — sadece dokümanlar + CHANGELOG/README stale check. **Sürüm tag'i
(v1.0.0) ve main'e merge kararı kullanıcıda**: kullanıcı
`git tag v1.0.0 && git push --tags` ile tag atınca CI
(`.github/workflows/release.yml`) web bundle SHA-256 + SRI manifest'i
GitHub Release asset'i olarak üretir.

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
