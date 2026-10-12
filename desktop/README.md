# postacim — Masaüstü (Electron)

postacim masaüstü uygulaması: **Electron sarmalayıcı**. İnce istemcidir —
tüm uygulama kodu paket içinde gelmez, web uygulaması her açılışta
**sunucudan yüklenir**. Discord'un masaüstü uygulaması ile aynı model:
Electron + sabit Chromium, LiveKit/WebRTC açısından öngörülebilir ve
güvenilir bir ortam verir. Tauri/WebKitGTK alternatifi WebRTC'de
güvenilmez olduğundan bilinçli olarak tercih edilmedi.

Masaüstü kabuğu kripto işine karışmaz; E2EE tarayıcıdakiyle birebir aynı
koddur (aynı web paketi, aynı libsodium zincirleri).

## Ne getirir

- **Tepsiye gizlenme** — pencere kapatınca uygulama çıkmaz, sistem tepsisine
  gizlenir; tepsiden tekrar açılır.
- **Okunmamış sayacı** — uygulama rozeti + tepsi ipucu (tooltip) üzerinden
  okunmamış mesaj sayısı görünür.
- **Secure-context muafiyeti (http LAN)** — mikrofon, kamera, bildirim ve
  pencere-içi-pencere (PiP) özellikleri tarayıcıdaki "yalnız https" kısıtı
  olmadan çalışır. Muafiyet **yalnızca kendi sunucu kaynağına** uygulanır;
  uygulama rastgele sitelere ayrıcalık kazanmaz.
- **Ekran paylaşımı** — `getDisplayMedia` yerel kaynak seçici ile çağrılır;
  ekran/pencere seçimi tarayıcı sekmesi yerine yerel pencerede yapılır.
- **Sunucu başına kalıcı partition** — her sunucu adresi kendi Chromium
  partition'ında çalışır; farklı sunucuların oturumları ve E2EE anahtar
  depoları (IndexedDB/localStorage) **karışmaz**.
- **Tek örnek kilidi** — ikinci başlatma yeni pencere açmaz, mevcut örneği
  öne getirir.
- **Dış bağlantılar** — uygulama içindeki harici linkler sistem tarayıcısında
  açılır.

## Geliştirici kurulumu

```bash
cd desktop && npm install && npm start
```

Sunucu adresi üç yoldan biriyle belirlenir:

1. İlk açılışta sorulur ve kaydedilir (kurulum penceresi).
2. Ortam değişkeni: `POSTACIM_URL=https://sunucu npm start`
3. Argüman: `npm start -- --url=https://sunucu`

Kayıtlı adres `~/.config/postacim-desktop/config.json` içinde tutulur.

## Paketleme

```bash
npm run dist
```

Çıktı `desktop/dist/` altındadır: **AppImage + deb** (x64, Linux).

## İçerik yapısı

```
desktop/
├── src/main.js       # ana süreç (Electron main)
 ├── src/preload.cjs   # yalnız ilk-kurulum penceresi için postacim.saveServer(url) köprüsü
└── build/icon.png    # uygulama ikonu
```

## Bilinen sınırlar

- Ekran paylaşımında çoklu monitör ortamında **ilk ekran** seçilir;
  pencere/ekran seçici arayüzü v1'de yok.
- Ekran paylaşımı sesi yalnız **Windows**'ta taşınır (loopback); Linux/macOS'ta
  görüntü paylaşılır, sistem sesi paylaşılamaz.
- Otomatik güncelleme yok — yeni sürüm için paketi yeniden derleyip kurmak gerekir.
- macOS ve Windows paketleri henüz yok; paketleme Linux x64 içindir.

## Gizlilik notu

Masaüstü kabuğu mesaj içeriğine **dokunmaz**; E2EE tarayıcıdakiyle aynıdır —
sunucudan yüklenen aynı web kodu çalışır. Kabuğun eklediği şey yalnızca
yukarıdaki masaüstü kolaylıklarıdır; şifreleme, anahtar türetimi ve anahtar
saklama tamamen web uygulamasındaki mantıkla, sunucu kaynağından gelen
kodda gerçekleşir. Sunucu değişirse (JS trust sınırı) masaüstü istemcisi de
tarayıcı kadar etkilenir — bkz. kök README'deki
[JS integrity doğrulaması](../README.md#doğrulama-js-integrity-release-manifest).
