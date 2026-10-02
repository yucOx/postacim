# Sürüm notları

Biçim: [Keep a Changelog](https://keepachangelog.com/tr/1.1.0/) — kategoriler
Eklenen / Değişen / Düzeltilen / Güvenlik. Her `v*` tag'i CI'da web bundle SHA
manifest'i üretilir (bkz. README "Doğrulama"); sürüm kesme kararı sahipte.

## [Unreleased]

### Eklenen

- **README "Nasıl çalışır?" bölümü**: mesajın yazıldığı andan okunduğu ana
  mermaid sequence diyagramı, anahtar dağıtımı ve SFrame ses akışı flowchart'ları,
  "kim ne görüyor" matrisi + sunucu DB'sindeki opak satır örneği (tr+en;
  diyagramlar mmdc ile render doğrulandı)

### Düzeltilen

- **Yayın sesi kökeni çözüldü + sessiz yayın görünürlüğü**: iki taraflı canlı
  repro ile kanıtlandı — transport/E2EE (SFrame)/abone zinciri ScreenShareAudio
  için tamamen çalışıyor (uygulamanın birebir Room + publish seçenekleriyle
  ölçülen ses genliği duyulur seviyede); sesin gitmemesi tarayıcı capture
  katmanından: pencere paylaşımı hiçbir platformda ses vermez, Linux'ta ekran
  da vermez (yalnız sekme + "sekme sesini de paylaş" kutusu). İzleyici tarafı
  artık sessiz yayını görür: yayın plakasında ve canlı-yayın rozetinde
  "sessiz yayın" göstergesi (yayıncıya zaten toast gidiyordu); Go Live
  diyaloğu Linux'ta ekran seçili + ses açıkken önceden uyarır (5 dil)

## [v1.1.0] — 2026-10-02

### Eklenen

- **Olay bazlı bildirim sesleri (Discord paritesi)**: 15 olayın her birinin
  kendi sesi ve ayrı kapatma anahtarı (Ayarlar → Bildirimler → Sesler, Dinle
  düğmesiyle önizlemeli) — mesaj, mention, gelen arama zili, davet, arkadaşlık
  isteği, oda giriş/çıkış, mikrofon aç/kapa, yayın başlat/durdur, kamera
  aç/kapa, tüm sesi kıs/aç. Melik bildirimler MP3 (kırpılıp -18 LUFS
  normalize), kısa tık/tekrarlı desenler WebAudio sentezi — zil de WebAudio:
  klasik iki-vuruş deseni 1.6 sn'de bir (`645431d`, `b6e89cb`, `9e26644`,
  `5d0d61d`)
- **Cihaz seçimi**: mikrofon/kamera/hoparlör — arama kontrol çubuğundaki menü
  + Ayarlar → Ses ve Video; seçim kalıcı (localStorage), arama sırasında
  değişince anında uygulanır (`2f8fdf9`)
- **Arama düzeni (Discord)**: videolar tüm alanı kaplar, kontrol paneli altta
  dock; her kişi sayısında çalışan odak modu (tek tıkla tam çıkış), plakalar
  video üstünde, sohbet kalıcı yan panel, arama sabit oranlı kutuda
  (`de3119d` ve ardılları)
- **Topluluk profili**: ad değiştirme + profil fotoğrafı (PATCH
  /communities/:id, avatar yalnız üyelere) — düz metadata, E2EE dokunmaz;
  üye listesinden sağ tıkla arkadaş isteği (`0bb48c4`)
- **Onaylı üye ekleme**: "üye ekle" hedefe WS davet penceresi açar — üyelik
  yalnız hedefin kabulüyle basılır (`803b367`)

### Düzeltilen

- Arama ortasında ayrılınca karşı taraf habersiz kalıyordu — her fazda
  `call:cancel` bildirimi (`198cf8e`)
- Odak kameradayken yayın sesi hiç bağlanmıyordu (`0e643df`)
- Zil MP3'si çalışmıyordu — WebAudio sentezine taşındı (`b6e89cb`)
- Odak döşemesi tıklanamaz hâl almıştı: letterbox boş bantlar tıklamayı
  yutuyordu — odak yalnız görüntüden değişir (`81ebbd1`)
- Kapalı-kamera kutusu 4:3'tü, açık kamera tile'ından farklı boyutta
  görünüyordu — 16:9'a hizalandı (`f22a71e`)
- Konuşma/odak ring'i tile çerçevesi yerine tam video görüntüsüne oturdu;
  çift susturuldu ikonu kaldırıldı (`353602e`, `8473a80`)

## [v1.0.0] — 2026-09-18

> İlk stabil sürüm. 8 fazlık güvenlik yol haritası (SECURITY-ROADMAP.md)
> tamamlandı: Ed25519 imzalı mesajlar → kaybolan mesajlar → Tor rehberi →
> signed release → DH ratchet (PCS-lite) → key transparency gossip →
> çoklu cihaz → audit hazırlığı. **Sürüm tag'i sahip kararı** — kullanıcı
> tag atınca tarih doldurulur.

### Eklenen

#### Yol haritası: 7 faz + 4 sprint + paketler (tamamlandı)

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
- **Faz 7 — çoklu cihaz (per-cihaz X25519 + Ed25519)**: her cihaz
  bağımsız keypair (kimlik blob'u v3 = X25519 priv + Ed25519 priv + 16B
  device_id); kullanıcı kimliği = `users` + `users_devices` (v17) — primary
  kayıt anında, linked cihazlar primary tarafından onaylanır. Sunucu
  private key/identity blob saklamaz; yalnız public key + cihaz adı + linking
  durumu. Cihaz iptali = rekey zorunlu: iptal edilen cihaz yeni mesajları
  açamaz (eski private yeni DH çıktısını üretemez), eski mesajlar eski
  anahtarla okunur. Per-cihaz DH step namespace: aynı kullanıcının farklı
  cihazları farklı adım sayacı tutar, farklı ephemeral, farklı DH pub
  başlığı (alıcı için ayrı gönderici sayılır — F5 per-sender modelinin
  doğal uzantısı). Per-cihaz fingerprint: `fingerprintPair` aynı mantık;
  primary ve linked cihazlar farklı sayılar üretir. Linking akışı WS
  tabanlı (MVP): joinee `/devices/link/start` (ephemeral pub) → server
  link_token + primary'a `device:link_request` WS push → primary onay
  (`/devices/link/approve` + Ed25519 imzalı approval) → joinee
  `device:link_approved` event'i alır → `/devices/link/finish` ile kimlik
  yazımı. **Dürüst sınırlar:** linking sırasında iki cihaz online olmalı
  (async QR/off-band linking roadmap'te); primary cihazın tam kaybı
  hesap erişimini kilitler (kurtarma ifadesi tek çıkış); MLS değil
  (Faz 5 + 6 kararı korundu). v1/v2 blob'lu eski hesaplar `deviceId = null`
  → primary alias (geriye uyumluluk). Testler: 4 v3 blob + 3 per-cihaz DH
  step + 12 server (link/revoke flow, primary iptal reddi, token tek
  kullanımlık, başka user cihazı 404) — 274 → 293. Spec:
  `docs/faz7-multidevice-design.md`.

#### Faz 8 — Audit hazırlığı (bu sürüm)

- **README tehdit modeli sıfırdan**: 6 roadmap boşluğu (Faz 1–7)
  KAPATILDI/KISMEN/AYNI/GELECEK etiketiyle yeniden sınıflandı;
  kalan sınırlar (metadata, sansür/sıralama, rate-limit anonimleştirme,
  ses atfı, WebRTC Tor, MLS-formel yok, key transparency gözlemsel,
  SQLCipher at-rest) dürüstçe listelendi.
- **docs/SECURITY-REVIEW.md**: dış auditör için tek-giriş paketi —
  kapsam + tehdit modeli + mimari + kripto spesifikasyonu + test
  envanteri (293 test, 31 dosya) + bilinen sınırlar + P0/P1/P2 audit
  tavsiyeleri + iletişim (GitHub private advisory).
- **docs/AUDIT-FUNDING.md**: dış audit/fon kaynak haritası — OTF Red
  Team Lab (tercih, FOSS kapsamı), Cure53, NCC Group, Trail of Bits,
  Radically Open Security + Open Collective / GitHub Sponsors / NLnet /
  EU NGI Zero + Signal/Matrix/MLS RFC 9420/CONIKS referansları + v1.0.0
  sonrası 5 adımlı süreç önerisi.

#### Kullanıcı Arayüzü & Arama Deneyimi (Discord paritesi)

- **Aktif konuşmacı parlaması**: konuşan katılımcının video veya avatar kutusu çevresinde yeşil parlama (`border-emerald-500 ring-2`)
- **Arama kontrolleri ve ses yönetimi**: arama başlığı ve kontrollerine tam ekran desteği; gelen ses için %0-100 seviye kaydırıcısı ve tek tıkla sağırlaştırma (`toggleDeafen`)
- **Arama içi yan sohbet (Split-view)**: arama açıkken sağ panelde `DmChat` açılabilir, görüşmeden ayrılmadan yazışma imkânı
- **Odak / Izgara sahne geçişi**: herhangi bir katılımcıya tıklayarak anında odaklama, alt şeritten kesintisiz geçiş ve `LayoutGrid` butonuyla ızgaraya dönüş
- **Sol rayda mesajlaşılan DM'ler (ServerRail)**: önceden konuşulmuş kişiler en soldaki rayda avatarları, aktif çentikleri ve okunmamış rozetleriyle gösterilir; arama sırasında sayfa geçişinde arama otomatik PiP'e alınarak hayalet arama engellenir
- **Mute rozeti & mikrofon başlangıcı**: mikrofon kapalıyken tile sağ altında kırmızı `MicOff` rozeti; arama başlatıldığında mikrofon varsayılan açık gelir
- **Sunucu ses odalarında küçük ekran (PiP)**: ses odası görünümü köşeye küçültülerek sohbet gezintisi sürdürülür; Discord tarzı kenardan boyutlandırma (`069720b`)
- **Arama ping göstergesi**: kontrol çubuğunda LiveKit signal RTT — <80 ms yeşil, <200 ms sarı, üzeri kırmızı (Discord benzeri)
- **Gelen arama zili**: çağrı gelince çalar; kabul/red/iptal döngüyü keser (Ayarlar → bildirim sesi kapalıysa çalmaz)
- **Onaylı üye ekleme**: "üye ekle" artık hedefe WS daveti yollar — üyelik yalnız hedefin kabulüyle basılır (eskiden onaysız ekleniyordu)

### Düzeltilen (canlıdan gelen hotfixler)

- **Faz 1 sync race** (`a9f95aa`): `getSignKeys` haritası keytransparency sync'i bitmeden boştu — gönderen kendi imza public key'ini sync beklemeksizin RAM'den çözüyor (`resolveSignKeys` self kısayolu); "bu zarf açılamadı" kendi mesajlarında
- **Faz 5b DM çapası** (`534837c`): DM v4'ünde gönderen/alıcı farklı DH türetimi yapıyordu (gönderen peer kimliğine, alıcı kendi kimliğine) — sıralı çiftten deterministik çapa her iki tarafı eşitledi. Çapa düzeltmesinden önceki v4 DM'leri okunamaz (bilinçli kesme, README'de)
- **5b hotfix v2** (`26716f0`): okuma yolu çifti `[ben, sender]` hesaplıyordu — kendi mesajda `[ben, ben]` çıkıp gönderim çapasından ayrışıyordu; `dmAnchorIds` tek kaynağı okuma/gönderimi bağlıyor (sender_id yerine DM üyeliği)
- **decryptText perf** (`d109168`): her v4 mesajı açılmadan önce legacy openAll taraması (v1 + 10k v2, v3'te ikinci kez ≈ 20k gereksiz op) koşuyordu; v4 yolu en öne alındı — sohbet ilk açılışındaki saniyelerce süren UI donması giderildi
- **dhAnchor önbelleği + lazy public key** (`ab293b2`): her mesaj açılışında tekrarlanan DH çapa türetimi ve peer public key çözümü önbelleğe alındı — uzun geçmiş açılış donması giderildi
- **Geçmiş çözümleme perf** (`691b735`): çözümleme-failure kalıcı önbellek + partili çözümleme — uzun sohbet geçmişinde UI donması giderildi
- **useSafeIsSpeaking** (`cbadc38`): katılımcısız bağlamda konuşmacı tespiti hook'unun runtime hatası vermesi giderildi
- **Ses odası bağlantı kavgası** (`25e1343`, `2d64edf`, `d284baf`): sesli odaya girince aramanın 3 kez düşüp toparlanması — sidebar'ın explicit join'i ile VoiceRoom auto-join effect'i paralel koşuyor, iki bağlantı aynı LiveKit identity'si için kavga ediyor, sunucu kaybedene `DUPLICATE_IDENTITY` leave'i yolluyor; kaybeden room ping-timeout'a düşüp auto-reconnect ile geri geliyordu. Join'ler serialize edildi (`inflightJoin` kilidi) + `joinSeq` nesil sayacıyla son tık kazanır; disconnect handler'ının connect sırasında TDZ'den patlaması (`Cannot access 'o' before initialization` — state temizliğini öldürüyordu) düzeltildi; `peerConnectionTimeout` 15s→25s (yavaş ICE yollarında pc connection hatası). Teşhis altyapısı: LiveKit Reconnecting/Disconnected(reason) konsol telemetrisi + WS kopma close kodu rozeti (`7718f22`, `ba32c6a`)
- **Paylaşımı durdur butonu çift/yanlış yerde** : kendi yayını auto-odaklıyken şerit yayını tekrar edip iki "paylaşımı durdur" basıyordu; kendi kamerası odaklıyken de aynı buton görünüyordu — odak tespiti spotlight yerine gerçek odak anahtarından yapıldı

### Önceki sprintler (özet)

- E2EE çekirdek: XChaCha20-Poly1305 mesajlar, sealed-box anahtar dağıtımı,
  per-gönderici ratchet, mesaj padding, epok/rotation + rekey kilidi
- Kimlik: Argon2id zero-knowledge kayıt, BIP-39 kurtarma ritüeli, passkey
  cihaz kilidi, güvenlik numarası + anahtar defteri (key transparency)
- Sertleştirme: TLS/HSTS + CSP + httpOnly çerez, rate limit + login kademeli
  blok, WS auth timeout, log hijyeni
- Ürün: topluluk/kanal, roller/ban, davet linkleri + katılım şifresi,
  arkadaş/DM/grup DM, 1:1 arama, okunmadı, LiveKit SFrame E2EE ses/görüntü
- Paketler: A–D (roller/ban, davet, başvuru, katılım şifresi), E–G
  (arkadaş, DM, grup DM + 1:1 arama + okunmadı)
- Sprint 1–4: per-user limitler, TLS/HSTS/CSP, BIP-39 ritüeli, sertleştirme
  (padding + Trusted Types + log hijyeni + WS timeout + login kademeli + passkey
  + per-gönderici ratchet + anahtar defteri)
