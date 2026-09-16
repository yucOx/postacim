# Faz 5a — DH ratchet / MLS araştırma brifi (karar öncesi doküman)

> Bu doküman SECURITY-ROADMAP.md "Faz 5" araştırma sprintinin çıktısıdır —
> **uygulama kodu içermez**. Üç seçenek birincil kaynaklarla kıyaslanır,
> öneri + alt faz bölünmesi sunulur. Kararı vermeye yetkili olan
> kullanıcıdır; bu doküman kararın girdisi, kararı değil.
>
> Araştırma tarihi: 2026-09-16. Tüm sürüm/sayılar birincil kaynaktan
> (crate registry, npm registry, GitHub, RFC, Signal spec sayfaları)
> doğrulanmıştır; doğrulanamayan her sayı açıkça işaretlidir.

---

## 0. Özet

| Seçenek | Tek cümle |
|---|---|
| (a) OpenMLS (Rust→WASM) | Spec'e en sadık, FS+PCS tam — ama tarayıcı hikâyesi 2026 itibarıyla deneysel: wasm hedefi "desteklenmiyor, yalnız CI'da derleniyor", resmî JS binding yok (openmls-wasm 0.1.0, tek sürüm), grup state'i baştan yazılır. |
| (b) Kendi X3DH + Double Ratchet (libsodium) | En yüksek kripto kazanç teorisinde ama iki resmî spec'in de test vektörü YOK ve libsignal dış kullanımı Signal tarafından desteklenmiyor → doğrulanabilirlik üç seçenekten en zayıf. |
| (c) Hafif çift-DH ratchet (Signal alt kümesi) | Mevcut message.ts katmanına en az invaziv: DM'ye iki yönlü DH adımı, kanal/gdm'ye gönderici DH-rekey — FS tam, PCS sınırlı; RFC 9420'un kendi uyarısıyla bilinen bedeli dürüstçe taşınır. |

**Öneri: (c).** Gerekçesi ve alt faz bölünmesi §6'da. (a) 2026'da
tarayıcıyı production hedefi yapacak olgunlukta değil; (b)'nin DM çekirdeği
zaten (c)'nin bir üst kümesi olarak 5b'ye girer, X3DH'ın asenkron prekey
kısmı postacim'in mevcut epoch/wrapping modelinde ayrıca gerekmez.

> **Önceki plan kararıyla çelişki notu (roadmap akış kuralı 1):** Faz planı
> hazırlanırken "OpenMLS WASM, kendi Double Ratchet yerine" eğilimi
> kaydedilmişti. Bulgular bu eğilimi 2026 itibarıyla desteklemiyor
> (wasm tier'ının unsupported olması + binding olgunluğu) — karar
> aşamasında bu değişiklik açıkça değerlendirilmeli.

---

## 1. Mevcut mimarinin ratchet/MLS'e uzaklığı (faz 5'i ne kapatır)

Kaynak: `web/src/crypto/message.ts`, `ARCHITECTURE.md` "Anahtar yaşam döngüsü",
README "Tehdit modeli".

Mevcut model (v2/v3):

- Kanal/DM/gdm başına **epoch anahtarı** (`key_version`), üyelere
  `wrapped_channel_keys`/`dm_keys`/`gdm_keys` ile sealed-box sarma. Üye
  çıkarma → `needs_rekey` dondurma + staff rotasyonu.
- **Per-gönderici simetrik hash-ratchet**: `chain_seed = H(epoch_key ‖ 'ratchet' ‖ sender_id)`,
  `root_i = H(root_{i-1} ‖ 'step')`, `msg_key_i = H(root_i ‖ 'msg')`. DH adımı yok.
- **Stateless alıcı**: kalıcı ratchet state yok — epoch anahtarı + index taraması
  (0..`MAX_RATCHET_SCAN`=10k) yeterli. F5 sonrası kurtarma, pagination,
  çoklu sekme doğal çalışır. Bu özellik her seçenek için korunması gereken
  en değerli avantajdır (aşağıda seçenek başına etkisi yazılır).
- v3: AEAD çıktısına Ed25519 gönderen imzası (cutover `SIGN_CUTOVER_MS`).
- v1/v2 geçmiş mesajlar eski key_version okuma yoluyla açılmaya devam eder;
  Faz 5'te hangi seçenek seçilirse seçilsin geriye dönük yeniden sarma YOK
  (roadmap değişmezi).

Dürüst boşluk (README threat model maddesi): **"Forward secrecy kısmi"** —
zincir kökü/msg_key sızarsa geçmiş korunur (geri türetim yok); ama
(i) epoch anahtarı sızarsa zincir baştan türetilebilir ve
(ii) **gelecek korunmaz**: çalınan güncel zincir state'i, epoch rotasyonuna
kadar gelecekteki tüm mesaj anahtarlarını üretir. (ii) DH ratchet'in
kapatmaya geldığı boşluktur; PCS (tehdit sonrası otomatik iyileşme) ise
yalnız MLS'in Update/Commit modelinde tamdır.

Ölçek gerçekliği: kanallar 12–150 üye, GDM'ler küçük, DM 1:1. RFC 9420
MLS'i "iki ile binlerce" grup için tanımlar ve maliyeti **log(N)**
ölçekli kılar ([RFC 9420](https://www.rfc-editor.org/rfc/rfc9420.html)).
12–150'de TreeKEM'in asimptotik avantajı ölçekte zaten hissedilmez —
MLS'in bu ölçekteki değerli kısmı asimptotik verim değil, **PCS** ve
formel spec'tir; bedeli ise tam bir grup-state yeniden yazımıdır.

---

## 2. Seçenek (a): OpenMLS (Rust → WASM)

### 2.1 Olgunluk ve sürüm durumu (doğrulanmış)

- [crates.io `openmls`](https://crates.io/crates/openmls): güncel **0.9.0**
  (2026-08-25), lisans **MIT**, crate 2020-11'den beri yaşıyor, 2026 içinde
  10 sürüm (0.7.2→0.9.0) — bakım aktif. MSRV Rust 1.91; 0.9.0 breaking
  (self-describing olmayan storage formatları kaldırıldı).
- [GitHub openmls/openmls](https://github.com/openmls/openmls): 1.989 commit,
  fuzzing + compat testleri + interop client var; RFC 9420 hedefli.
  Desteklenen platform listesinde `wasm32-unknown-unknown`
  **"Unsupported, but built on CI"** — wasm derleniyor ama resmî destek
  platformu değil (GitHub README, 2026-09 itibarıyla).
- Bakım kuruluşu: [openmls.tech](https://openmls.tech/)
  "maintained and supported by **Phoenix R&D and Cryspen**" diyor;
  GitHub README "Phoenix R&D and CE Labs". **OpenSSF/Alpha-Omega/Wire izi
  iki sayfada da yok** (roadmap taslağındaki "OpenSSF/TUALO?" sorusunun
  cevabı: hayır, doğrulanamadı). Ticari destek modeli (Cryspen) var —
  yani proje ölü değil ama tek-volunteer da değil.
- Bağımlılık riski iki yönlü: aktif bakım iyi haber; ama [v0.8.0 release
  notu](https://github.com/openmls/openmls/releases) (2026-02-04)
  **kritik güvenlik yamaları** içeriyor ("recommend all users update
  immediately", GHSA-8x3w-qj7j-gqhf v0.7.2'de) — referans MLS kütüphaneleri
  de güvenlik açığı çıkarıyor; 3. taraf wasm binding'i bu risk yüzeyine
  eklenir.

### 2.2 Tarayıcı/npm gerçekliği (doğrulanmış — kararın en kritik bulgusu)

- **Resmî `@openmls` scoped npm paketi yok** ([npm registry arama](https://registry.npmjs.org/-/v1/search?text=openmls):
  12 sonuçta hiçbir `@openmls/*` paket geçmiyor).
- Resmî org'a bağlı tek npm paketi [`openmls-wasm`](https://www.npmjs.com/package/openmls-wasm):
  **0.1.0, tek sürüm, 2025-10-10**, MIT; kendi açıklaması
  "a step on the way to proper Wasm support", "minimal bindings",
  "test bed for measuring packed size" — yani deneysel başlangıç noktası,
  production binding'i değil. **Unpacked boyut 1.424.034 byte (1.42 MB,
  6 dosya)** ([npm registry](https://registry.npmjs.org/openmls-wasm)).
  Gzipped .wasm ölçümü **doğrulanamadı** — CI'da wasm boyut limiti
  1.7 MiB raw olarak yükseltilmiş (v0.7.0 release notu; v0.8.1 "Relax
  Wasm size limit"), yani raw wasm ~1.7 MiB mertebesinde; gzip sonrası
  sayı için elimde ölçüm yok, varsayım yapma.
- [OpenMLS book](https://book.openmls.tech/): wasm için tek bilgi `js`
  feature ("enable compilation to wasm"); tarayıcı örnek uygulaması,
  IndexedDB storage rehberi yok (yalnız `sqlite-provider` crate'i).
  Grup state'inin IndexedDB'de tutulması için hazır bir yol
  **doğrulanamadı** — kendi KeyStore trait implementasyonunu yazmak gerekir.

### 2.3 Grup ölçeği ve mimari sarsıntı

- MLS, "iki ile binler" grup hedefler; üye değişimi log(N) — [RFC 9420](https://www.rfc-editor.org/rfc/rfc9420.html).
  postacim ölçeğinde (12–150) teknik uyum sorunsuz; değer, yukarıda
  söylendiği gibi PCS + formal spec'tir.
- Ama entegrasyon bedeli: `key_version` epoch modeli, `wrapped_channel_keys`
  sarma tabloları ve `needs_rekey` dondurma akışı MLS'in
  KeyPackage dizini + Welcome + Commit/epoch akışıyla **tamamen değişir**.
  Sunucu yine yalnız opak blob taşır (MLS ciphertext ve Welcome de opaktır
  — invariant korunur; MLS ayrıca bir Authentication Service varsayar,
  postacim'in Faz 1 Ed25519 kimlik anahtarları bunun temeli olabilir), ama
  istemci tarafında MlsGroup state makinesi, fork resolution, out-of-order
  commit işleme mevcut kodun yerini alır. Roadmap'in "aylar işi" tahmini
  doğru; bunun üstüne OpenMLS'i tarayıcıya taşımak için binding katmanı da
  (openmls-wasm 0.1.0'dan yola çıkıp) kendimiz bakımına gireriz.
- Stratejik artı: roadmap Faz 7 (çoklu cihaz) MLS'te "her cihaz bir leaf"
  diyordu — MLS seçilirse Faz 7 doğal yolunu bulur. Bu artı, 2.2'deki
  browser olgunluğu sorununa karşı tartılmalıdır.

---

## 3. Seçenek (b): kendi X3DH init + Double Ratchet (libsodium-wrappers üzerinde)

### 3.1 Doğruluk riski — birincil kaynaklar ne diyor (doğrulanmış)

- **Resmî test vektörü YOK.** [Double Ratchet spec](https://signal.org/docs/specifications/doubleratchet/)
  ve [X3DH spec](https://signal.org/docs/specifications/x3dh/) sayfalarında
  test vektörü/conformance süiti yok — spec'ler algoritma pseudokodu + güvenlik
  tartışması veriyor, alttaki primitive'lerin vektörlerini RFC'lere (X25519 →
  RFC 7748, HKDF → RFC 5869) devrediyor. libsignal'ın kendi testleri repo-içi,
  dışa açılmış bir KAT seti yok.
- **libsignal üçüncü parti kullanımı için desteklenmiyor:**
  [libsignal README](https://github.com/signalapp/libsignal) açıkça
  "Use outside of Signal is unsupported" diyor; npm'deki
  `@signalapp/libsignal-client` "for its own use" — native Node binding,
  tarayıcı hedefi yok; AGPL-3.0 lisanslı (postacim ile uyumlu olsa da).
  Yani (b) seçeneği aslında "libsignal'ı al, libsodium'a oturt" DEĞİL —
  kendi implementasyon, resmî referansla differential test imkânsız.
- Spec'in kendisi bu sınıfın ne kadar tehlikeli olduğunu söylüyor:
  X3DH §4.3 — replay sonucu türetilen aynı anahtarın yeniden kullanımı
  önlenmezse "**catastrophic key reuse**" (spec'in ifadesi); DR spec §8.4 —
  skipped-key birikimi storage DoS + "kaybolmuş mesajları kaydedip sonra
  cihaz ele geçiren saldırgan" riski; MAX_SKIP sınırları zorunlu.
  Bunların hepsi postacim'in mevcut negatif test disipliniyle testlenebilir
  ama vektör olmadan "doğru uyguladım" kanıtı zayıf kalır.
- Moving target: Signal protokolü PQXDH ve SPQR varyantıyla değişiyor
  (DR spec §7 güncellemeleri) — "Signal ile parite" iddiasını sabit bir
  hedefe karşı değil, akan hedefe karşı savunmak zorunda kalırız.

### 3.2 Avantajlar (dürüst)

- libsodium-wrappers-sumo 0.8.4 zaten bundle'da (`web/package.json`) —
  marjinal bundle etkisi ~0 (a'daki ~1.4 MB'lık ek wasm'a karşı).
- X25519/HKDF/Ed25519/AEAD primitive'leri libsodium'da zaten mevcut ve
  testli; sıfırdan kriptografik primitive yazmak gerekmez — yazılacak şey
  protokol state makinesi (yine de zor kısım orası).
- Mevcut epoch/key_version + AAD (scope, kanal, version, index) modeline
  oturması doğal: DH adımı zincir türetimine girer, AAD şeması korunur.

### 3.3 Kapsam gerçekliği

Tam Double Ratchet + X3DH aslında iki ayrı inşa:
- **DM**: X3DH init (published X25519 + one-time prekey dizini + replay
  koruması — X3DH §4.2) → DR oturumu (MKSKIPPED, MAX_SKIP, header
  işleme, out-of-order). Bu Signal'in 2-kişi yolunun tamamı.
- **Kanal/gdm**: Signal'in kendisi bile büyük gruplarda Double Ratchet
  kullanmaz; sender-key tarzı grup anahtar + per-gönderici zincir kullanır.
  Yani (b)'nin grup tarafı yine (c)'ye döner — "kendi DR'mizi yazalım"
  kararı yalnız DM'i iyileştirir, kanalı iyileştirmez.

Geliştirme tahmini (roadmap 5a-5d, mühendislik tahmini — ölçüm değil):
5a tasarım+vektör üretimi (resmî vektör olmadığından kendi KAT setini
üretmek + tercihen bir bağımsız implementasyonla cross-check bulmak
sürecin kendisi bir alt proje), 5b DM (prekey dizini sunucu tarafı +
migration), 5c kanal, 5d ses — **birkaç ay**; ve audit edilebilirlik
en zayıf: dış auditor için "spec'e sadakat" iddiasını resmî vektörle
değil, kendi testlerimizle savunuruz.

---

## 4. Seçenek (c): Hafif çift-DH ratchet (Signal alt kümesi)

### 4.1 Konsept (5a'da tasarım onayına girecek — burada yer tespiti)

Mevcut katman zaten soyut: `message.ts` AAD şeması + v1/v2/v3 okuma yolları
+ epoch anahtar dağıtımı durur, yalnız **zincir türetimine DH girdisi eklenir**
ve alıcı tarama penceresi DH adımlarını bilir. İki alt yapı:

- **DM (5b): iki yönlü DH ratchet.** Her iki taraf da published X25519
  taşıyor; ratchet adımlarında gönderici taze ephemeral üretilir,
  ECDH çıktısı zincire karışır, ephemeral public header'da açık taşınır.
  Mevcut stateless-tarama modeliyle uyum için DH adımı seyrek
  (ör. K mesajda bir) tutulur — tarama penceresi ve cache davranışı
  korunur. Bu, header-encryption'sız Double Ratchet'in çekirdeğidir;
  X3DH'ın asenkron one-time prekey katmanı yoktur (postacim'de DM'ler
  zaten epoch anahtarıyla kurulur — o rolü görüyor).
- **Kanal/gdm (5c): gönderici DH-rekey broadcast.** Gönderici periyodik
  taze ephemeral üretir, üyelerin published X25519'larıyla ECDH edip yeni
  zincir tohumunu üye başına sarmalar (mevcut wrapping altyapısı!),
  alıcılar yeni zincire geçer. Çıkarılan üye → mevcut `needs_rekey`
  dondurma + zorunlu rekey zaten var; DH-rekey bu akışın içine oturur.

### 4.2 Ne kazandırır, neyi kapatır (dürüst)

- **FS tam olur**: çalınan güncel zincir state'i, bir sonraki DH adımından
  itibaren geleceği üretemez — DR spec'in tanımladığı birinci özellik:
  her mesaj için yeni anahtar türetilir ve DH public değerleri türetime
  karışır ([DR spec](https://signal.org/docs/specifications/doubleratchet/)
  §1). README "Forward secrecy
  kısmi" maddesi DM'de tam kapanır; kanal'da epoch + DH-rekey frekansıyla
  sınırlanmış olarak kapanır.
- **PCS YOK** — bilinen, dürüst bedel. RFC 9420'un giriş bölümü tam bunu
  anlatır: sender-key tarzı tasarımlarda FS vardır ama compromise'dan
  toparlanma **O(n²) update trafiği** gerektirir ve çalınan gönderici
  anahtarı dönene kadar pasif dinlemeye izin verir
  ([RFC 9420](https://www.rfc-editor.org/rfc/rfc9420.html) Introduction).
  (c) bunu MLS'in Update akışıyla değil, yalnız periyodik rekey + üye
  çıkışında zorunlu rekey ile sınırlar.
- Asenkron üye ekleme (MLS'in Add/Welcome akışı) burada gerekmez — mevcut
  epoch wrapping modeli kalır; karmaşıklık MLS'teki gibi artmaz.

### 4.3 Test edilebilirlik

Resmî Signal vektörü yok (bkz. §3.1) — ama (b)'den farklı olarak inşa
edilen yüzey küçük: KDF şeması libsodium primitive'leriyle deterministik,
her adım kendi KAT'ımızla sabitlenir (RFC 7748/5869 primitive vektörleri
zaten libsodium testlerinde), negatif senaryolar mevcut
`ratchet.test.ts`/`crypto.test.ts` disiplinine eklenir. Audit yüzeyi
bir modül; (b)'de tüm protokol, (a)'da Rust+wasm+binding üç katman.

---

## 5. Kıyas matrisi

| Kriter | (a) OpenMLS | (b) Kendi X3DH+DR | (c) Hafif çift-DH |
|---|---|---|---|
| Bundle boyutu | openmls-wasm 0.1.0 unpacked **1.42 MB** (gzipped: doğrulanamadı); libsodium zaten var | ~0 (libsodium bundle'da) | ~0 (libsodium bundle'da) |
| Entegrasyon çabası | En büyük: binding katmanı + grup state + key dağıtım yeniden yazımı; aylar | Büyük: X3DH prekey altyapısı + DR state makinesi; birkaç ay | En küçük: message.ts zincir türetimi + rekey akışı; haftalar |
| Test edilebilirlik (vektör erişimi) | İyi — OpenMLS interop/compat testleri (kendi içlerinde) | En zayıf — resmî vektör yok, libsignal dış kullanım unsupported | Orta — resmî vektör yok ama yüzey küçük, kendi KAT yeterli |
| Spec'e sadakat | Tam RFC 9420 (interop'lu) | Signal DR spec alt kümesi, "parite" iddiası en savunmasız | Bilinçli alt küme; iddia "Signal tarzı DH ratchet, MLS/PCS dışında" |
| Bağımlılık riski | Rust+wasm+binding kendi bakımımız; kütüphane aktif ama wasm tier unsupported; 2026'da kritik güvenlik yamaları geçmişi | Yalnız kendi kodumuz — ama o kodun doğruluğu kanıtsız | Yalnız kendi kodumuz + libsodium (zaten var) |
| FS / PCS kazancı | FS+PCS tam (TreeKEM Update) | DM: FS+PCS tam; kanal: (c) ile aynı | FS tam (DM) / epoch-frekanslı (kanal); PCS yok |
| postacim ölçeğine (12–150) uygunluk | Aşırı — log(N) kazancı ölçekte anlamsız, maliyet sabit | DM'de ölçekli; kanal tarafı yine sender-key kalır | Ölçekli — mevcut modelin üstüne biner |
| Faz 7 (çoklu cihaz) uyumu | Doğal (her cihaz leaf) | Per-cihaz ratchet state elle | Per-cihaz state elle (MLS'ten emekli yol) |

---

## 6. Öneri ve alt faz bölünmesi

**Öneri: (c) — hafif çift-DH ratchet.** Gerekçe:

1. Kapatmak istediği boşluk tam olarak README'deki madde:
   "gelecek korunmaz" → DH adımıyla FS tam. PCS dışında kalan hiçbir
   Signal özelliği 12–150 üyeli grup ölçeğinde kayba dönüşmüyor.
2. 2026 itibarıyla OpenMLS'in tarayıcı yolu production'da yok:
   wasm tier resmî destekli değil, resmî npm paketi yok, tek deneysel
   binding (0.1.0, tek sürüm, 2025-10) mevcut; IndexedDB storage yolu
   belgelenmemiş. MLS'i seçmek = binding katmanını da sahiplenmek.
   Yeniden değerlendirme tetikleyicisi: openmls-wasm'in 1.0/stabil
   sürümü + tarayıcı storage dokümantasyonu — o noktada Faz 7 öncesi
   tekrar bakılır.
3. (b)'nin en değerli parçası (iki yönlü DH ratchet çekirdeği) zaten
   (c)'nin 5b'sidir; (b)'nin asıl ek yükü X3DH/one-time-prekey katmanıdır
   ve postacim'de onun çözücü olduğu problem (asenkron çevrimdışı ilk
   temas + replay) mevcut epoch anahtarı dağıtım modelinde büyük ölçüde
   zaten çözümlü. Test vektörü olmadan 3 katmanlı kripto yazmak yerine
   1 katman yazıp kütüphaneye dayanmak doğrulanabilirlik sıralamasında
   (c) > (b) verir.

Alt fazlar (roadmap 5a-5d):

- **5a — tasarım + vektörler (doküman + test iskeleti, kod yok):**
  DH adımının KDF şeması (zincir türetimine DH çıktısının girişi), v4 AAD
  formatı, ephemeral header alanı, K mesajda bir DH rekey periyodu,
  DM iki yönlü adım kuralları, MAX_SKIP karşılığı pencere; kendi KAT
  vektörlerinin üretimi; README/ARCHITECTURE taslak değişiklikleri.
  Konsept onayı kullanıcıya.
- **5b — DM:** iki yönlü DH ratchet, out-of-order pencere, eski key_version
  okuma yolu korunur (değişmez). Negatif testler: yanlış ephemeral/AAD reddi,
  replay, pencere aşımı.
- **5c — kanal/gdm:** gönderici DH-rekey broadcast, `needs_rekey` dondurma
  ile birleşim, rekey frame'i WS üzerinden opak blob.
- **5d — ses:** LiveKit E2EE anahtarının ratchet zincirinden türetilmesi
  (mevcut ses anahtarı türetme entegrasyonu).

### README "Bilinen sınırlar" — hangi seçenekte ne olur

Seçenek ne olursa olsun değişen madde: *"MLS yok (simetrik ratchet var,
DH ratchet yok — çıkarılan üye öncesi mesajları zaten görmüşse okur)"* ve
threat model *"Forward secrecy kısmi"* maddesi.

- **(c) seçilirse:** madde şuna iner — *"PCS yok: MLS değil, DH ratchet'li
  sender-key tasarım; compromised state'ten toparlanma periyodik rekey
  sınırlarıyla"* + *"çıkarılan üye öncesi mesajları görmüşse okur"*
  kalır (sender-key yapısının doğası). Threat model FS maddesi
  "kısmi"→"tam (DM) / epoch+rekey sınırlı (kanal)" yazar, PCS yeni
  dürüst madde olur.
- **(a) seçilirse:** MLS maddesi kalkar, yerine *"tarayıcı wasm bindings
  deneysel (openmls-wasm 0.1.0), wasm tier resmî destekli değil"* dürüst
  maddesi eklenir; FS+PCS tam.
- **(b) seçilirse:** FS/PCS DM'de tam; kanal sender-key kalır; yeni madde:
  *"kendi kripto protokol implementasyonu — resmî test vektörü yok,
  dış audit şart"*. En uzun dürüst sınır listesi bu seçenekte olur.

### Karar tablosu (kullanıcıya)

| Soru | Cevap |
|---|---|
| Şimdi hangisi? | (c) — 5a tasarım onayı ile başla |
| (a) ne zaman? | openmls-wasm stabil sürüm + storage dokümantasyonu çıkarsa Faz 7 öncesi yeniden değerlendir |
| (b) neden değil? | Resmî test vektörü yok + libsignal dış kullanım desteklemiyor + DM dışı kazanımı (c) ile aynı |
| Bu fazın README kazancı | "Forward secrecy kısmi" → "forward secrecy tam (DM), kanal epoch+rekey; PCS yok (dürüst)" |

---

## 7. Kaynaklar (birincil, 2026-09-16 erişimi)

- OpenMLS crate: <https://crates.io/crates/openmls> (0.9.0, 2026-08-25, MIT)
- OpenMLS GitHub: <https://github.com/openmls/openmls>
  (wasm32 "Unsupported, but built on CI"; Phoenix R&D + CE Labs; MIT)
- OpenMLS proje sayfası: <https://openmls.tech/> (Phoenix R&D + Cryspen)
- OpenMLS releases: <https://github.com/openmls/openmls/releases>
  (v0.8.0 kritik güvenlik yamaları 2026-02; v0.7.0 wasm size limit 1.7 MiB)
- openmls-wasm npm: <https://www.npmjs.com/package/openmls-wasm>
  (0.1.0, 2025-10-10, unpacked 1.42 MB, tek sürüm)
- npm registry arama (resmî @openmls yokluğu):
  <https://registry.npmjs.org/-/v1/search?text=openmls>
- OpenMLS book: <https://book.openmls.tech/> (js feature; storage: sqlite-provider)
- libsignal: <https://github.com/signalapp/libsignal>
  ("Use outside of Signal is unsupported"; AGPL-3.0; Node binding "for its own use")
- Double Ratchet spec: <https://signal.org/docs/specifications/doubleratchet/>
  (test vektörü yok; MKSKIPPED/MAX_SKIP; §8.4 skipped-key riskleri)
- X3DH spec: <https://signal.org/docs/specifications/x3dh/>
  (test vektörü yok; §4.3 catastrophic key reuse; §4.6 KCI)
- RFC 9420 (MLS): <https://www.rfc-editor.org/rfc/rfc9420.html>
  ("two to thousands"; log(N); sender-key tasarımın PCS bedeli O(n²))
- postacim iç kaynaklar: `web/src/crypto/message.ts`,
  `web/src/crypto/ratchet.test.ts`, `ARCHITECTURE.md` (anahtar yaşam döngüsü),
  `README.md` (Tehdit modeli ve bilinen sınırlar), `web/package.json`
  (libsodium-wrappers-sumo ^0.8.4)