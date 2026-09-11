# postacim — Tasarım

## Yön

postacim gece posta vagonudur: Discord ritmi, kayıtlı-posta disiplini, sıfır-bilgi. Her yüzey mühürlenmiş postanın işlendiği tezgâh; sunucu kördür, damga görünürdür. "Güvercinler gece uçar" — metafor tek bir iş vaadine katlanır: mesajın da içeriği de seni terk etmez. Dil, form, hareket ve ses aynı mesajı söyler.

## Marka dünyası

`Brand.tsx` üç atomu bir kez çizer, her yerde yeniden kullanır.

- **PigeonMark** — sağa doğru kayan gövde, mürekkep içinden oyulmuş göz. Üst bar, ray başı, login formu, çağrı bekleme yerleri; sahnede her zaman `lamp-500` renginde.
- **SealMark** — yuvarlak resmi mühür, çift halka, halka üzerinde `POSTACIM · UÇTAN UCA ·` metni bir `textPath` boyunca döner, merkezde PigeonMark. Yalnızca login sol sütununda, "vagon kapısı" kompozisyonunda.
- **Postmark** — iptal çubuklu küçük postmark. Login formunun sağ-üst köşesinde `animate-stamp` ile vurulur; kendi mesajının başında da `animate-stamp` ile taze mühür görünür (5 sn penceresi).

## Tokenlar

`index.css` `@theme` bloğu, tasarımın tek sözleşmesi.

- **gece** — `night-950/900/850/800/700/600`. Vagon zemini: en derin sayfa arka planı, kademeli kalkık yüzeyler, sürgülü drawer.
- **lamba** — `lamp-700/600/500/400/300/100`. Tek ivme. Amber, gece üzerinde tek vurgu olarak çalışır; birincil eylemler, aktif ray, mühür rengi, focus halkası.
- **pirinç** — `brass-700/600/500/400`. Saç-tel sınırlar, fokus, ayraç noktaları. Donanım.
- **kağıt** — `paper-700/500/300/100/50`. Sıcak mürekkep, gri değil. Gövde ve başlık tonları.
- **damga** — `stamp-600/500/400/100`. Yalnız resmi: bitir butonu, hata, kilit onayı, eşleşmeyen şifre uyarısı.

Tipografi: `--font-display` Barlow Condensed (rota plakaları, başlıklar, büyük harfli etiketler); `--font-sans` Public Sans Variable (gövde); `--font-mono` JetBrains Mono Variable (saat, parmak-izi, kurtarma ifadesi). Hepsi self-hosted — CDN yok, CSP dostu.

Animasyon: `--animate-stamp` (0.45s, cubic-bezier 0.16,1,0.3,1) ve `--animate-seal-in`. Stamp, mührün kâğıda inişidir: 1.9× büyük + -14° döndürülmüş → 0.94× + 2° sıçrama → 1× yerleşik. Seal-in, drawer girişi.

Bileşen sınıfları `@layer components` içinde tek noktada: `.plate` (rota plakası etiketi), `.input` (posta senedi), `.btn-lamp` / `.btn-ghost` / `.btn-stamp`, `.perf` (delgili kesik çizgi), `.sealed-band` (kayıtlı-posta markası).

## İlk görünüm — Login

`min-h-screen` üzerinde iki sütun (`lg:flex-row`). Sol: **vagon kapısı** — `SealMark size={128}` papatya-terazisi, altında `postacim` display başlığı (Barlow Condensed 6xl, `tracking-[0.08em]`), slogan ("güvercinler gece uçar — mesajın da seninle gizli taşınır"), üç özellik satırı (ShieldCheck / ServerOff / EyeOff + `lamp-500` ikon). Sağ: **posta senedi** — `night-900` üzerine `brass-700/70` kenarlı kart, sağ-üst köşede `animate-stamp` ile dönen `Postmark`; başlık satırında PigeonMark + plate etiket ("GİRİŞ" / "KAYIT") + yardımcı cümle ("sunucu hiçbir şey göremez"); nick + şifre + (kayıt) şifre tekrar + onay kutusu (3 sn anti-reflex ile `ackReady`); hata varsa `stamp-100` zeminli `stamp-400` kutusu; birincil `btn-lamp`. Kayıt ikinci adımı (kurtarma ifadesi) ve şifremi unuttum aynı kart şablonunu yeniden kullanır. Mobil: iki sütun `flex-col`'a düşer, kartlar üst üste.

## Kabuk — Shell

`h-screen` flex kolon. Üst **rota plakası** (`h-11`, `night-900`): mobil menü, PigeonMark + `postacim` plate, `wsStat` rozeti ("hat kuruluyor" kehribar / "hat yok — yeniden deneniyor" damga), sağda `user.nick` ve `kurtarma` / `şifre` / `çıkış` `btn-ghost` üçlüsü. Gövde: `lg` üzerinde `ServerRail` + (community görünümündeyse) `ChannelSidebar` + ana kolon + (`xl`) `MemberList`. Mobil drawer: tam ekran karartma + `animate-seal-in` ile kayan sol panel (rail + channel sidebar birlikte). `IncomingCall` modalı, `CallView` (DM çağrısı tam ekran) veya `PiPWidget` (çağrı küçültüldüğünde) Shell tarafından monte edilir; `Modal` ile şifre ve kurtarma modal'ları koşullu.

## Sunucu rayı — ServerRail

`w-16` dikey kolon, her öğe `h-11 w-11` **posta çuvalı etiketi**. Aktif olan `rounded-lg bg-lamp-500 text-night-950`; pasifler yuvarlak + `brass-700/50` halka, hover'da `rounded-full`'dan `rounded-lg`'a yumuşar. DM girişi tepede PigeonMark ile; `dmUnread > 0` ve DM dışındaysa sağ-üstte `lamp-500` balonu. Topluluklar: iki harf kısaltma (TR yerel), aktif değilken etiketin üst ortasında **eyelet** (delik, `night-950` dolu). Ayırıcı `.perf`. Alt: `+` (oluştur) ve `↗` (davetle katıl). Davet modal'ında `parseInviteLink` ile link doğrulanır, `location.hash` ham parçaya yönlendirilir (kısa ömürlü anahtar kodu korunur).

## Sohbet — ChatView

Üst başlık: kanal adı display + `sealed-band` "uçtan uca mühürlü" (ShieldCheck ikon). `needs_rekey` ise: kehribar şerit ("Bir üye çıkarıldı — eski anahtar risk altında, yazışma kilitli"), staff ise "anahtarı yenile" ghost butonu. Gövde: `flex-1 overflow-y-auto`; üstte `hasMore` ise "daha eski mesajlar"; günlük ayraçlar `.perf` + `formatDay` ortada. Boşken: "henüz yük yok — ilk mühürlü zarfı sen bırak". Alt: `Composer`, gönder tuşu `btn-lamp !h-10 !w-10` daire. Kanal değiştiğinde `loadHistory`; altta isek `stickToBottom` ile otomatik kaydır; en son mesaj `markRead`.

**MessageRow**: `grouped` (önceki mesajla aynı gönderen, <5dk, aynı gün) ise sıkışık; değilse avatar (ilk harf, `nickColor`). Baş satırı: nick (renkli) + `formatTime` mono + **kendi ise** Postmark (`brass-500`, `fresh` ise 5 sn pencerede `animate-stamp`); tooltip "bu vagondan mühürlenip gönderildi". Gövde yoksa ("bu zarf açılamadı — anahtar bu epoch için sende değil") italik uyarı; varsa sıradan kağıt mürekkebi.

**Composer**: tek satır `textarea` `max-h-40`, otomatik büyüme (`scrollHeight`, üst sınır 160px). Enter gönder, Shift+Enter satır. Hata varsa `stamp-400` satır üstünde. `disabled` durumda placeholder değişir ("kanal yeniden anahtarlanana kadar kilitli…").

## Arama — CallView

Tam ekran `fixed inset-0 z-50`, `night-950/97` arka plan. Üst bar: `plate "GÖRÜŞME"` + karşı nick + `sealed-band` (durum: "çalıyor…" / "görüşme açık" / "bitti"); sağda `Minimize2` "küçült — sohbete dön" ghost. Oda yoksa: PigeonMark + "vagona bağlanıyor…". Varsa: `RoomContext.Provider` içinde **Grid** — her katılımcı bir `min-h-48` kare, içinde `ParticipantTile`; sol-alt **Plate** (display isim + opsiyonel `ekran` mono etiket, `local` ise `(sen)`). Filtre: ekran > kamera > mikrofon; kişi başına tek karo. Alt: `CallControls variant="call"`.

**CallControls**: yuvarlak `h-11 w-11` düğmeler — mikrofon, kamera, ekran paylaş, (DM) PiP, `sealed-band` mono "uçtan uca · sframe" / "mikrofon kapalı", en sağda `btn-stamp !rounded-full` `PhoneOff` + `endLabel`. "Açık" durumu `brass-600/60` halka, kapalı/iptal `stamp-500` dolu — tek renkle iki durum.

## PiP — PiPWidget

`fixed bottom-4 right-4 z-40 w-72 rounded-lg brass-600/70` çerçeve, derin gölge. Üst: `plate "GÖRÜŞME"` + peer nick + `Maximize2` (büyüt) + `PhoneOff` (bitir). Gövde: `RoomContext.Provider` + `PiPTile` (uzak kare tercih: ekran > kamera > herhangi bir; yoksa "karşı taraf bekleniyor"); alt: `CallControls variant="call"`. **Headline davranış**: altındaki sohbet tamamen etkileşimli kalır — kullanıcı çağrı sürerken yazmaya, kanalları dolaşmaya devam eder. `Shell` koşullu olarak ya `CallView` ya `PiPWidget` basar (`isDmCall && !pip` / `isDmCall && pip`).

`lib/nick.ts` `nickFor(userId)`: önce auth kullanıcısı, sonra topluluk üyeleri, sonra DM/grup DM'leri, en sonda ham id. `Plate`, `PiPTile` ve `CallView` aynı çözümleyiciyi paylaşır.

## İlkeler

- **Minimum kod, cerrahi değişiklik.** Marka atomları tek dosyada, tokenlar tek yerde. Bileşen sınıfları yalnızca tekrar eden görsel dile aittir.
- **Gizliliği görünür kılan her dil kararı.** "uçtan uca · sframe" her çağrı altında; "uçtan uca mühürlü" her kanal başlığında; "ŞİFRESİZ ŞİMDİ" markı gibi, **kayıtlı-posta bandı** bir UI kalıbı değil vaadin kanıtıdır. Damga kırmızısı sadece tehlike/resmi işlem. Sunucu hiçbir yerde içerik görmez — sadece sarmal kutular.
- **Davranış token'ı renkten önce gelir.** Aktif/pasif ray `rounded-full → rounded-lg` ile; ayraçlar delgili çizgi; mühür animasyonu sadece taze olayda.
- **Erişilebilirlik.** Tüm mark atomları `aria-hidden`; düğmelerde `aria-label`/`aria-pressed`; `font-mono` saat ve kurtarma ifadesinde.

## Testler

Vitest, **153/153 yeşil**. Kapsam: crypto (BIP-39 üretim + doğrulama + **çakışma retry** — collision test'i), auth mağazası, sohbet/DM state, voice/drawer davranışı, rekey, komponent snapshot'ları. `crypto.test.ts` deterministik RNG'yi tolere eden çakışma stratejisini sınar — aynı kelime iki kez üretildiğinde tekrar üretir.
