# Faz 5b — Güçlendirilmiş hafif çift-DH ratchet: tasarım spec'i (v4 mesaj formatı)

> SECURITY-ROADMAP.md Faz 5'in (c+) kararının ilk uygulama etabı. Karar:
> kendi implementasyon, libsodium primitifler; PCS-formel DEĞİL — per-sender
> DH zinciri (tam FS) + periyodik DH rekey (PCS-lite penceresi) + self-update
> (yalnız tasarım, 5c). Bu doküman byte-seviyesi spec'tir; implementasyon
> bundan önce commit edilir (yol haritası akış kuralı 2).
>
> Kapsam: **DM (1:1) yolu canlı olur** (5b). Kanal/gdm (5c) ve ses anahtarı
> (5d) kalan alt fazlardır. Geriye dönük resarmlama YOKTUR — v1/v2/v3
> geçmiş aynen okunmaya devam eder (değişmez).

---

## 1. KDF ve zincir tanımları

Tüm hash'ler `crypto_generichash` (BLAKE2b-256), tüm etiketler utf8 — mevcut
v2 modeliyle aynı. X25519 `crypto_scalarmult`; libsodium tüm-sıfır paylaşılan
sırda reddeder (küçük-alt-grup/identity koruması).

```
chain_seed  = H(epoch_key ‖ 'ratchet' ‖ sender_user_id)          // v2'den DEĞİŞMEDİ
dh_out_j    = X25519(eph_priv_j, peer_static_pub)                 // gönderen tarafı
            = X25519(my_static_priv, dh_pub_j)                    // alıcı tarafı — aynı 32B
step_root_j = H(chain_seed ‖ 'dh' ‖ u32LE(j) ‖ dh_out_j)
root_{j,0}  = step_root_j
root_{j,l}  = H(root_{j,l-1} ‖ 'step')                            // v2 'step' adımıyla aynı
msg_key_{j,l} = H(root_{j,l} ‖ 'msg')                             // v2 'msg' adımıyla aynı
```

- `j` = gönderici başına DH adım sayacı (0'dan başlar; u32).
- `l` = adım içi yerel mesaj index'i (0..M-1). Global index `i = step_base + l`
  (v2'deki zincir index'iyle aynı sayaç, aynı localStorage anahtarı).
- `peer_static_pub` = karşı tarafın **kimlik X25519 anahtarı** (bootstrap
  `public_keys` / arkadaş kaydı). Yeni bir published anahtar kolonu GEREKMEZ —
  sunucu değişikliği yok. Kimlik anahtarının sealed-box'ta da kullanılması
  çapraz-protokol riski doğurmaz: DH çıktısı `chain_seed` + `'dh'` etiketiyle
  etki alanı ayrımıyla karıştırılır; tek başına hiçbir yerde anahtar olarak
  kullanılmaz.

### Neden bu şekil

- **Stateless alıcı korunur** (mevcut mimarinin en değerli özelliği): alıcı
  `dh_out_j`'yi her mesajın başlığındaki `dh_pub_j` + kendi kalıcı static
  private'ından O(1) hesaplar. Kalıcı ratchet state yok — F5, pagination,
  çoklu sekme, localStorage kaybı doğal çalışır. IndexedDB/LocalStorage tamamen
  silinse bile: epoch anahtarı (sunucudaki sarılı kopyadan açılır) + kimlik
  private + mesaj başlıkları = zincir baştan türetilebilir.
- **FS tam (gönderici tarafı)**: `eph_priv_j` adım sonunda atılır. Eski adımın
  `dh_out_j`'sini bilmenin yolu `eph_priv_j` (silindi) veya alıcının static
  private'ıdır. Göndericinin TÜM durumu (epoch anahtarı + sayaçlar + güncel
  adım ephemeral'ı) sızsa bile önceki adımların mesajları çözülemez.
- **Adım içi backward secrecy korunur**: `root_{j,l}` ileri zincirlenir —
  güncel `root_{j,l}` sızarsa aynı adımın `l' > l` anahtarları türetilir ama
  `l' < l` türetilemez (v2 garantisiyle aynı, gerileme yok).
- **PCS-lite**: sızıntı penceresi = M mesaj / T süre (§4). Pencere + 1'de
  taze ephemeral sızan state'i fiilen geçersiz kılar.

## 2. v4 mesaj formatı (byte-seviyesi)

```
v4 ciphertext = DH header (40B) ‖ AEAD ct (XChaCha20-Poly1305) [‖ Ed25519 imza (64B)]

DH header (40 bayt, plaintext — gizli değil):
  offset 0..31   dh_pub_j     (32B, X25519 ephemeral public)
  offset 32..35  j            (u32 LE, DH adım sayacı)
  offset 36..39  step_base    (u32 LE, adımın başladığı global index)
```

AEAD plaintext'i v1/v2 düzenini korur, yalnız magic değişir:

```
inner plaintext = 0x04 ‖ len (u32 LE, JSON gövde uzunluğu) ‖ JSON ‖ padding
JSON            = { t:'msg', body, sent, ratchet:{ i: <global index> } }   // v2 ile aynı
toplam boyut    = mevcut bucket'lara yuvarlanır (256/1KiB/4KiB/4KiB-adım)   // değişmedi
```

**AAD şablonu (v4):** mevcut şablonun sonuna DH public hex'i eklenir:

```
v4:  <scope>:<channelId>:v<epoch_version>:i<i>:d<hex(dh_pub)>[:<clientId>:<clientSentAt>]
v2:  <scope>:<channelId>:v<epoch_version>:i<i>[:<clientId>:<clientSentAt>]
v1:  <scope>:<channelId>:v<epoch_version>[:<clientId>:<clientSentAt>]
```

AAD'deki `v<epoch_version>` kanal epok numarasıdır (format sürümü DEĞİL —
mevcut anlamlarıyla kalır). `d<hex(dh_pub)>` eki sayesinde AAD, ciphertext'i
DH başlığına da bağlar: iki imzalı mesaj arasında başlık takası imzada da
düşer (AEAD MAC'inin ikinci savunma hattı).

**Ed25519 imza katmanı (v3 mantığı aynen):** detached imza, v4'te şu girdi
üstündedir:

```
sig = Ed25519( DH header (40B) ‖ AEAD ct ‖ utf8(AAD) )
```

v3'ten tek fark imza girdisine 40B başlığın katılmasıdır — başlık artık mesajın
bir parçasıdır ve gönderen atfı kapsamına girmesi zorunludur (başlıksız bırakılırsa
sunucu iki imzalı mesajın başlıklarını takas edebilir; MAC düşer ama imza katmanının
değeri tam kalması istenir). İmza doğrulama yine göndericinin anahtar defterinden
gelen Ed25519 public'iyle, açılmadan önceki noktada yapılır; `SIGN_CUTOVER_MS`
cutover kuralı v4 için de geçerlidir (cutover sonrası imzasız v4 reddedilir).

## 3. Okuma yolları ve backward compat

`decryptText` deneme sırası (değişmedikçe):

| Sıra | Format | Algılama | Anahtar kaynağı |
|---|---|---|---|
| 1 | v1 (0x01 / headersız eski) | AEAD açılışı | epoch anahtarı, AAD'siz index |
| 2 | v2 (0x02) | AEAD açılışı | simetrik ratchet, index taraması 0..MAX_RATCHET_SCAN (10k) |
| 3 | v3 | son 64B imza, gövde v1/v2 yolu | v1/v2 anahtarı + imza doğrulama |
| 4 | v4 | son 64B imza + ilk 40B DH başlığı (iki uzunluk denemesi: imzalı/imzasız) | DH zinciri, l taraması 0..M-1 |

- Yeni mesajlar **yalnız DM scope'unda** v4 üretilir; kanal/gdm v3 üretmeye
  devam eder (5c). v4 okuma yolu scope gözetmez çalışır.
  > **5c güncellemesi:** kanal/gdm artık v4 üretir. Çoklu üye scope'ta
  > `peer_static_pub` rolünü epok anahtarından deterministik türetilen grup
  > DH çapası üstlenir (`dhAnchor` — `dhratchet.ts`): tüm üyeler aynı çifti
  > türettiğinden gönderici/alıcı simetrisi ve stateless alıcı korunur; ek
  > dağıtım gerekmez. Pencere M/T değişmez.
- Eski istemciler v4 mesajını ÇÖZEMEZ (açamaz) — v2'nin tanıttığı aynı
  kesme maliyeti, bilinçli kabul: geçiş "yeni mesajlar v4" kuralıyla ilerler,
  geçmiş etkilenmez.
- Geriye dönük şifre yeniden sarma yok (değişmez).

## 4. Pencere parametreleri (PCS-lite)

| Parametre | Değer | Gerekçe |
|---|---|---|
| `DH_STEP_MSGS` (M) | 100 | Alıcı tarama üst sınırıyla aynı: v4 taraması yalnız l ∈ [0, M) — 10k'nın altında, kötü niyetli ciphertext tarama maliyetini 100 AEAD denemesiyle sınırlar. 100 mesajlık pencere aktif bir DM günü için tek rekey mertebesi. |
| `DH_STEP_TTL_MS` (T) | 24 saat | Düşük hacimli DM'lerde pencereyi günle sınırlar. |
| Sayfa yenileme | her yüklemede yeni adım | Ephemeral private yalnız bellekte yaşar (localStorage'a secret YAZILMAZ — mevcut kural); reload = zorunlu rekey, FS penceresini daraltır. |

Adım kuralı (gönderici): mesaj atarken `l = i - base >= M` **veya** `now - ts
>= T` **veya** ephemeral bellekte yoksa → yeni adım: `j = son_j + 1`,
`base = i`, taze ephemeral. Sayaç `{j, base, ts}` `pgv.dhstep.<channel>.<epoch>`
anahtarıyla localStorage'da tutulur (sır değil). Ephemeral private, adım
süresince modül-scope bellek haritasında yaşar; adım biter bitmez referansı
düşer (GC) — "kullan ve at".

**Gönderici state kaybı senaryosu:** localStorage silinirse `j` 0'dan
başlayabilir. Bu güvenlik açısından tolere edilebilir: ephemeral her zaman
taze üretildiğinden `(j, dh_pub)` çiftleri eşsizdir, anahtar uzayı çakışmaz;
AAD'nin `d<hex(dh_pub)>` eki ve client binding aynı pozisyonun iki kez
kullanımını ayrıştırır; mesaj sıralaması sunucu satır id'sine, index'e değil
dayanır.

## 5. Out-of-order teslim

Her v4 mesajı başlığında KENDİ adımını taşır (`j`, `step_base`, `dh_pub`) —
gecikmiş mesaj, sonraki adımların varlığından bağımsız olarak kendi
başlığından zincirini O(1) türetir; alıcı taraması yalnız o adım içinde
`l ∈ [0, M)` denemesi yapar (v2'nin 10k taramasından ~100× daha küçük). Adımlar
arası karışma yok: yanlış adımın anahtarı MAC'ten geçemez.

`MAX_RATCHET_SCAN` (10k) v2 yolu için aynen kalır; v4 için tarayıcı üst sınırı
`DH_STEP_MSGS`'dir — l ≥ M ile üretilmiş (kural dışı) mesaj çözülemez; bu
bilinçli bir sertliktir (gönderici M'de rotasyonu ZORUNLU kılar).

## 6. Self-update protokolü (yalnız TASARIM — 5c'de uygulanır)

> **5c uygulama notu:** uygulanmış haliyle — taşıma (a) seçildi: WS `dh_update`
> frame'i, sunucu yalnız opak relay (saklamaz/yorumlamaz; sığ b64 + ≤512
> karakter sınırı; kanal→topluluk broadcast, gdm→üyeler, dm→karşı taraf,
> `from` sunucu tarafından eklenir). İstemci `lib/dhupdate.ts`: kanon
> ayrıştırma + defter Ed25519 anahtarıyla doğrulama + TOFU pin
> (`pgv.dhupdates.v1`); UI metni yok (Faz 6 gossip'ine bağlanır). Anahtar
> geçişinin fiili tamamlayıcısı mevcut rekey broadcast'idir (rotate): yeni
> epok sarmalayarak yalnız kalan üyelere gider; kanal/gdm çapası epoktan
> türetildiğinden atılan/çıkarılan taraf yeni adımları türetemez.

Kanal/gdm tarafında (5c) gönderici DH-rekey broadcast'i üye başına sarma ile
yapılır. Buradaki "self-update" bileşeni: ele geçirilen cihazın DH anahtarı
hâlâ defterdeyken kurban, YENİ bir DH anahtarı duyurup geleceği kurtarır:

- **Duyuru kanonu**: `utf8('postacim/dh-update/v1') ‖ utf8(channel_id) ‖
  u32LE(epoch_version) ‖ yeni_dh_pub (32B)`.
- **İmza**: kanon üstüne Ed25519 detached — göndericinin anahtar defterindeki
  imza anahtarıyla doğrulanır (`lib/signkeys.ts` kaynağı, aynı v3 disiplini).
  Doğrulama yardımcıları (`dhratchet.ts`) bu etapta saf fonksiyon olarak
  gelir ve testle sabitlenir.
- **Dağıtım**: WS relay only — duyuru opak bir WS frame gövdesi taşır; sunucu
  plaintext görmez (değişmez). Yeni frame şeması 5c'de tanımlanır; DM'de
  gerekmez (DM'de "self-update" zaten per-adım taze ephemeral ile sağlanır:
  sızan gönderici state'i bir sonraki adımda otomatik dışarıda kalır).
- **Yeniden değerlendirme**: duyurular TOFU+pin mantığıyla (`lib/keypins.ts`
  deseni) izlenir; defter head'iyle ilişkilendirme Faz 6 gossip'ine bırakılır.

## 7. Ses anahtarı (5d için not)

Ses SFrame anahtarı bugün ham epok anahtarından LiveKit keyProvider'a
geçer (`voiceStore`). DH ratchet zincirinden türetim (ör.
`H(step_root ‖ 'voice')`) 5d'nin konusudur; DM araması DM anahtarını
kullandığından DM sesi v4 zincirine bağlanabilir, kanal sesi 5c rekey
broadcast'iyle birlikte değerlendirilir. Bu etapta ses yolunda DEĞİŞİKLİK YOK.

## 8. Bilinen sınırlar (dürüst)

- **PCS-formel yok.** MLS/TreeKEM Update akışı olmadan compromise-sonrası
  otomatik iyileşme yalnız gönderici tarafında ve pencere genişliğindedir
  (M/T). Alıcı tarafında recovery mekanizması bu etapta yoktur. Bedel
  RFC 9420 Introduction'ın sender-key tasarımlar için söylediğiyle aynıdır;
  bilinçli kabul — gerekçe: Faz 5a brifi §6 (openmls-wasm tarayıcı yolu
  production olgunlukta değil; kendi DR'nin vektörsüz doğrulanabilirliği en
  zayıf halka).
- **Alıcı ele geçirme penceresi yok**: alıcının kimlik private'ı sızarsa
  (tasarımda kalıcı ve memory-only KEK arkasında) gözlemlenen tüm v4 mesajlar
  çözülür — stateless türetim bunu GEREKTİRİR; Signal'in tersine alıcıda da
  ileri silme yoktur. Dürüst takas: statelessness, F5/multi-tab/localStorage
  kaybı dayanıklılığına öncelik verir.
- **Tek cihaz**: aynı hesabın ikinci bir istemcisi gönderici sayaçlarını
  paylaşamaz (j çakışması tolere edilir ama zarif değil) — Faz 7 konusu.
- **Pencere içi sızıntı**: aktif adımın ephemeral'ı çalındıysa o adımın
  geleceği (ve geçmişi değil) okunur; M=100/T=24h sınırlar.
- **Audit planı**: dış audit Faz 8 (`docs/SECURITY-REVIEW.md` hazırlık paketi);
  bu modülün kendi KAT vektörleri (`dh-ratchet.vectors.json`) + negatif
  envanteri audit girdisidir. Resmî Signal vektörü yoktur (Faz 5a §3.1) —
  iddia "Signal tarzı DH ratchet alt kümesi" olarak sınırlı tutulur.

## 9. Test vektörleri

`web/src/crypto/dh-ratchet.vectors.json` — deterministik fikstür: sabit
epoch anahtarı, sabit iki tarafın kimlik anahtarları, sabit ephemeral
scalar'ları (j=0..2), her adım için `dh_out`, `step_root`, l=0..2 msg
anahtarları; bir örnek AAD ve tam bir imzalı v4 mesajı (sabit nonce) + beklenen
gövde. Okuyucu test (`dh-ratchet.test.ts`) fikstürü bağımsız yeniden hesaplayıp
eşitliği ve mesajın çözülebilirliğini doğrular. KAT'ın amacı: KDF şemasını
dolayısıyla gelecekteki refaktörleri bit-bit sabitlemek (resmî vektör
olmadığından kendi KAT — Faz 5a §4.3).
