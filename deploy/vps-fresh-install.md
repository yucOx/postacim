# VPS'te sıfırdan postacim kurulumu — gerçek ortam rehberi

> Bu doküman sıfırdan bir Ubuntu 24.04 VPS'te postacim'i ayağa kaldırırken
> karşılaşılan gerçek hataları, çözümlerini ve "bir daha yapma" listesini içerir.
> Tünel/WireGuard yok — her şey tek makinede çalışır.
>
> Tüm `<PLACEHOLDER>` değerlerini kendi ortamına göre değiştir:
>
> | Placeholder | Açıklama | Örnek |
> |---|---|---|
> | `<VPS_IP>` | VPS'in dış IPv4 adresi | `203.0.113.10` |
> | `<VPS_IPv6>` | (opsiyonel) IPv6 | `2001:db8::1` |
> | `<DOMAIN>` | postacim için alan adı | `postacim.example.com` |
> | `<REPO_DIR>` | Repo klonlanan dizin | `/opt/postacim` |
> | `<LE_EMAIL>` | Let's Encrypt hesap e-postası | `admin@example.com` |
> | `<LE_ACCOUNT_ID>` | (opsiyonel) Mevcut LE hesap ID | `a1b2c3d4e5f6...` |
> | `<SSH_USER>` | VPS'e giriş kullanıcısı | `deploy` |

## 0. Bu rehberden önce bilmen gereken

Postacim stack'i dört bileşenden oluşur:

- **server** (Node 22 / Fastify) — API + WebSocket, port 4000
- **web** (nginx:alpine + Vite build) — SPA, port 8080 (host nginx'in arkasında)
- **livekit** (Go, host network) — WebRTC SFU, port 7880 (HTTP) + 7881 (TCP ICE) + 50000-50100/udp (UDP ICE) + 3478/udp (TURN)
- **netdata** (Docker) — sistem izleme, port 19999 (yalnız 127.0.0.1)

**Akış:**

```
client (browser) ──HTTPS──> Cloudflare (proxy ON)
                                 │
                                 ▼
                          VPS:443 (host nginx)
                            ├─ /api, /ws ──────────> server:4000
                            ├─ /livekit/* ──────────> livekit:7880
                            └─ /* (statik SPA) ────> web:8080
                                                        │
                                                        └─ /livekit/* ──> livekit:7880
```

## 1. Docker kurulumu

```bash
apt-get update -qq
apt-get install -y ca-certificates curl gnupg
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
chmod a+r /etc/apt/keyrings/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" > /etc/apt/sources.list.d/docker.list
apt-get update -qq
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
systemctl enable --now docker
docker --version && docker compose version
```

**Not:** Kernel upgrade bildirimi çıkabilir; önemsiz, Docker çalışır.

## 2. Repo ve ortam

```bash
cd <REPO_DIR>

# LiveKit key'leri üret — DEVKEY / varsayılan secret'ları ASLA kullanma
LK_KEY=$(docker run --rm livekit/livekit-server:v1.13.1 generate-keys)
# çıktı: "API Key: APIxxx\nAPI Secret: ..."

# .env
cat > .env <<EOF
LIVEKIT_URL=https://<DOMAIN>/livekit
LIVEKIT_API_KEY=<yukarıdaki key>
LIVEKIT_SECRET=<yukarıdaki secret>
WEB_PORT=8080
WEB_HOST=127.0.0.1
SERVER_HOST=127.0.0.1
SCREEN_SHARE=on
SESSION_TTL_DAYS=30
REGISTER_RATE_PER_HOUR=3
EOF
chmod 600 .env
```

### 🔴 Ders — `LIVEKIT_URL` localhost kalırsa client kendine bağlanır

`.env.example` diyor ki default `http://localhost/livekit`. Bu **local geliştirme** için
doğru (server container LiveKit'e aynı makinede erişir), **AMA** server bu değeri
client'a gönderdiği için browser `ws://localhost/livekit/...` açar — kendi makinesine
bağlanmaya çalışır, sonuç `ERR_CONNECTION_REFUSED`.

**Production'da** daima: `LIVEKIT_URL=https://<DOMAIN>/livekit`

## 3. LiveKit: external IP ayarla

`livekit/livekit.yaml`:

```yaml
port: 7880
prometheus_port: 6789
rtc:
  tcp_port: 7881
  port_range_start: 50000
  port_range_end: 50100
  use_external_ip: true
  node_ip: <VPS_IP>            # ← KRİTİK
turn:
  enabled: true
  udp_port: 3478
```

### 🔴 Ders — `use_external_ip: false` bırakırsan 50000-50100/udp görünmez

`use_external_ip: false` iken LiveKit kendini `0.0.0.0`'da başlatır, logda
`rtc.portICERange: [50000, 50100]` görünür ama gerçekte portlar **ihtiyaç
oldukça dinamik bind** olur. **External IP set edince** ilk peer geldiğinde
50000-50100/udp otomatik açılır ve STUN doğru cevap verir.

### 🔴 Ders — yanlış YAML field adı: `external_ip` değil, `node_ip`

`rtc.external_ip` kabul edilmiyor, hata:
```
field external_ip not found in type config.RTCConfig
```
Doğrusu: `rtc.node_ip` (v1.13.1).

## 4. UFW: tüm gerekli portları aç

```bash
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 7881/tcp comment "LiveKit signaling (postacim)"
ufw allow 3478/udp comment "LiveKit TURN (postacim)"
ufw allow 50000:50100/udp comment "LiveKit ICE media (postacim)"
ufw reload
ufw status verbose
```

### 🔴 Ders — ufw'de 7881/3478/50000-50100 AÇILMAZSA medya çalışmaz

PREROUTING'te DNAT kuralın olsa bile, `default deny incoming` paketleri
INPUT zincirinde drop eder, nat'a girmeden ölür. Sayaç artmaz, dışarıdan
timeout alırsın ve sebebini bulmak saatler sürer.

İlk adım olarak **her zaman** tüm portları ufw'de aç, sonra test et.

## 5. Host nginx

`deploy/nginx-postacim.conf` sadece HTTP iskeletini içerir. **Production
için üzerine HTTPS + `/livekit` location ekleyerek** kullan:

```bash
cp deploy/nginx-postacim.conf /etc/nginx/sites-available/postacim
sed -i 's/server_name postacim.example.com;/server_name <DOMAIN>;/' /etc/nginx/sites-available/postacim
```

Sonra `/etc/nginx/sites-available/postacim` dosyasını aşağıdaki tam production
config ile değiştir (HTTP 80 → HTTPS 443, ACME challenge, /api, /ws,
/livekit, /):

```nginx
# HTTP (80): ACME hâriç tüm trafiği HTTPS'e yönlendir
server {
    listen 80;
    server_name <DOMAIN>;
    location /.well-known/acme-challenge/ { root /var/www/html; }
    location / { return 301 https://$host$request_uri; }
}

# HTTPS (443)
server {
    listen 443 ssl http2;
    server_name <DOMAIN>;

    ssl_certificate     /etc/letsencrypt/live/<DOMAIN>/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/<DOMAIN>/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;

    client_max_body_size 10m;

    # API
    location /api/ {
        proxy_pass http://127.0.0.1:4000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # WebSocket
    location /ws {
        proxy_pass http://127.0.0.1:4000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 1h;
        proxy_send_timeout 1h;
    }

    # /livekit → doğrudan VPS'te host network'te çalışan LiveKit SFU
    location /livekit/ {
        proxy_pass http://127.0.0.1:7880/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_read_timeout 1h;
        proxy_send_timeout 1h;
    }

    # statik (SPA) → docker web
    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 1h;
        proxy_send_timeout 1h;
    }
}
```

```bash
ln -s /etc/nginx/sites-available/postacim /etc/nginx/sites-enabled/postacim
nginx -t && systemctl reload nginx
```

### 🔴 Ders 1 — `deploy/nginx-postacim.conf` sadece HTTP, eksik

`deploy/nginx-postacim.conf` yalnızca port 80'i tanımlar. Production'da:
- HTTPS bloğu yok
- `/livekit` location yok (web container'a gönderiyor, bu da timeout yer)
- HTTP→HTTPS redirect yok

`deploy/nginx-postacim.conf` üzerine kurulmamalı, üstüne eklenmeli. Yukarıdaki
örnek tam production conf.

### 🔴 Ders 2 — web container `host.docker.internal:7880`'e erişemez

`docker-compose.yml`'de `web.extra_hosts: "host.docker.internal:host-gateway"`
var, `host-gateway` → compose network gateway (172.18.0.x). Ama web'den oraya
yapılan bağlantılar **timeout** alır. Sebebi: docker bridge MASQUERADE kuralı
paket source'unu değiştirir, LiveKit host network'ünde **loopback davranışı**
farklı, conntrack reverse nat yapamaz.

**Çözüm:** web'i bypass et, host nginx `/livekit`'i doğrudan 127.0.0.1:7880'e
proxy et (yukarıdaki config).

Alternatif (daha az temiz): `web` servisini `network_mode: host` yap, ama
o zaman web 80'i host nginx ile çakıştırır, port değiştirmek gerekir.

## 6. Sertifika — certbot

```bash
# 1) Cloudflare A kaydı → <DOMAIN> → <VPS_IP> → "DNS only" (gri bulut)
#    HTTP-01 challenge için gerekli, sertifika alındıktan sonra Proxied'e çevir
#    (birkaç dakika bekle: dig +short <DOMAIN> @1.1.1.1)

# 2) Mevcut Let's Encrypt hesabı kullan (VPS'te başka site için alınmışsa)
#    hesap ID'leri: /etc/letsencrypt/accounts/acme-v02.api.letsencrypt.org/directory/*/
#    altındaki dizin adıdır. Listele: ls /etc/letsencrypt/accounts/acme-v02.api.letsencrypt.org/directory/
ACCT_ID="<LE_ACCOUNT_ID>"   # kendi hesap ID'ni yaz, örn: "a1b2c3d4e5f6..."

certbot certonly --webroot -w /var/www/html -d <DOMAIN> \
    --non-interactive --agree-tos --email <LE_EMAIL> \
    --account $ACCT_ID
```

İlk kez sertifika alıyorsan hesap oluşturmak için:

```bash
certbot certonly --webroot -w /var/www/html -d <DOMAIN> \
    --non-interactive --agree-tos --email <LE_EMAIL>
```

### 🔴 Ders 3 — certbot hesap seçtirmek için prompt ister, --non-interactive yetmez

`certbot ... --non-interactive` çalışsa bile mevcut birden fazla LE hesabı
varsa "Please choose an account" promptu gelir, hata verir. **Çözüm:**
`--account <hesap_id>` ile explicit hesap ver.

Hesap ID: `/etc/letsencrypt/accounts/acme-v02.api.letsencrypt.org/directory/*/`
altındaki dizin adı.

### 🔴 Ders 4 — Cloudflare proxy AÇIK iken HTTP-01 challenge başarısız

CF proxy AÇIK (turuncu bulut) iken certbot `http://<DOMAIN>/.well-known/...`
adresine HTTP-01 challenge gönderir, ama CF proxy o isteği origin'e
iletmeyebilir (veya değiştirir). Çözüm: sertifika alırken **DNS only**
yap, sonra Proxied'e çevir.

Alternatif: DNS-01 challenge (certbot + CF DNS plugin + API token). Daha
karmaşık ama proxy'yi kapatmadan çalışır.

## 7. Container'ları ayağa kaldır

```bash
docker compose build         # birkaç dakika (node image + native modules)
docker compose up -d
docker compose ps
docker compose logs --tail=20 server
docker compose logs --tail=10 livekit
```

**Beklenen log:**

```
livekit-1 | INFO  livekit  starting LiveKit server {"portHttp": 7880, ..., "rtc.portICERange": [50000, 50100]}
server-1  | Server listening at http://127.0.0.1:4000
```

## 8. Cloudflare ayarları

- **DNS → <DOMAIN> → A → <VPS_IP> → Proxied** (turuncu)
- **SSL/TLS → Full (Strict)** (sertifika geçerli, "Full" yetersiz çünkü
  visitor ile CF arasında CF'in kendi sertifikası var; Strict, origin
  sertifikasını da doğrular)

Birkaç dakika bekle (DNS propagation), sonra §9'a geç.

## 9. Doğrulama

```bash
# /api/health
curl -s https://<DOMAIN>/api/health
# {"ok":true}

# /livekit HTTP signaling (geçerli token gerek, 400 beklenir)
curl -sI https://<DOMAIN>/livekit/rtc/v1/validate
# HTTP/2 401

# VPS local 7880
curl -s -m 3 -o /dev/null -w '127.0.0.1:7880 → %{http_code}\n' http://127.0.0.1:7880/
# 200

# 3478/udp STUN (TURN server)
python3 -c "
import socket, struct
msg = struct.pack('!HHI', 0x0001, 0, 0x2112A442) + b'\x00'*12
s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
s.settimeout(3)
s.sendto(msg, ('<VPS_IP>', 3478))
try:
    data, addr = s.recvfrom(4096)
    print(f'3478/udp cevap: {len(data)}B ✓')
except socket.timeout:
    print('3478/udp TIMEOUT')
"
# 3478/udp cevap: 40B ✓

# 7881/tcp (LiveKit TCP ICE — bağlantı kurulur, HTTP atarsan reset)
curl -s -m 3 -o /dev/null -w '<VPS_IP>:7881 → %{http_code}\n' http://<VPS_IP>:7881/
# 000 (connection reset — WebRTC için tasarlanmış, HTTP reddedilir, beklenen)
```

## 10. Hata ayıklama hızlı referans

| Belirti | Olası sebep | Bak |
|---|---|---|
| `ERR_CONNECTION_REFUSED` `ws://localhost/livekit` | `LIVEKIT_URL=http://localhost/livekit` (.env) | `LIVEKIT_URL=https://<DOMAIN>/livekit` yap, server restart |
| `504` /livekit signaling | web container `host.docker.internal:7880` timeout | host nginx'te `/livekit` location ekle (Ders 2) |
| `404` /livekit | `/livekit` location yok | host nginx conf'a ekle |
| `curl <VPS_IP>:7881` → 000 | LiveKit TCP bağlantı kuruyor ama HTTP reddediyor | **Bu normal** — WebRTC-only port |
| STUN 50000/udp timeout | `use_external_ip: false` + node_ip yok | livekit.yaml'da `use_external_ip: true, node_ip: <VPS_IP>` |
| STUN 3478/udp timeout | ufw'de 3478/udp kapalı, ya da turn.enabled=false | `ufw status`, livekit.yaml'da turn.enabled: true |
| /api/health 502 | server container ayakta değil | `docker compose ps`, `docker logs postacim-server-1` |
| /api/health 000 | ufw'de 80/443 kapalı | `ufw status` |
| CF proxy AÇIK iken 502 | SSL mode yanlış (Flexible seçili) | Cloudflare SSL/TLS → Full (Strict) |
| certbot "choose an account" | birden fazla LE hesabı | `--account <id>` ekle |
| HTTP-01 challenge başarısız | CF proxy AÇIK | CF'de DNS only yap, sertifika al, geri çevir |
| docker compose build → "no space" | disk dolu | `docker system prune -a` (DİKKAT: image'ları siler) |

## 11. Sıfırdan kurulum checklist

- [ ] Ubuntu 24.04 VPS, root erişim
- [ ] Domain DNS A kaydı VPS IP'sine (sertifika alırken DNS only)
- [ ] Docker + docker compose plugin kurulu
- [ ] Repo `<REPO_DIR>` altında
- [ ] `.env` dosyası, **güçlü** LiveKit key'leri (devkey YASAK)
- [ ] `LIVEKIT_URL=https://<DOMAIN>/livekit` (localhost DEĞİL)
- [ ] `livekit.yaml`: `use_external_ip: true, node_ip: <VPS_IP>`
- [ ] UFW: 22, 80, 443, 7881/tcp, 3478/udp, 50000:50100/udp AÇIK
- [ ] Host nginx: HTTPS + HTTP→HTTPS redirect + `/livekit` location
- [ ] `docker compose up -d` çalıştı, container'lar "Up (healthy)"
- [ ] certbot sertifika aldı, `nginx -t` OK
- [ ] CF A kaydı Proxied, SSL/TLS → Full (Strict)
- [ ] `curl https://<DOMAIN>/api/health` → `{"ok":true}`
- [ ] `curl https://<DOMAIN>/livekit/rtc/v1/validate` → 401
- [ ] STUN 3478/udp → 40B cevap
- [ ] Browser'dan iki sekme, birbirini arayabiliyor, ses/görüntü bağlanıyor

## 12. Üretim ortamı ek önerileri

- **certbot otomatik yenileme** zaten kuruldu (`systemctl list-timers | grep certbot`).
  Cloudflare DNS-only / Proxied geçişi gerektirmez çünkü yenileme
  sertifika 30 gün kala çalışır, halen aynı sertifika geçerli olur
  (CF proxy ile HTTPS zaten çalışıyor).
- **Log rotasyon**: `/var/log` ve `journald` dolmasın diye
  `/etc/logrotate.d/postacim` ekle.
- **Yedek**: `<REPO_DIR>/data/` (server SQLite DB) + `.env` + sertifikalar.
  `crontab -e` ile günlük `rsync` veya `tar.gz` dışarı.
- **SSH**: sadece key-based auth (şifre kapalı), `PermitRootLogin prohibit-password`.
- **Netdata** port 19999 yalnız 127.0.0.1'de; SSH tunnel ile erişim.
- **Disk monitoring**: `df -h` ile %80 üstü alarm kur (netdata zaten yapıyor).

---

## Değişiklik geçmişi

- **2026-09-16**: İlk sürüm. Sıfırdan kurulum senaryosu, 12 bölüm,
  "bir daha yapma" listesi.
