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
- **Faz 5b — DH ratchet (v4), DM yolu**: per-gönderici X25519 DH zinciri —
  ephemeral public mesaj başlığında açık taşınır, adım 100 mesajda / 24
  saatte bir yenilenir; gönderici state'i sızsa bile önceki adımlar ve
  bir sonraki adımdan itibaren gelecek korunur (DM'de forward secrecy tam,
  PCS yok — dürüst sınırlar README'de). Alıcı stateless: mesaj başlığından
  zincir yeniden türetilebilir; v1/v2/v3 geçmiş aynen okunur (resarmlama
  yok). KAT vektörleri + FS/PCS-lite sızıntı simülasyonu testleri
  (`f8e8989`, `474a72f`)
- **Faz 5c — kanal/gdm v4 + DH-rekey broadcast + self-update relay**:
  kanal ve grup DM gönderimi v4 DH ratchet'e taşındı — çoklu üye scope'ta
  DH karşıtı epok anahtarından deterministik türetilen grup DH çapası
  (alıcı stateless kalır, pencere M/T DM ile aynı); üye değişimi rekey'i
  artık zincir seed'i + çapayı birlikte çevirir: atılan üye broadcast'i
  yakalasa bile gelecekteki mesajları türetemez (PCS-lite). Self-update:
  ele geçirilen cihazın yerini alan kurban Ed25519 imzalı `dh_update`
  duyurusu yayınlar — sunucu yalnız opak relay (saklamaz/yorumlamaz),
  alıcı defter anahtarıyla doğrulayıp TOFU pin'ler (`76839cd`)
- **Faz 5d — ses anahtarı DH zincirinden + self-update UI**: LiveKit SFrame
  passphrase artık ham epok anahtarı değil — `H(step_root ‖ 'voice')` türetimi
  (kanal sesi epok DH çapasının kendi üstündeki X25519'üne, DM araması iki
  tarafın statik kimlik DH'ine bağlı; j=0 sabit — DH adımları göndericiye
  özgü olduğundan grupça ortak "güncel adım" yoktur, ses anahtarı epok
  başına sabittir ve rekey ile döner; eski v1/v2/v3 epoklar eski türetimde
  kalır). Self-update Ayarlar → Güvenlik'e taşındı: tek tıkla yeni DH
  kimliği tüm DM/gdm/kanal bağlamlarına imzalı duyuruyla yayınlanır;
  imza doğrulamasını geçemeyen `dh_update` duyurusu kırmızı güvenlik
  bandı tetikler (çöp frame sessiz reddeilir). KAT vektörleri: çapa/DM
  türetimi, iki tarafın aynı anahtarı, epok ayrımı, alan ayrımı;
  relay→ingest uçtan uca negatifleri
- **Faz 6 — key transparency gossip (anti-forking, gözlemsel)**: WS
  `keylog_head` frame'i — her istemci doğrulanmış anahtar defteri
  head'ini 5dk'da bir (JIT: `syncKeyLog` başarılı olunca anında) üyesi
  olduğu topluluklara yayınlar; sunucu opak relay (saklama/yorum yok,
  sığ sınır: id 32-bit pozitif, hash 64 hex, communities ≤64 string);
  alıcı 4 durum makinesi (eşleşme / ileri / aynı-id-farklı-hash /
  biz-önde-uyuşmazlık) → son ikisi `keylogForkWarning` kırmızı bant
  tetikler (zincir bozulmasından ayrı alan — farklı eylem önerisi:
  bant dışı damga karşılaştırması). **Dürüst sınır:** gözlemsel —
  tam CONIKS/Keybase MAP kanıt ağacı kapsam dışı; tek online istemci
  hiçbir çelişki yakalayamaz, çevrimdışı çatışma çözümü hâlâ bant
  dışı damga karşılaştırmasıdır. Spec: `docs/faz6-keygossip-design.md`.
  Testler: 12 birim (reducer + hardening) + 7 server (relay invariant
  + sığ sınır + plaintext invariant) — 255 → 274

### Önceki sprintler (özet)

- E2EE çekirdek: XChaCha20-Poly1305 mesajlar, sealed-box anahtar dağıtımı,
  per-gönderici ratchet, mesaj padding, epok/rotation + rekey kilidi
- Kimlik: Argon2id zero-knowledge kayıt, BIP-39 kurtarma ritüeli, passkey
  cihaz kilidi, güvenlik numarası + anahtar defteri (key transparency)
- Sertleştirme: TLS/HSTS + CSP + httpOnly çerez, rate limit + login kademeli
  blok, WS auth timeout, log hijyeni
- Ürün: topluluk/kanal, roller/ban, davet linkleri + katılım şifresi,
  arkadaş/DM/grup DM, 1:1 arama, okunmadı, LiveKit SFrame E2EE ses/görüntü
