# Tor hidden service — postacim'i onion üzerinden sunmak (IP metadata kapanışı)

> Bu rehber mevcut bir postacim kurulumuna (bkz. [vps-fresh-install.md](vps-fresh-install.md))
> Tor v3 onion service ekler: istemciler `.onion` adresinden bağlanır, sunucunun
> IP'si ifşa olmaz, istemcilerin ağ konumu metadata'sı Tor ağından geçer. Doküman fazı —
> hiçbir uygulama kodu değişmez; yalnızca tor + nginx vhost + `.env` ayarı.
>
> Tüm `<PLACEHOLDER>` değerlerini kendi ortamına göre değiştir:
>
> | Placeholder | Açıklama | Örnek |
> |---|---|---|
> | `<ONION_ADDR>` | Onion adresi (56 karakter, `hostname` dosyasından okunur — seçilmez, üretilir) | `2gzyxa5ihm7nsggfx7mu75k6kvlag2ahpv2aeqfokflo4ry4juhs3qid.onion` |
> | `<DOMAIN>` | (opsiyonel) Clearnet alan adı | `postacim.example.com` |
> | `<REPO_DIR>` | Repo klonlanan dizin | `/opt/postacim` |

## 0. Bu rehber neyi kapatır, neyi kapatmaz

**Kapatır:**

- **Sunucu IP'si üzerinden konum/kimlik çıkarımı** — onion adresi sunucunun IP'sini
  ifşa etmez; Tor introduction + rendezvous noktaları aradaki ilişkiyi gizler.
- **İstemci IP'si sunucuya görünmez** — tüm onion istemcileri host'a `127.0.0.1`
  üzerinden gelir (bkz. §9'un bedel notu).
- **Ağ pasif dinleyicisi** threat model maddesi onion için kökten kalkar: v3 onion
  adresi, servisin ed25519 anahtar parmak izidir — istemci bağlandığı sunucunun
  kriptografik kimliğini adresin kendinden doğrular (CA'ya ihtiyaç duymayan
  yerleşik sunucu kimliği).

**Kapatmaz (dürüst sınır):**

- **WebRTC medya Tor'dan geçmez** — sesli/görüntülü arama ve ekran paylaşımı UDP
  tabanlıdır (LiveKit ICE), Tor SOCKS üzerinden akmaz. Mesajlaşma Tor'da tam
  çalışır, arama doğrudan gider ya da kapatılır. Detay ve iki çözüm: §7.
- **Sunucu içi metadata** — sosyal graf, zamanlama, mesaj boyutu sunucuda
  görünmeye devam eder (README "Tehdit modeli"). Tor bunları gizlemez.

## 1. Tor kurulumu

```bash
apt-get update -qq
apt-get install -y tor
systemctl enable --now tor
tor --version
# Tor v0.4.8.x (Ubuntu 24.04 universe) — v3 onion service destekli.
# (v2, Tor 0.4.6.1-alpha'dan beri desteklenmiyor; 2021. Yeni servis daima v3.)
```

SOCKS proxy varsayılan olarak `127.0.0.1:9050`'de dinler — §10'daki testler
bunu kullanır.

## 2. Hidden service tanımı

`/etc/tor/torrc` sonuna ekle:

```ini
HiddenServiceDir /var/lib/tor/postacim/
HiddenServicePort 80 127.0.0.1:8081
```

- `HiddenServicePort 80` — sanal port: istemci `http://<onion>/` bağlantısında
  gördüğü port. Sağdaki değer host içindeki gerçek hedef (§4'teki nginx vhost).
- `ClientAuthentication` **kullanılmaz** — postacim public bir servistir; herkes
  adresten erişebilmeli (v3 client auth, servisi anahtar sahiplerine kapatır —
  davet mekanizması zaten uygulama katmanında var).

```bash
systemctl restart tor
sleep 5
cat /var/lib/tor/postacim/hostname
# 2gzyxa5...qid.onion   ← <ONION_ADDR> budur
```

### 🔴 Ders — `hostname` yanındaki dosyalar adrestir, kaybı adres kaybıdır

`/var/lib/tor/postacim/` altındaki `hs_ed25519_secret_key` + `hostname` ağdaki
kimliğin ta kendisi:

- **Sızarsan**: başkası aynı onion adresini taklit edemez ama servisini başka
  bir yerde aynı adresle çalıştırıp adresi ele geçirebilir.
- **Kaybedersen**: adres değişir, tüm kullanıcılar yeni adresi bant dışı öğrenmek
  zorunda kalır.

Yedekle (root-only): `cp -a /var/lib/tor/postacim /root/tor-postacim-backup`
ve chmod 700. Onion adresi bir kez üretilir, istenilen adres üretilemez
(vanity üretim GCOS/markov tool'larla haftalar sürer — uğraşma).

## 3. İki yol — dürüst kıyas

Onion arkasında nginx'i iki şekilde servis edebilirsin:

| | Yol 1: düz http onion | Yol 2: https-onion (ÖNERİLEN) |
|---|---|---|
| Kurulum | 5 dk, sertifika yok | Sertifika alımı gerekir (DV/ EV) |
| Aktarım şifresi | Onion devre şifrelemesi (3 hop, uçtan uca Tor katmanı) | Onion devre + TLS (nginx'e kadar) |
| Sunucu kimliği | v3 adres = anahtar parmak izi (kriptografik) | Aynı + tarayıcıda sertifika UI'ı |
| Oturum çerezi | `Secure=false` ZORUNLU (aşağıdaki karar kutusu) | `Secure=true` kalır |
| Tor Browser dışı tarayıcı | http sayfa uyarıları, HSTS anlamsız | Yeşil kilit, HSTS işler |
| Sertifika bedeli | yok | HARICA DV (makul) / DigiCert EV (yüksek) |
| Kim için | hızlı deneme, kapalı grup | kalıcı public dağıtım |

**Önerilen yol: https-onion (Yol 2).** Gerekçe: postacim çerezi Bearer token'ın
birebir aynasını taşır; `Secure` bayrağı kaybolursa aynı tarayıcıdaki diğer
http bağlamlara token sızmalarının yüzeyi büyür ve tarayıcı tarafı korumaları
(Secure çerez reddi, HSTS) devre dışı kalır. Onion devre şifrelemesi aktarımı
korusa da, kalıcı bir public dağıtımda TLS'in getirdiği tarayıcı seviyesindeki
garantiler bedelini hak ediyor.

### 🔴 Güvenlik kararı — http onion'da çerez `Secure=false` düşer

Cookie spec'i (RFC 6265) gereği tarayıcılar **http** üzerinden `Secure`
çerezi kabul etmez ve göndermez. Repodaki üretim kodu bunu proto'ya bağlar
(`server/src/routes/auth.ts`, `sessionCookie`):

```ts
const proto = req.headers['x-forwarded-proto'];
reply.setCookie(SESSION_COOKIE, token, {
  ...
  secure: proto === 'https',
```

Host nginx `X-Forwarded-Proto $scheme` yazar; §4'teki onion vhost `http`
üzerinde dinlediği için `scheme=http` → çerez `Secure=false` üretilir.
Yani kod tarafında bir şey yapmaya gerek yok — **davranış zaten uyumlu**, ama
bu bir varsayılan değil, bilinçli kabul edilmesi gereken bir güvenlik
kararıdır:

- Token ağda **plaintext gitmez** (onion devre şifreli, §3 tablosu) — kayıp
  `Secure`, token'ın telde açık dolaştığı anlamına gelmez; çerezin Secure
  flag'iyle gelen tarayıcı-katmanı disiplinini kaybettiği anlamına gelir.
- https-onion'da (§5) `X-Forwarded-Proto https` → `Secure=true` — karar kutusu
  kapanır.

## 4. Yol 1 — düz http onion (hızlı)

Host nginx'e onion vhost'u ekle (`/etc/nginx/sites-available/postacim-onion`).
`map $http_upgrade $connection_upgrade` bloğu nginx genelinde **bir kez**
tanımlıdır (`deploy/nginx-postacim.conf` başında) — onion vhost'u onu kullanır,
tekrar yazma (yoksa `nginx -t` "duplicate map" der):

```nginx
# postacim — Tor onion vhost (http yol)
# Tor daemon'u 127.0.0.1:8081'e bağlanır (torrc: HiddenServicePort 80 → burası).
# Port yalnız 127.0.0.1'e bağlı: onion dışından erişilemez.
server {
    listen 127.0.0.1:8081;
    server_name <ONION_ADDR>;

    client_max_body_size 10m;

    # onion arkasında $remote_addr hep 127.0.0.1 — log hiçbir bilgi taşımaz
    access_log off;

    location /api/ {
        proxy_pass http://127.0.0.1:4000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $remote_addr;   # XFF'yi yazan tek yer kuralı korunur
        proxy_set_header X-Forwarded-Proto http;         # ← çerez Secure=false (yukarıdaki karar kutusu)
    }

    location /ws {
        proxy_pass http://127.0.0.1:4000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Proto http;
        proxy_read_timeout 1h;
        proxy_send_timeout 1h;
    }

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto http;
        proxy_read_timeout 1h;
        proxy_send_timeout 1h;
    }
}
```

```bash
ln -s /etc/nginx/sites-available/postacim-onion /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx
```

Sonra `.env`'de `LIVEKIT_URL=http://<ONION_ADDR>/livekit` (§6) ve
`systemctl restart tor` zaten yapıldıysa §10 doğrulamasına geç.

## 5. Yol 2 — https-onion (önerilen)

### 5.1 Güncel CA durumu (2026, Tor Project + CA/Browser Forum doğrulaması)

- CA/Browser Forum 2020 oylamasıyla `.onion` sertifikaları yalnız EV olmak
  yerine **DV/OV** için de açıldı (Tor, onion adresinin kriptografik doğrulanma
  biçimi nedeniyle EV-düzeyi kimlik kontrolünün gereksizleştğini savundu).
- Bugün geçerli yol:
  - **HARICA** (Yunan akademik non-profit CA) — **DV** TLS, `.onion` için
    makul fiyatlı, Tor topluluğunda standart tercih.
  - **DigiCert** — **EV** TLS (Facebook/NYT onion servislerinin kullandığı
    tarihî hat; BTCPay Server rehberlerinin gösterdiği model). Kurumsal kimlik
    doğrulaması ister, fiyat yüksek.
  - **Let's Encrypt `.onion` vermiyor** (gelecekte ücretsiz onion sertifikası
    beklentisi Tor Project tarafında sürüyor; bugün yok).
- Onion-key'le imzalı self-sertifika zincirlerini tarayıcının doğrulaması
  önerilse de uygulanmadı — üçüncü taraf CA hâlâ şart.

Onion DV süreci, adresin kontrolünü kanıtlamana dayar (CA'nın onion servis
üzerinden erişip doğruladığı kanıt dosyası yöntemi — güncel adımları CA'nın
kendi sürecinden al; süreç sürümler arasında değişebiliyor). `hostname`
dosyasındaki adresi elinde tutuyor olman yeterli matriksin ana parçası.

### 5.2 Kurulum

torrc'yi https varyantına çevir (sanal port 443 — istemci
`https://<ONION_ADDR>/` bağlantısında TLS'i **nginx'e kadar** taşır; TLS
sonlandırma onion arkasındaki nginx'te yapılır):

```ini
HiddenServiceDir /var/lib/tor/postacim/
HiddenServicePort 443 127.0.0.1:8443
```

nginx onion vhost'u (TLS'li, yine yalnız 127.0.0.1):

```nginx
# postacim — Tor onion vhost (https yol)
# torrc: HiddenServicePort 443 → 127.0.0.1:8443; sertifika SAN'ı <ONION_ADDR>.
server {
    listen 127.0.0.1:8443 ssl;
    server_name <ONION_ADDR>;

    ssl_certificate     /etc/nginx/onion/fullchain.pem;   # HARICA DV veya DigiCert EV
    ssl_certificate_key /etc/nginx/onion/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;

    client_max_body_size 10m;
    access_log off;

    # location blokları §4 ile birebir aynı — yalnız her blokta
    # proxy_set_header X-Forwarded-Proto https;   # ← çerez Secure=true
}
```

```bash
mkdir -p /etc/nginx/onion && chmod 700 /etc/nginx/onion
# sertifikaları CA'den aldıktan sonra buraya koy
nginx -t && systemctl reload nginx
systemctl restart tor
```

`.env`: `LIVEKIT_URL=https://<ONION_ADDR>/livekit` (§6).

Tor Browser `https://<onion>` açtığında gerçek sertifika doğrulaması görür —
kilit yeşil, `Secure` çerezi işliyor.

## 6. `.env` — onion varyantı

```bash
# Tor onion varyantı:
LIVEKIT_URL=http://<ONION_ADDR>/livekit     # Yol 1 (http onion)
# LIVEKIT_URL=https://<ONION_ADDR>/livekit  # Yol 2 (https-onion, önerilen)
```

- `<ONION_ADDR>` — §2'de `hostname` dosyasından okunan adres. `.env`'de
  `https://<your-domain>/livekit` yerine bunu koy; geri kalan tüm ENV'ler
  (`LIVEKIT_API_KEY`, `SCREEN_SHARE`, `SESSION_TTL_DAYS`, ...) değişmez.
- Çerez/tls etkileşimi: http varyantta çerez `Secure=false` üretilir (§3 karar
  kutusu — `secure: proto === 'https'` otomatik uyar, kod değişikliği yok);
  https varyantta `Secure=true` kalır. İki varyantta da nginx'in
  `X-Forwarded-Proto` header'ı doğru gönderildiği sürece davranış doğrudur.
- `.env.example` içindeki "Tor onion varyantı" yorum bloğu da bu iki satırı
  taşır (bu rehberle aynı commit'te eklendi).

## 7. WebRTC / LiveKit — dürüst sınır

**Sesli/görüntülü arama onion üzerinden ÇALIŞMAZ.** Nedeni yapısal:

- LiveKit istemcisi önce `/livekit` üzerinden signaling yapar (WebSocket —
  onion'dan **geçer**, mesajlaşma WS'i gibi sorunsuz).
- Medya ise WebRTC ICE ile kurulur: tarayıcı, LiveKit'in duyurduğu
  candidate'lara (`node_ip: <VPS_IP>`, UDP 50000-50100, TURN 3478) **doğrudan
  UDP** bağlanır. WebRTC'nin UDP taşıması Tor SOCKS üzerinden akmaz:
  - **Tor Browser**: proxy dışına UDP çıkışına izin vermez; Safest güvenlik
    seviyesinde JS/WebRTC zaten kapalı. Arama bağlanmaz — IP sızdırır da.
  - **Normal tarayıcı + SOCKS proxy ayarı** (chrome `--proxy-server=socks5://...`
    gibi): WebRTC UDP trafiği proxy kuralına uymaz, **Tor dışına sızar** —
    istemcinin gerçek IP'si SFU'ya gider, anonimlik biter. Bu senaryo
    "çalışıyorsa bile gizlilik bozuktur".

İki dürüst çözüm:

- **(a) Kabul et** — mesajlaşma Tor'da tam çalışır; arama başlatıldığında medya
  doğrudan gider, tarafların IP'si çağrı esnasında birbirine ve SFU'ya görünür
  (Signal'in çağrı modeli de relay dışı yolda buna benzer bir metadata
  açığa sahiptir). Kullanıcıya bu durumu dürüstçe anlatan bir not UI'a eklenebilir
  (bu faz kapsamı dışı).
- **(b) Kapalı mod** — Tor dağıtımında medyayı tamamen kapat:
  - `SCREEN_SHARE=off` (mevcut kill switch — ekran paylaşımını token seviyesinde
    keser; **sesli aramayı kesmez**, ona ayrı bir env switch yok).
  - Aramayı **fiziksel** kesmek isteyen onion-only kurulumda medya portlarını
    dış dünyaya kapat: `ufw delete allow 7881/tcp`, `ufw delete allow 3478/udp`,
    `ufw delete allow 50000:50100/udp`. ICE candidate'lara hiç TCP/UDP
  bağlanamayan istemci aramayı kuramaz; mesajlaşma etkilenmez.

> Bu sınır README "Tehdit modeli ve bilinen sınırlar" listesine de yazıldı —
> Tor + arama kombinasyonunun gerçekte ne yaptığı oradan da okunabilir.

## 8. Signal kıyaslaması — Tor desteği

- **Signal'in resmî hattı Tor değil, TLS proxy.** Signal Help Center'da "tor"
  araması **sıfır sonuç** (Eylül 2026'da doğrulandı); engellenen ülkeler için
  önerilen resmî yol [Signal-TLS-Proxy](https://github.com/signalapp/Signal-TLS-Proxy):
  herkesin kendi VPS'inde `docker compose up --detach` ile kaldırdığı basit bir
  nginx-TLS aktarıcısı, `https://signal.tube/#<host>` linkiyle paylaşılır.
  Signal'in kendi ifadesiyle "all traffic remains opaque to the proxy operator" —
  proxy operatörü içerik göremez ama proxy, IP-gizleme değil sansür-aşma aracıdır
  ve Signal'in merkezi sunucuları metadata'yı görmeye devam eder.
- **Signal'in Tor'a resmî yolunu yok** — istemcilerde Tor SOCKS ayarı yok;
  Tor üzerinden kullanım ancak Orbot gibi VPN-modu sarmalayıcılarla
  (üçüncü taraf, resmî olmayan) mümkün.
- **postacim'in farkı**: self-host + onion service birinci sınıf rehberde —
  sunucu IP'sini ifşa etmeyen bir erişim yolu ürünün kendisiyle gelir; ayrıca
  sunucu yalnız opak blob taşıdığı için Tor'un gizlediği IP-metadata'nın
  ötesinde sunucu tarafında da içerik metadata'sı yoktur. Karşılığında aynı
  WebRTC-UDP sınırı Signal'de de postacim'de de var: hiçbir WebRTC tabanlı
  arama Tor'dan geçmez (Signal'in aramaları da WebRTC'dir ve Tor SOCKS ile
  resmî olarak desteklenmez).

## 9. Ops notları

- **Rate-limit kovaları çöker (bilinçli bedel).** `clientIp` trustProxy ile
  nginx'in yazdığı XFF'yi okur; onion vhost'ta `X-Forwarded-For` = `127.0.0.1`
  olduğundan **tüm onion kullanıcıları tek kovaya düşer**: kayıt
  `REGISTER_RATE_PER_HOUR` (3) artık onion genelinde toplam 3/saat; giriş
  kademeli bloğunda birinin art arda hatalı girişleri herkesi kilitleyebilir.
  Tor'da gerçek IP bilinemediği için kova ayrımı yapısal olarak mümkün değil —
  onion-only kurulumda `REGISTER_RATE_PER_HOUR`'ı topluluğuna göre yükselt,
  `LOGIN_FAIL_FREE` varsayılanında bırak.
- **Log hijyeni** — onion vhost'ta `access_log off` (yukarıdaki conf'ta var):
  zaten `127.0.0.1` görür, tutmasın. Uygulama logu zaten IP/query düşmez
  (hardening testiyle sabit).
- **`HiddenServiceSingleHopMode`** — torrc'de `1` yapılırsa introduction +
  rendezvous tek hop'a iner, gecikme düşer; **anonimlik zayıflar** (zamanlama
  analizi, guard keşfi). Postacim hedefi anonimlik olduğu için **default
  (0, multi-hop) kalsın**. İleri sertleştirme isteyen: `vanguards` eklentisi
  (guard rotasyonu + discovery koruması) opsiyonel bakılabilir.
- **`Onion-Location` (opsiyonel)** — clearnet vhost'un da varsa (§5 ile paralel
  dağıtım), clearnet 443 bloğuna tek header ekleyip Tor Browser kullanıcılarına
  otomatik onion önerisi gösterebilirsin:
  `add_header Onion-Location https://<ONION_ADDR>$request_uri;`
  Tor Browser bu header'ı görünce kullanıcıya onion'a geçmeyi teklif eder —
  istemci tarafı kod değişikliği gerektirmez.
- **Onion-only kurulum** — postacim'i yalnız onion'dan sunmak isteyen:
  ufw'de 80/443'ü kapat (`ufw delete allow 80/tcp`, `ufw delete allow 443/tcp`),
  yalnız 22 (SSH) ve Tor'un **giden** trafiği açık kalır. LiveKit media
  portlarına da §7 (b) uygula — böylece sunucunun bir clearnet ayak izi
  (sertifika CT log'ları, DNS kayıtları dahil) oluşmaz.
- **Yedekleme setine ekle** — `<REPO_DIR>/data/` + `.env` + sertifikaların
  yanına `/var/lib/tor/postacim/` (§2 🔴 ders).

## 10. Doğrulama

```bash
# Tor SOCKS üzerinden API (adresi hostname'den oku)
ONION=$(cat /var/lib/tor/postacim/hostname)
curl -s --socks5-hostname 127.0.0.1:9050 http://$ONION/api/health
# {"ok":true}                                  (Yol 1)
curl -s --socks5-hostname 127.0.0.1:9050 https://$ONION/api/health
# {"ok":true}                                  (Yol 2 — sertifika geçerli, -k YOK)

# signaling validate (geçerli token gerek — 401 beklenir)
curl -sI --socks5-hostname 127.0.0.1:9050 http://$ONION/livekit/rtc/v1/validate
# HTTP/1.1 401

# onion vhost yalnız 127.0.0.1'de mi
ss -tlnp | grep -E '8081|8443'
# 127.0.0.1:8081 / 127.0.0.1:8443 — 0.0.0.0 GÖRÜNMEMELİ

# Tor service log
journalctl -u tor -n 20 --no-pager
```

**Tor Browser smoke test** (mesajlaşma hattı):

1. Tor Browser → `http://<ONION_ADDR>/` (veya `https://` Yol 2'de).
2. Kayıt ol (nick + şifre, BIP-39 ritüeli) — başarılı olmalı.
3. İki farklı Tor Browser oturumuyla topluluk kur, üye ekle, mesaj yaz —
   E2EE akış onion üzerinde çalışmalı.
4. `curl` tarafında `--socks5-hostname` kullan (düz `--socks5` DEĞİL: o,
   onion DNS'ini proxy'e sormaz ve adres çözülemez).
5. Sesli oda: §7'deki sınır — bağlanmayacaktır (beklenen davranış).

## 11. Sorun giderme

| Belirti | Olası sebep | Bak |
|---|---|---|
| `hostname` dosyası oluşmuyor | `HiddenServiceDir` yazma izni yok | `ls -la /var/lib/tor/postacim`, `systemctl restart tor` sonrası `journalctl -u tor` |
| Tor Browser "Unable to find the requested site" | torrc dizimi hatası veya nginx vhost ayakta değil | `journalctl -u tor -n 30`; `ss -tlnp \| grep 8081` |
| `curl --socks5` çözümleme hatası | `--socks5` kullanılmış (DNS proxy dışında) | `--socks5-hostname` ile dene (§10 notu) |
| Sayfa açılıyor, giriş sonrası çerez yok | `X-Forwarded-Proto` header'ı vhost'ta eksik/yanlış | §4 conf'la satır satır karşılaştır; `secure: proto === 'https'` (auth.ts) |
| WS bağlanmıyor (mesajlar gelmiyor) | `/ws` bloğunda `Upgrade`/`Connection` header'ları eksik | nginx vhost'taki `/ws` bloğu; `nginx -t` |
| 502 /api/health | server container kapalı | `docker compose ps`, `docker logs postacim-server-1` |
| Sertifika hatası (Yol 2) | SAN `<ONION_ADDR>` değil, veya sanal port 443 değil | sertifika SAN'ını kontrol et; torrc `HiddenServicePort 443 127.0.0.1:8443` |
| Arama bağlanmıyor | §7'deki yapısal sınır — hata değil | Tor Browser'da aramayı kullanma; (a)/(b) kararını uygula |
| Herkes "too many attempts" | onion'da tek rate-limit kovası (127.0.0.1) | §9 ilk madde; `REGISTER_RATE_PER_HOUR` yükselt |

## 12. Onion kurulum checklist

- [ ] `tor` kurulu, `systemctl enable --now tor`, `tor --version` ≥ 0.4.8
- [ ] torrc: `HiddenServiceDir /var/lib/tor/postacim/` + `HiddenServicePort` (80→8081 veya 443→8443)
- [ ] `/var/lib/tor/postacim/` yedeği alındı (hs_ed25519_secret_key + hostname)
- [ ] nginx onion vhost: `listen 127.0.0.1:8081|8443` — `ss -tlnp` ile 127.0.0.1 teyit
- [ ] `access_log off` + `X-Forwarded-For $remote_addr` + doğru `X-Forwarded-Proto`
- [ ] `.env`: `LIVEKIT_URL=http(s)://<ONION_ADDR>/livekit` — localhost/clearnet DEĞİL
- [ ] Yol seçildi ve biliniyor: http onion = çerez `Secure=false` (§3 karar kutusu), https-onion = `Secure=true`
- [ ] `curl --socks5-hostname 127.0.0.1:9050 .../api/health` → `{"ok":true}`
- [ ] Tor Browser smoke test: kayıt + iki profil mesajlaşması
- [ ] §7 kararı verildi: arama (a) doğrudan kabul, (b) kapalı mod (SCREEN_SHARE=off + medya portları kapalı)
- [ ] Rate-limit bedeli okundu, `REGISTER_RATE_PER_HOUR` onion kitlesine göre ayarlandı

---

## Değişiklik geçmişi

- **2026-09-16**: İlk sürüm. SECURITY-ROADMAP.md Faz 3 kapsamında: v3 onion
  kurulumu, http vs https-onion kıyası (https önerilen), WebRTC/Tor dürüst
  sınırı, Signal Tor-desteği kıyası, rate-limit kova çökmesi notu.
