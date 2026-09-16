# Networking — STUN, TURN, ICE, RTP, SFU

> Bu doküman postacim'in uçtan uca ses/görüntü (voice/video) trafiğinin **nasıl
> kurulduğunu, sunucuya neyin ne kadar göründüğünü** anlatır. Gizlilik
> tehdidini ve bizim bu tehdit karşısındaki duruşumuzu yazının sonunda
> topladım.

postacim voice katmanı: tarayıcı ↔ **LiveKit SFU** (Go, single binary, kendi
makinemizde). Ses ve görüntü **uçtan uca şifreli** (SFrame + E2EE Key
Provider) — server yalnızca opak paketleri iletir. Metin aynı mimaride değil
(HTTP + WebSocket üzerinden, server mesajın içeriğini **göremez**, sadece
yönlendirir; detay için `ARCHITECTURE.md`).

---

## 1. Kısa özet — 5 cümlede her şey

1. İki tarayıcı aynı NAT arkasında bile olsa birbirini **direkt** bulamaz.
   ICE denen protokol, yardımcı sunucularla (STUN) "benim dış IP'm şu"
   öğrenir, sonra **kendi kendine** iki tarafı bağlamaya çalışır.
2. STUN çalışmazsa (sıkı NAT, firewall), **TURN** devreye girer: her şey
   relay sunucudan geçer. TURN gören kişi, sesin/görüntünün **şifresiz
   hâlini** görebilir — ama biz E2EE açtığımız için sadece opak paket
   görür.
3. Biz **SFU** (Selective Forwarding Unit) kullanıyoruz. Yani 50 kişilik
   odada 50 kişi birbirine 1225 ayrı bağlantı kurmuyor; herkes SFU'ya
   bağlanır, SFU seçici olarak paketleri kopyalar. Sesin içeriğini
   çözmez, sadece iletir.
4. UDP paketleri 50000-50100 port aralığından geçer (LiveKit config).
5. TLS sadece **signaling** (kim kime ne gönderiyorum, hangi odada) içindir;
   media (RTP paketleri) kendi SRTP/DTLS kanalıyla şifrelenir, üzerine
   biz SFrame E2EE ekliyoruz.

---

## 2. Sorun: iki tarayıcı birbirini nasıl bulur?

NAT arkasındaki iki cihaz, birbirinin **dış IP'sini ve portunu** bilmez.
Aynı evde iki telefon bile farklı router'lar arkasında, birbirini
**göremez**. Çözüm: üçüncü bir tarafın yardımı.

### Terminoloji tablosu

| Terim | Ne | Nerede yaşar |
|---|---|---|
| **ICE** | Bütün bu işin çatısı: "şu adayları dene, çalışanı seç" | Her iki uçta |
| **STUN** | "Benim dış IP'm ne?" sorusunu cevaplayan sunucu | Dışarıda (Google, Cloudflare ücretsiz sunar) |
| **TURN** | STUN başarısızsa, paketleri üzerinden röle eden sunucu | Dışarıda (veya bizde) |
| **SDP** | "Ben Opus ses, VP8 video, şu codec'leri destekliyorum" içeren sözleşme | Signaling'de değiş tokuş edilir |
| **RTP** | Asıl media paketlerinin taşındığı protokol (UDP üstü) | Uçtan uca (bizde SFU üzerinden) |
| **SRTP** | RTP'nin şifreli versiyonu (DTLS ile anahtar değişimi) | Uçtan uca |
| **SFU** | Selective Forwarding Unit — herkese ayrı ayrı bağlantı kurmak yerine merkezî röle | Bizde (LiveKit) |

---

## 3. ICE — Interactive Connectivity Establishment

ICE, RFC 8445. Akış:

1. Her iki taraf **kendi adreslerini** toplar: yerel IP, yerel NAT IP,
   STUN'dan öğrenilen dış IP, TURN'den öğrenilen relay IP. Bunlara
   **ICE candidate** denir.
2. Karşı tarafa SDP üzerinden kendi adaylarını gönderir (signaling).
3. Her iki taraf, diğerinin **tüm adaylarını** sırayla dener
   (connectivity check). İlk çalışan bağlantıyı seçer.
4. STUN üzerinden NAT tipi öğrenilir: **full cone, restricted cone, port
   restricted, symmetric**. Son ikisi (özellikle symmetric) zordur — buralarda
   TURN gerekebilir.

**Neden önemli:** Bu süreç tamamen **uçlarda** biter. ICE server'ı (STUN/TURN
sunucusu) bağlantı kurulduktan sonra **devre dışı**. Meta veri bile
saklamaz. Biz sadece STUN/TURN adresi veririz, gerisini tarayıcı yapar.

---

## 4. STUN — Session Traversal Utilities for NAT

Çok basit bir protokol: "Bana dış IP'mi söyle."

```
Client → STUN server: "Ben 192.168.1.5'ten, 12345 portundan bağlandım"
STUN server → Client: "Dış IP'n 85.123.45.67, dış portun 51234"
```

STUN sunucu **kayıt tutmaz**, sadece echo yapar. Açık metin UDP, birkaç
byte. Trafik: handshake sırasında birkaç paket, sonra sıfır.

**postacim'de:** LiveKit config'te `use_external_ip: false` — bizim
sunucumuz dış IP'mizi zaten biliyor, kendine STUN atar. Dış STUN da
gerekmiyor. Bu yüzden prod'da `turn.enabled: true` ile birlikte sadece
TURN açık (veya tamamen kapalı, deploy'a göre).

**Gizlilik:** STUN gören biri, **"X kişisi, Y saatinde, benim sunucuma
bağlandı"** bilir. IP ve zaman damgası metadata. Sesin/görüntünün
içeriğine erişemez. Ücretsiz public STUN (Google `stun.l.google.com`)
operatörü bu metadata'yı görür — bizim sunucumuz değil.

---

## 5. TURN — Traversal Using Relays around NAT

STUN başarısız olduğunda (sıkı NAT, kurumsal firewall, UDP engellenen
ağlar), TURN devreye girer. Paketler **TURN sunucusu üzerinden
röle** edilir. Yani A → TURN → B, üçlü bir bağlantı.

**Bedeli:** TURN sunucusu tüm RTP paketlerini **görür**. Şifrelemezseniz
sesin düz hâlini işitebilir, görüntüyü görebilir.

**postacim'de:** TURN aktifse (config: `turn.enabled: true`),
kendi makinemizdeki embedded TURN. Tüm trafiği kendi sunucumuzdan
geçirdiğimiz için:

- TURN operatörü = **biz** (ağ yöneticisi olarak görür, içerik göremez
  çünkü E2EE).
- Eğer E2EE kapalıysa, TURN sesin/görüntünün **şifresiz hâlini** görür.
  Bu, gizlilik vaadimizi kırar. Aşağıda "E2EE neden kritik" bölümü.

**TURN trafiği:** Aynı sesin 2x maliyeti (uplink + downlink, ikisi de
relay). 50 kişilik odada ortalama uplink 50 kbps ise TURN 50 Mbps
kullanır (tüm aboneler). Bant yetmezse TURN kullanıcıları kesilir —
bu yüzden TURN'de kota + rate limit önemli.

---

## 6. ICE akışı — örnek bir bağlantı

Senaryo: Ali 4G'de (CGNAT arkasında), Ayşe ev WiFi'sinde (port
restricted NAT). İkisi de aynı ses odasına girmek istiyor.

```
1. Ali → STUN: "dış IP'm ne?"
   STUN → Ali: "85.1.2.3:51234"
   Ali kendi SDP'sine bu adayı ekler.

2. Ayşe → STUN: "dış IP'm ne?"
   STUN → Ayşe: "78.4.5.6:41890"
   Ayşe kendi SDP'sine bu adayı ekler.

3. Signaling (WebSocket, server üzerinden):
   Ali → server: "Ali'nin adayları: [local, srflx=85.1.2.3:51234]"
   server → Ayşe: aynısı iletir
   Ayşe → server → Ali: "Ayşe'nin adayları: [local, srflx=78.4.5.6:41890]"

4. Ali ve Ayşe birbirinin tüm adaylarını dener:
   Ali → Ayşe (78.4.5.6:41890): STUN binding request
   → CGNAT'ı geçemedi, timeout.

5. ICE: "STUN başarısız, TURN adayı dene."
   Ali → TURN: "Bana bir relay adresi ver"
   TURN → Ali: "TURN sunucusu üzerinden 88.9.10.11:55001"
   Ali → TURN: RTP paketleri buraya gönderir.
   TURN → Ayşe: aynı paketleri Ayşe'ye iletir.

6. Bağlantı kuruldu. Ali ve Ayşe SRTP üzerinden şifreli media
   alışverişi yapar. Üzerine bir de SFrame E2EE katmanı (bizim
   kattığımız).
```

---

## 7. RTP / SRTP — media taşıma

RTP (Real-time Transport Protocol) ses ve video paketlerinin formatı.
Her paket ~200 byte civarı (ses için), içinde:

- sequence number (sıralama, kayıp tespiti)
- timestamp (senkronizasyon, jitter buffer)
- payload type (Opus, VP8, vb.)
- **payload** (şifrelenmemiş ses/video bytes)

**SRTP** = RTP + AES-128/256 şifreleme. DTLS (TLS'in UDP muadili) ile
anahtar değişimi yapılır. STUN'un şifreli kuzeni gibi düşün.

**postacim'de iki katman var:**

1. **SRTP/DTLS** (RFC 3711 + 5764) — standart. SRTP anahtarı
   signaling sırasında DTLS-SRTP ile müzakere edilir. **Server bu
   anahtarı bilmez** (DTLS-SRTP uçtan uca).
2. **SFrame E2EE** (bizim eklediğimiz) — SRTP payload'unu **bir
   kat daha** şifreler. Şifreleme anahtarı odadaki **her kullanıcının
   ortak anahtarı** ile müzakere edilir (`@livekit/e2ee` paketi,
   libsodium tabanlı, `web/src/state/voiceStore.ts`). Server bu
   anahtarı **asla görmez**.

Neden iki katman? SRTP anahtarı müzakere edilirken signaling server
aracılığıyla geçer — server o anda anahtarı görebilir (ama
kullanmaz). SFrame, **anahtarı sunucudan tamamen geçirmez**;
her client anahtar parçalarını diğerlerinin **public key'iyle
şifreleyerek** dağıtır. Bu yüzden "zero knowledge" iddiası SFrame
olmadan **tam değil**.

---

## 8. SFU — Selective Forwarding Unit (neden P2P değil)

P2P (mesh) yapı: 4 kişilik ses odasında herkes birbirine bağlanır.
6 bağlantı, sorun yok. **50 kişilik odada** 50×49/2 = 1225 bağlantı.
Her biri kendi uplink'ini 49 kişiye gönderir. Mobilde pil biter,
bant biter, CPU biter.

**SFU**: Herkes SFU'ya 1 uplink, SFU herkese gerektiği kadar downlink.
50 kişilik odada toplam bağlantı 50 (uplink) + 50×49 (downlink) =
2500 stream, ama bunlar SFU'nun içinde, kullanıcı için değil.
Kullanıcı 1 uplink + N downlink (N = odadaki kişi sayısı).

**postacim'de** LiveKit SFU kullanıyoruz (`livekit/livekit-server:v1.13.1`).
LiveKit'in Adaptive Stream özelliği: SFU her abone için **en uygun
katmanı** seçer. Küçük PiP penceresi 180p, büyük ana ekran 720p alır.
Bant tasarrufu inanılmaz.

**E2EE ile SFU çelişir mi?** Hayır. SFU, payload'u **göremez** çünkü
şifreli. Tek görevi "bu paketi 49 kişiye kopyala" — paketin içine
bakmaz. SFrame bu yüzden tasarlandı: SFU "şifreleme-agnostik" çalışır.

**Eski okul SFU'lar** (Jitsi Videobridge öncesi) sunucu tarafı
transcoding yapardı — yani sesin **düz hâlini** görürdü. Modern
SFU'lar (LiveKit, mediasoup, Janus) passthrough. Passthrough = E2EE
ile uyumlu. Transcoding = E2EE'yi kırar.

---

## 9. Server ne görüyor, ne görmüyor?

### Server GÖRÜR

- Kim (user ID) hangi odaya (room ID) katıldı
- Katılma/ayrılma zaman damgası
- ICE bağlantı kuruldu mu, kaç aday denendi
- Bant kullanımı (track başına uplink/downlink bitrate)
- Hangi codec (Opus, VP8) — metadata

### Server GÖRMEZ

- Sesin düz hâli (Opus payload şifreli)
- Görüntünün düz hâli (VP8/VP9/H.264 frame'leri şifreli)
- Mesaj içeriği (mesajlar client tarafında şifrelenmiş, server
  yalnızca yönlendirir, `ARCHITECTURE.md`)

### Eğer E2EE kapalı olsaydı server GÖRÜRDÜ

- Sesin Opus payload'unu (plain PCM'ye decode edebilir, dinleyebilir)
- Görüntünün frame'lerini (decode, kaydedebilir)
- Yazılan her mesajı (zaten bu yok, çünkü mesaj E2EE her durumda)

**Bu yüzden SFrame E2EE kritik.** SRTP tek başına yetmez; signaling
server'ı SRTP anahtarını görebilir, kayıt yapabilir.

---

## 10. postacim konfigürasyonu — `livekit/livekit.yaml`

**Gerçek yapılandırma (prod, 2 vCPU / 3 GB RAM hedefi):**

```yaml
port: 7880                    # signaling (HTTPS + WSS)
prometheus_port: 6789         # localhost-only metrik
log_level: warn               # üretim: info/debug değil, uyarı/hata yeter
rtc:
  tcp_port: 7881              # ICE TCP fallback
  port_range_start: 50000     # RTP/RTCP UDP port aralığı
  port_range_end: 50100       # 101 port → max ~50 eşzamanlı yayın
  use_external_ip: true       # public deploy için ICE candidate'larında VPS IP'si duyurulur
  node_ip: <VPS_IP>           # ← VPS'in dış IP'si (ör: 203.0.113.10)
turn:
  enabled: true               # NAT'lı kullanıcılar için embedded TURN
  udp_port: 3478
```

**Sıralama: önce server (maxParticipants 12) → LiveKit (RTC config) → client (publishDefaults).**

### 10.1 Server tarafı sınırlar (token grants)

`server/src/livekit.ts` `mintVoiceToken` her kullanıcıya şu sınırları koyar:

```typescript
at.roomConfig = new RoomConfiguration({
  maxParticipants: 12,     // 2 vCPU/3 GB hedefi: 12×11=132 stream sınır
  emptyTimeout: 300,       // boşalan oda 5 dk sonra kapanır
});
at.addGrant({
  roomJoin: true,
  canPublish: true,
  canSubscribe: true,
  canPublishSources: [TrackSource.CAMERA, TrackSource.MICROPHONE],  // SCREEN_SHARE=off
});
```

**12 nasıl hesaplandı:** 12×11=132 downtrack = 2 vCPU SFU'nun rahat çalışma
tavanı. 25 kişilik oda 600 stream ederdi → CPU tavanı aşılır, LiveKit
join'i reddeder (4xx — UI toast'a düşer).

### 10.2 LiveKit v1.x'te olmayan alanlar

LiveKit server image `v1.13.1` (ve v1.x ailesi) şu alanları **kabul etmez**:

- `rtc.publisher_max_bitrate` — v2.x'te eklendi
- `rtc.simulcast_layers` — v2.x'te eklendi

Bu sınırlar **client tarafında** uygulanır (`web/src/state/voiceStore.ts`):

```typescript
const room = new Room({
  adaptiveStream: true, dynacast: true, encryption: { keyProvider, worker },
  publishDefaults: {
    videoEncoding: { maxBitrate: 1_500_000 },       // 1.5 Mbps uplink cap
    screenShareEncoding: { maxBitrate: 1_500_000 },
  },
});
```

`adaptiveStream` + `dynacast` zaten simulcast'in işini yapar (viewport'taki
tile yüksek çözünürlük alır, görünmeyen düşük; Dynacast unused layer'ları
kapatır). **Server'da tanımlamaya gerek yok, client otomatik yapıyor.**

> Client tarafı cap manipüle edilebilir ama gizlilik için sorun değil —
> SFrame zaten içeriği şifreli, sadece SFU CPU'su için sınır.

### 10.3 Neden 50000-50100 = 101 port?

Her yayın (audio + video track = birden fazla RTP stream) bir UDP port
çifti kullanır (RTP + RTCP). 101 port = pratikte ~50 eşzamanlı
yayıncı. Daha fazlası için `port_range_end: 50300` yap. UDP port
havuzu = aynı anda kaç kişi **yayın** yapabilir (alıcılar paylaşır).

### 10.4 Neden `use_external_ip: true + node_ip`?

`use_external_ip: true` olmadan LiveKit kendini `0.0.0.0`'da başlatır ve
logda `rtc.portICERange: [50000, 50100]` görünür ama gerçekte portlar
**ihtiyaç oldukça dinamik bind** olur. External IP set edilince ilk peer
geldiğinde 50000-50100/udp otomatik açılır ve STUN doğru cevap verir.

> `node_ip` placeholder olarak repo'da duruyor, prod'da **gerçek VPS
> IP'si** ile değiştirilmeli (deploy/nginx-postacim.conf ve
> `vps-fresh-install.md` §3'e bak).

### 10.5 Neden TURN açık?

Aynı şehirde bile, bazı ISP'ler (özellikle Türkiye'de bazı mobil
operatörler) **UDP'yi engelliyor** veya kısıtlıyor. STUN başarısız
olunca TURN tek çare. TURN açık olması **gizliliği bozmaz** çünkü
E2EE var. TURN açık olmaması **erişilebilirliği bozar** çünkü bazı
kullanıcılar bağlanamaz.

### 10.6 Performans: CPU pinning

`docker-compose.yml`:

```yaml
services:
  livekit:
    cpuset: "0"      # tam core 0
  server:
    cpuset: "1"      # tam core 1
```

Linux context switch + cache miss sıfırlanır, %15-25 throughput artışı
(bedava). Web (nginx:alpine) hafif, paylaşımlı kalabilir.

### 10.7 Performans: log seviyesi + broadcast tick

- `LOG_LEVEL=warn` (`.env` + `server/src/index.ts`) — JSON serialize + I/O %5-10 azalır
- `server/src/ws/hub.ts` broadcast tick (16 ms pencerede toplama + dedup) — 50 kişilik
  odada 2500 mesaj/sn yerine 50×16ms = 800 broadcast/sn
- Netdata **prod'da kapalı** (`profiles: [monitoring]`), ~50-100 MB RAM kurtarır;
  geliştirme için `docker compose --profile monitoring up -d`

---

## 11. Gizlilik tehdidi modeli

### Saldırı yüzeyleri

| Saldırgan | Ne yapabilir | Karşı önlem |
|---|---|---|
| Ağ dinleyici (ISP, WiFi operatörü) | "Bu IP LiveKit'e bağlandı" görür, IP+saat metadata. İçeriği göremez. | Tor/VPN kullanıcı tarafı. |
| LiveKit sunucu operatörü (biz) | ICE başarı/hata metadata, oda katılım logu, bant istatistiği. İçerik göremez (E2EE). | Log retention kısa tutulmalı (örn. 24 saat). `LOG_LEVEL=warn`. |
| TURN operatörü (biz, embedded) | Relay edilen paketlerin **şifreli** kopyasını görür. Meta veri + IP görür. | Kendi makinemiz = gözümüzün önünde. TÜFEK başkasına verilmiyor. |
| Google STUN (biz kullanmıyoruz) | — | — |
| Signaling server (bizim Node) | SDP, oda/kanal ID, katılım. Mesaj içeriği göremez. | E2EE + kısa log retention. |

### "Server göremiyor" ne kadar gerçek?

- **SRTP**: Server SRTP anahtarını **göremez** (DTLS uçtan uca).
  Doğru.
- **SFrame E2EE**: Server SFrame anahtarını **göremez** (her client
  diğerlerinin public key'iyle şifreler, server taşıyıcı). Doğru.
- **Ama**: Server **hangi client'ın hangi public key'i** kullandığını
  görebilir. Yani "Ali Ayşe ile konuşuyor" bilgisi signaling'den
  sızar. Bu metadata. İçerik değil.
- **Eğer TURN kullanılırsa**: TURN server hangi client'ın hangi
  odaya hangi IP'den bağlandığını görür. Yine metadata. İçerik değil.

### "Zero knowledge" iddiası

postacim'in "sunucu göremez" iddiası şu koşulla geçerli:

- ✅ Mesaj içeriği (her durumda, çünkü mesaj E2EE server'dan bağımsız)
- ✅ Ses içeriği (SFrame E2EE açıksa)
- ✅ Görüntü içeriği (SFrame E2EE açıksa)
- ⚠️ Kimin kiminle konuştuğu (metadata — bu sızıntı kaçınılmaz,
  çünkü signaling gerekli)
- ⚠️ IP adresleri, oturum süresi (metadata — Tor/VPN ile kullanıcı
  tarafında gizlenebilir)

**Dürüst ifade:** "İçeriği göremeyiz, kim kiminle konuşuyor
görebiliriz" — ve bu görmememizi sağlayacak bir mimari yok (şu anki
bilinen kriptolojide). Kullanıcıyı uyarıyoruz (`PRIVACY.md`).

---

## 12. Bilgiyi nerede nasıl tutuyoruz?

### Signaling server (Node/Fastify, port 4000)

- `users` tablosu: nick, public key, oluşturulma zamanı
- `sessions`: cookie session, TTL 30 gün (`SESSION_TTL_DAYS`)
- `messages`: şifreli blob (server decode edemez)
- `voice_tokens`: LiveKit için JWT, kısa ömürlü
- Oda/kanal bilgisi (herkese açık, zaten)

Tutulmayan: IP, user-agent, join/leave zamanı (sadece anlık
broadcast için, log'a yazılmaz).

### LiveKit SFU

- Oda/katılımcı bilgisi (signaling'den gelir)
- Track istatistiği (Prometheus, port 6789 — **localhost only**)
- Media: **asla diske yazılmaz**. Sadece RAM'de röle edilir.

### Log retention

- `LOG_LEVEL=warn` öneriliriz
- Netdata `127.0.0.1:19999` — dışarıya **asla** açılmaz
- 30 gün sonra session expiry, kullanıcı yeniden login olmalı

---

## 13. Özet tablosu

| Bileşen | Görev | Şifreleme | Server görür mü? |
|---|---|---|---|
| STUN | Dış IP öğren | Yok (kısa, metadata) | Sadece IP+saat |
| TURN | Paket röle | SFrame E2EE geçerli | Şifreli blob + metadata |
| ICE | Bağlantı kur | STUN üzerinden | Aday listesi (metadata) |
| SRTP/DTLS | Media şifrele | DTLS anahtar müzakere | Anahtar göremez |
| SFrame E2EE | İçerik şifrele | Public key tabanlı | Anahtar göremez |
| SFU | Paket kopyala | Passthrough (içine bakmaz) | Sadece yön + bant |

---

## 14. SSS

**STUN'ı neden biz çalıştırmıyoruz?**

Google'un public STUN'u yeterli ve bedava. STUN state tutmaz,
yükümüz yok. Embedded TURN bizim sunucuda çalışıyor, bu yeterli
relay ihtiyacını karşılıyor.

**TURN neden açık? Gizliliği bozmaz mı?**

Boş hayır, çünkü E2EE var. TURN şifreli paket görür, içeriği
göremez. TURN kapalı olsaydı bazı NAT'lı kullanıcılar hiç
bağlanamazdı (UDP engellenen ağlar, CGNAT). Erişilebilirlik >
sıfır metadata (TURN zaten bizim sunucuda, dışarıya vermiyoruz).

**P2P (mesh) kullansak daha mı gizli olur?**

Hayır. P2P'de herkes birbirinin **gerçek IP'sini** görür. SFU'da
herkes sadece sunucunun IP'sini görür, diğer katılımcıların
IP'lerini SFU gizler (single egress IP). P2P daha fazla metadata
sızdırır.

**Adaptive Stream (Dynacast) E2EE'yi bozar mı?**

Hayır. Server frame'in **şifreli** halde hangi katmanını (180p /
360p / 720p) aboneye göndereceğini seçer. Frame'in içeriğine
bakmaz. Kullanıcı 720p istediyse sunucu 720p katmanı yollar; tüm
katmanlar aynı anahtarla şifrelenmiş, server seçim yapabilir
çünkü seçim **şifreleme-agnostik**.

**Birisi LiveKit sunucumuzu hacklerse sesleri dinleyebilir mi?**

Hayır, **E2EE açıksa**. Hackleyen kişi SFU'nun belleğindeki
şifreli RTP paketlerini görür. Decrypt edemez çünkü anahtarlar
client'larda. **Ama**: kim kiminle konuşuyor, ne kadar süre, hangi
IP'lerden — bunları görebilir. Metadata sızıntısı kaçınılmaz.

**Server-side recording (SSR) açabilir miyiz?**

LiveKit destekliyor. **Açmayacağız.** SSR E2EE ile çelişir — server
kayıt yapabilmesi için frame'leri decrypt edebilmeli, o zaman
E2EE bozulur. Hiçbir koşulda açılmayacak (`ARCHITECTURE.md` içinde
karar kayıtlı).

---

## 15. Referanslar

- RFC 5245 / 8445 — ICE
- RFC 5389 / 8489 — STUN
- RFC 5766 / 8656 — TURN
- RFC 3711 — SRTP
- RFC 5764 — DTLS-SRTP
- W3C WebRTC spec
- IETF SFrame draft (`draft-ietf-mls-sframe`)
- LiveKit docs: https://docs.livekit.io
- mediasoup + Janus SFU'lar (alternatif, biz kullanmıyoruz)

---

*Bu doküman postacim geliştiricisi için teknik referans. Gizlilik
politikası kamuya `PRIVACY.md` ve `PRIVACY.en.md` üzerinden
duyurulur — bu dosya sadece geliştirici içindir.*
