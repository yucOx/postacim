# Gizlilik Politikası

**postacim** — uçtan uca şifreli mesajlaşma · yuxor.ltd tarafından işletilir
Yürürlük: 17 Eylül 2026

Bu sunucunun ne saktığını ve neyi **saktığını** anlatıyor. Kod her iddiayı doğrulayacak şekilde açık — "sunucu göremez" derken bunu kripto garantisi olarak kastediyoruz, vaat olarak değil.

---

## 1. Topladıklarımız / bilmerek toplamadıklarımız

**Sunucuda saklananlar:**

- **kullanıcı adı (nick)** — benzersiz olmalı, büyük/küçük harf duyarsız
- **şifre doğrulama verisi**: şifreniz tarayıcıdan asla çıkmaz; tarayıcı şifrenizden Argon2id ile türettiği 32 baytlık malzeme gönderilir, sunucu bunun **Argon2id hash'ini** saklar (düz metin veya türetilebilir hali asla saklanmaz)
- **şifreleme anahtarınızın sarmalı** (key blob): özel anahtarınız, şifrenizden türeyen bir anahtarla sizin cihazınızda şifrelenir — sunucu açamaz
- **genel anahtarlarınız** (X25519 + Ed25519 imza anahtarı; çoklu cihaz kullandıysanız cihaz başına ayrı çift) — diğer kullanıcıların size şifreli anahtar sarmalayabilmesi, mesajlarınızın gönderen atfını doğrulaması ve güvenlik numaranızı karşılaştırabilmesi için; bunlar kamuya açık **anahtar defterine** (append-only hash zinciri) da yazılır
- **cihaz listeniz** (çoklu cihaz, isteğe bağlı): bağladığınız her cihazın genel anahtar çifti ve bağlantı zamanı — sunucu hesabınıza hangi cihazların bağlı olduğunu bilir; cihazlarınızdaki içerigi (mesajlar, anahtarların açık hali) göremez. Bir cihazı iptal etmeniz anahtar yenilemeyi (rekey) zorunlu kılar
- **kurtarma ifadesinin sarmalı** (isteğe bağlı): 12 kelimelik ifade, özel anahtarınızın ikinci bir sarmasıdır — sunucu ifadenin kendisini asla görmez
- **avatar** (isteğe bağlı): 64×64 küçük JPEG (~3–8 KB), şifresiz — bilerek şifresizdir, herkese açık profil parçasıdır
- **hesap oluşturma tarihi** ve oturum kayıtları (oluşturma + sona erme zamanı, ~7 günlük süresi etkinlikle yenilenir; oturum token'ı yalnızca SHA-256 hash'i olarak saklanır)
- **mesajlar**: yalnızca şifreli zarf (nonce + ciphertext), gönderici kimliği, saat, boyut — **içerik sunucuda asla okunabilir halde değildir**
- **kaybolan mesaj süresi** (isteğe bağlı): mesaj başına seçilen TTL (`expires_at`) sunucu için **görünür metadata'dır** — süreyi bilir, içeriği bilmez. Yaşam döngüsü: süresi dolan mesaj sunucuda tombstone'a çevrilir (nonce/ciphertext silinir), istemcide de süresi dolanlar render'dan düşer; yani erişim + ömür sınırlaması bu ikisinin kombinasyonudur
- **sosyal graf**: kim hangi topluluğa/kanala üye, kim kime DM açmış, arkadaşlıklar, davetiyeler, roller
- **topluluk / kanal / grup adları** (şifresiz)
- **sesli arama/konferanslar**: kim katıldı, hangi kanalda, ne zaman — ses/görüntü içeriği uça-uca şifrelidir (SFrame); medya sunucusu (LiveKit, kendi sunucumuzda) içeriği göremez, katılım bilgisini görür

**Bilmerek toplamadıklarımız:**

- e-posta adresi, telefon numarası — **hiçbiri istenmez, saklanmaz**
- rehber/kişi listesi
- tarayıcı/donanım parmak izi (fingerprint), cihaz marka-model bilgisi — toplanmaz (bağladığınız cihazların **genel anahtar** listesi hariç — yukarıda bildirildi)
- analitik, reklam, izleyici çerezi, üçüncü taraf istatistik servisi
- konum
- **okundu bilgisi**: cihazınızın dışına çıkmaz (tarayıcınızda saklanır, sunucuya gitmez)

**Gerekli çerez:** yalnızca bir oturum çerezi (httpOnly, SameSite=Strict) — giriş için zorunludur, izleme amaçlı değildir. Tarayıcınızda ayrıca saklanan: okunmadı işaretleri, gizlediğiniz mesajlar, pinalenmiş anahtarlar — bunlar cihazınızda kalır, sunucuya gönderilmez.

---

## 2. Şifreleme: sunucu neyi görebilir, neyi göremez

**Göremez:**

- mesaj, DM ve grup içeriğini (XChaCha20-Poly1305; anahtarlar yalnızca katılımcılarda)
- özel anahtarınızı, şifrenizi, kurtarma ifadenizi
- sesli/görüntülü arama içeriğini
- kanal/DM anahtarlarının açık halini (yalnızca her kullanıcı için sarmalanmış kopyaları saklanır)

**Görebilir (metadata):**

- kim, kime, ne zaman, kaç mesaj, ne boyutta yazdı
- kim kiminle arkadaş, kim hangi odada, kim ne zaman çevrimiçi/aramada
- hesabınızın açılış tarihi, son etkinlik zamanı
- bu verilerden sosyal grafınız ve davranış alışkanlıklarınız çıkarılabilir — bunu dürüstçe söylüyoruz

**Güvenlik numarası:** her kullanıcının anahtar parmak izi profilden karşılaştırılabilir. Sunucu bir anahtarı değiştirmeye kalkarsa (hesap ele geçirme), karşınızda **kırmızı uyarı** çıkar. Kendi güvenlik numaranızı karşı tarafla sesli/yüz yüze doğrulamanız önerilir.

**Web'den gelen sınırlar:** istemci kodu bu sunucudan dağıtılır; sunucu sahibi teorik olarak değiştirilmiş istemci kodu servis edebilir (her web tabanlı E2EE uygulamanın ortak sınırı). Anahtarlarınızı doğrulamak için güvenlik numarası özelliği tam bu riski azaltır.

---

## 3. Loglar

- **Uygulama logu**: istek yöntemi, yol, durum kodu, süre kaydedilir. **Mesaj içeriği loglanmaz** (gövde loglanmaz). Logdaki IP, yalnızca ters proxy'nin iç adresidir — istemci IP'si uygulama loguna yazılmaz.
- **Web sunucusu (nginx) access logu**: varsayılan olarak açık — istemci IP'si, tarayıcı bilgisi, zaman, istenen yol burada görünür. Sunucu operatörü bunu kapatabilir; kapalıyken de bildirir.
- Giriş/kayıt önü uçlarda istemci IP'si, hız sınırı için **yalnızca bellekte** tutulur, kalıcı saklanmaz.
- Arama yapılırken Cloudflare Turnstile etkinleştirilmişse (operatör seçimi), doğrulama Cloudflare'e gider; etkin değilse hiçbir üçüncü tarafa veri gitmez.

---

## 4. Hesap silme — kalıcı ve geri alınamaz

Profil > "hesabımı kalıcı sil". Tek tıkla:

- hesabınız, yazdığınız **tüm mesajlar** (her kanal/DM/grup), tüm DM'leriniz, kurduğunuz gruplar ve topluluklar, anahtarlarınız, avatarınız ve tüm oturumlarınız **anında ve kalıcı** silinir
- kurtarmanızın tek yolu olan **kurtarma ifadesi bile silinmiş hesabı geri getiremez**

**Kurtarma:** Şifrenizi unutursanız hesabınızı yalnızca kaydettiğiniz 12 kelimelik kurtarma ifadesi geri getirir — e-posta/telefon yok. **Hem şifrenizi hem ifadenizi kaybettiyseniz hesabınıza erişim kesin olarak sonlanır; kimse onu geri getiremez.** Bu bir kusur değil, tasarımın kendisidir.

---

## 5. Hukuki talepler

Zorunlu bir hukuki talep gelirse, **yalnızca teknik olarak elimizde bulunan veriyi** paylaşırız: kullanıcı adı, hash'lenmiş şifre doğrulama verisi, hesap zaman damgaları, katılım/bağlantı metadata'sı ve loglar. **Mesaj içeriğini hiçbir koşulda çözemeyiz** — çözmeye imkân verecek bir anahtar elimizde yoktur ve saklanmaz.

---

## 6. Hizmetin niteliği ve sorumluluk sınırları

Hizmet **"olduğu gibi"** sunulur: kesintisizlik, veri kaybı olmayacağı veya belirli bir amaca uygunluk taahhüt edilmez. Sistemin kötüye kullanımı, veri kaybı, kesinti veya kullanımınızdan doğan dolaylı zararlardan operatör sorumlu tutulamaz. Uçtan uca şifreleme, karşı tarafın ekran görüntüsü almasını veya mesajı kopyalamasını engelleyemez.

---

## 7. Yaş sınırı

Hizmet **16 yaş ve üzeri** içindir. 16 yaşından küçükler hesap açmamalıdır (KVKK'daki çocuk verisi işleme eşiğine uygun).

---

## 8. İletişim

Sorular, silme/veri talepleri, şikâyetler: **postacim@yuxor.ltd**

---

## 9. Politika değişiklikleri

Bu politika sürümlenir ve kamuya açık depoda saklanır. Önemli değişiklikler uygulamada duyurulur; değişen metin bu sayfada yeni yürürlük tarihiyle yayımlanır.