# VPS kalkan + WireGuard tüneli — mimari ve referans

> **⚠️  DURUM: Artık kullanılmıyor (2026-09-16 itibarıyla)**
>
> Postacim şu anda **doğrudan VPS'te host ediliyor** (`vps-fresh-install.md`).
> Bu dokümandaki mimari (VPS = kalkan, ev = uygulama, arada WireGuard tüneli)
> aktif değil. Sadece referans olarak korunuyor — gelecekte "evde host edip
> VPS'i sadece kalkan olarak kullanmak" isteyenler için.
>
> Tüm `<PLACEHOLDER>` değerlerini kendi ortamına göre değiştir:
>
> | Placeholder | Açıklama | Örnek |
> |---|---|---|
> | `<VPS_IP>` | VPS'in dış IPv4 adresi | `203.0.113.10` |
> | `<VPS_PRIV_KEY>` | VPS WireGuard private key | `aVPSPr1vateKeyBase64EncodedHere...=` |
> | `<VPS_PUB_KEY>` | VPS WireGuard public key | `aVPSPubl1cKeyBase64EncodedHere...=` |
> | `<EV_PRIV_KEY>` | Ev WireGuard private key | `aHousePr1vateKeyBase64EncodedHere...=` |
> | `<EV_PUB_KEY>` | Ev WireGuard public key | `aHousePubl1cKeyBase64EncodedHere...=` |
> | `<DOMAIN>` | postacim alan adı | `postacim.example.com` |
> | `<EXTERNAL_IF>` | VPS dış ağ arayüzü | `ens192`, `eth0` |
> | `<LE_EMAIL>` | Let's Encrypt hesap e-postası | `admin@example.com` |
> | `<WG_PORT>` | WireGuard portu | `51820` |

## Bu bir Tailscale gibi mi?

Benzer amaç, farklı model:

| | Tailscale | Bu kurulum |
|---|---|---|
| Koordinasyon | Tailscale'in sunucusu (derin DERP/identity) | **yok** — statik key çiftleri, iki makine kendi aralarında konuşur |
| Kimlik | Google/GitHub SSO | `wg genkey` ile üretilen X25519 anahtarları |
| NAT geçişi | Otomatik (STUN/DERP) | VPS public IP'de dinler; ev hiç NAT geçmez, tüneli **kendi içinde dışarı doğru** kurar (`PersistentKeepalive`) |
| Kontrol | Üçüncü taraf servis | tamamen sende |

Tailscale "her cihaz birbirini görsün" der; burada ihtiyaç **tek yönlü kapı**:
internet → VPS → ev. O yüzden çıplak WireGuard + NAT yeterli ve üçüncü taraf yok.

## Mimari

```
tarayıcı ──HTTPS──> Cloudflare (proxied, <DOMAIN>)
                        │
                        ▼
                   VPS (<VPS_IP>)            ── kalkan / kapı
                   ├─ nginx :443  ─┬─ /api,/ws → 10.10.0.2:4000
                   │               └─ / (statik+/livekit) → 10.10.0.2:8080
                   ├─ WireGuard :<WG_PORT>/udp (tek açık UDP)
                   └─ iptables NAT: 50000-50100/udp, 7881/tcp, 3478/udp
                        → DNAT → 10.10.0.2
                        │
                 ═══════╪═══════ WireGuard tüneli (UDP <WG_PORT>, ev→VPS kurulur)
                        │
                        ▼
                   EV (gerçek sunucu)        ── sıfır açık port
                   ├─ web container  10.10.0.2:8080  (nginx: statik + /livekit proxy)
                   ├─ server container 10.10.0.2:4000
                   └─ livekit (host network) *:7880/7881/50000-50100/3478
```

- **Postacim bu VPS'te ÇALIŞMAZ** — yalnızca DNAT + reverse proxy yapılır
- Tüm uygulama trafiği 10.10.0.0/24 tüneli üzerinden eve gider
- 50000-50100/udp (LiveKit ICE), 3478/udp (LiveKit TURN), 7881/tcp (LiveKit signaling) — ev tarafına DNAT
- LiveKit `--node-ip <VPS_IP>` ile ICE candidate'larında VPS IP'sini duyurur —
  istemci direkt VPS public IP'ye bağlanır, tüneli bilmez

## Neden böyle?

- **Evdeki sunucu güvensiz** (çoğu ev NAT arkasında, dinamik IP, CGNAT riski)
- **VPS'in public IP'si sabit** — sertifika, CF proxy, DDoS koruması için
- **Ev tarafında sıfır port açık** — eve dışarıdan hiçbir bağlantı gelmez, ev→VPS kendisi kurar
- **DNS + sertifika VPS'te**, gerçek uygulama evde, tünel içinde

## VPS tarafı (kalkan) kurulumu

### 1. WireGuard anahtarları

```bash
cd /etc/wireguard
wg genkey | tee vps.key | wg pubkey > vps.pub
chmod 600 vps.key vps.pub

# ev tarafında da üret:
# wg genkey | tee ev.key | wg pubkey > ev.pub
# ev.pub içeriğini VPS'e getir, vps.pub içeriğini eve gönder
```

### 2. /etc/wireguard/wg0.conf

```ini
[Interface]
Address = 10.10.0.1/24
ListenPort = <WG_PORT>
PrivateKey = <VPS_PRIV_KEY>

[Peer]
# ev sunucusu (postacim Docker stack)
PublicKey = <EV_PUB_KEY>
AllowedIPs = 10.10.0.2/32
```

```bash
systemctl enable --now wg-quick@wg0
wg show
# interface: wg0
#   public key: <VPS_PUB_KEY>
#   listening port: <WG_PORT>
#
# peer: <EV_PUB_KEY>
#   allowed ips: 10.10.0.2/32
```

**Not:** `ping 10.10.0.2` henüz yanıt vermeyebilir — ev tarafı tüneli
`Endpoint = <VPS_IP>:<WG_PORT>` ile kendisi kuracak, hata sayma.

### 3. IP forward

```bash
cat > /etc/sysctl.d/99-wg.conf <<'EOF'
net.ipv4.ip_forward = 1
EOF
sysctl --system
sysctl net.ipv4.ip_forward
# 1
```

### 4. UFW: FORWARD policy + medya portları

```bash
# FORWARD policy (nat'lı trafik için)
sed -i 's/^DEFAULT_FORWARD_POLICY=.*/DEFAULT_FORWARD_POLICY="ACCEPT"/' /etc/default/ufw
ufw route allow in on wg0
ufw route allow out on wg0
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow <WG_PORT>/udp comment "WireGuard (postacim WireShield)"
ufw allow 7881/tcp comment "LiveKit signaling (postacim)"
ufw allow 3478/udp comment "LiveKit TURN (postacim)"
ufw allow 50000:50100/udp comment "LiveKit ICE media (postacim)"
ufw reload
```

### 5. iptables NAT: /etc/ufw/before.rules

```bash
# Önce backup
cp /etc/ufw/before.rules /etc/ufw/before.rules.bak

# Dış arayüzü tespit et
EXTERNAL_IF=$(ip route | awk '/^default/{print $5; exit}')

# En üstüne *nat bloğu ekle (filter'dan ÖNCE)
# Mevcut *nat varsa temizle
sed -i '/^# postacim WireShield/,/^COMMIT$/d' /etc/ufw/before.rules

cat > /tmp/nat_block <<EOF
# postacim WireShield — DNAT (Cloudflare/VPS üzerinden eve)
*nat
:PREROUTING ACCEPT [0:0]
:POSTROUTING ACCEPT [0:0]
-A PREROUTING -i ${EXTERNAL_IF} -p udp --dport 50000:50100 -j DNAT --to-destination 10.10.0.2
-A PREROUTING -i ${EXTERNAL_IF} -p tcp --dport 7881 -j DNAT --to-destination 10.10.0.2
-A PREROUTING -i ${EXTERNAL_IF} -p udp --dport 3478 -j DNAT --to-destination 10.10.0.2
-A POSTROUTING -o wg0 -j MASQUERADE
COMMIT

EOF

# filter kurallarının ÜSTÜNE, dosyanın en başına ekle
awk -v block="$(cat /tmp/nat_block)" 'BEGIN{p=1} /^\*filter/{print block; p=0} {print}' /etc/ufw/before.rules > /tmp/before.rules.new
mv /tmp/before.rules.new /etc/ufw/before.rules

systemctl restart ufw
iptables -t nat -L PREROUTING -n -v
# 3 DNAT satırı + MASQUERADE görünmeli
```

### 6. nginx: deploy/nginx-postacim.conf

`server_name`'i kendi domain'ine çevir, tünel hedeflerini `127.0.0.1` yerine
`10.10.0.2` yap:

```bash
cp deploy/nginx-postacim.conf /etc/nginx/sites-available/postacim
sed -i 's/server_name postacim.example.com;/server_name <DOMAIN>;/' /etc/nginx/sites-available/postacim
sed -i 's|127\.0\.0\.1:4000|10.10.0.2:4000|g' /etc/nginx/sites-available/postacim
sed -i 's|127\.0\.0\.1:8080|10.10.0.2:8080|g' /etc/nginx/sites-available/postacim

# HTTPS için §5 certbot sonrası ek blok gerekli (vps-fresh-install.md §5'e bak)

ln -s /etc/nginx/sites-available/postacim /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx
```

### 7. Sertifika — ev tarafından rsync

Bu VPS'te Let's Encrypt almak için **ev tarafında** al, sonra rsync:

```bash
# ev makinede
sudo rsync -a /etc/letsencrypt/ root@<VPS_IP>:/etc/letsencrypt/

# gelince, host nginx'e HTTPS bloğu ekle (vps-fresh-install.md §5)
```

`<DOMAIN>` A → VPS IP, **Proxied** (turuncu). WebSockets destekli;
UDP 50000-50100 CF üzerinden geçmez, o yüzden ya DNS-only alt domain
(`livekit.<DOMAIN>`) ya da CF Spectrum (ücretli).

## Ev tarafı kurulumu

### 1. /etc/wireguard/wg0.conf (ev makinede)

```ini
[Interface]
Address = 10.10.0.2/24
ListenPort = <WG_PORT>
PrivateKey = <EV_PRIV_KEY>

[Peer]
# VPS kalkan
PublicKey = <VPS_PUB_KEY>
Endpoint = <VPS_IP>:<WG_PORT>
AllowedIPs = 10.10.0.0/24
PersistentKeepalive = 25
```

### 2. .env: SERVER_HOST ve LIVEKIT_URL

```env
WEB_HOST=<DOMAIN>
SERVER_HOST=10.10.0.1      # VPS WG IP — server tarafı buraya yazar
LIVEKIT_URL=https://<DOMAIN>/livekit   # tarayıcıya duyurulan SFU adresi (CF arkası)
```

### 3. livekit.yaml

```yaml
rtc:
  use_external_ip: true
  node_ip: <VPS_IP>        # ← tünel üzerinden gönderilen ICE candidate'larında VPS IP görünür
```

### 4. ev tarafı ufw — FORWARD policy (NAT'lı gelen trafik için)

```bash
sudo sed -i 's/^DEFAULT_FORWARD_POLICY=.*/DEFAULT_FORWARD_POLICY="ACCEPT"/' /etc/default/ufw
sudo ufw route allow in on wg0
sudo ufw route allow out on wg0
sudo ufw reload
```

## Doğrulama

```bash
# VPS'ten eve ping (tünel canlı mı)
ping -c 3 10.10.0.2

# VPS'ten eve API (tünel + uygulama)
curl -s http://10.10.0.2:4000/api/health
# {"ok":true}

# VPS'ten dış IP'ye uçtan uca medya testleri
curl -s -m 3 -o /dev/null -w '%{http_code}\n' http://<VPS_IP>:7881/
# 000 (HTTP atarsan reset — WebRTC-only port, normal)

# VPS dışarıdan dış IP'ye
curl -s https://<DOMAIN>/api/health
# {"ok":true}
```

## Sorun giderme

### Tünel koptu

- `wg show` → `latest handshake` 2 dakikadan eski, `transfer` artmıyor
- Ev tarafında `wg show` ile handshake yok → `PersistentKeepalive = 25` peer bloğunda var mı kontrol et
- VPS'te `tcpdump -ni wg0` ile paket gelip gelmediğini izle
- `systemctl restart wg-quick@wg0` hem VPS hem evde dene

### Medya bağlanmıyor (LiveKit)

- Tüm 3 DNAT satırı yerinde mi: `iptables -t nat -L PREROUTING -n`
- ICE portları dışarıdan açık mı: VPS'te `nc -zuv <VPS_IP> 50000` benzeri
- Cloudflare proxy UDP geçirmez; 50000-50100/udp için **DNS only** gerekir
  (gri bulut) veya alt domain (`livekit.<DOMAIN>`) ayrılabilir
- **Ev tarafı ufw'de** `ufw route allow in on wg0` yapılmadıysa DNAT'lı
  paketler FORWARD'da drop olur — `iptables -L FORWARD -n -v` ile
  sayacın artıp artmadığına bak

### nginx 502

- `10.10.0.2 erişilemez = tünel aşağı`. `wg show` ve `ping 10.10.0.2` kontrol et
- Ev tarafı servisleri ayakta mı: `docker ps` (api:4000, web:8080, livekit:7880/3478)
- `curl http://10.10.0.2:4000/api/health` VPS'ten → 200 olmalı

### DNAT kuralı uygulandı ama paketler gelmiyor

- UFW INPUT'ta ilgili port açık mı? PREROUTING nat yapsa bile default
  `deny incoming` paketi drop eder
- VPS sağlayıcısı (Hetzner cloud firewall, Vultr security group) portu
  blokluyor olabilir — sağlayıcı paneli kontrol et

## Mimariyi sökmek

Bu mimari artık gerekmiyorsa (örn. postacim'i VPS'e taşıdıysan):

```bash
systemctl disable --now wg-quick@wg0
rm -f /etc/wireguard/wg0.conf
rm -f /etc/wireguard/vps.key /etc/wireguard/vps.pub
rm -f /etc/sysctl.d/99-wg.conf
sysctl -w net.ipv4.ip_forward=0
sed -i 's/^DEFAULT_FORWARD_POLICY=.*/DEFAULT_FORWARD_POLICY="DROP"/' /etc/default/ufw
ufw delete allow <WG_PORT>/udp
cp /etc/ufw/before.rules.bak /etc/ufw/before.rules
iptables -t nat -F PREROUTING
iptables -t nat -F POSTROUTING
systemctl restart ufw
```

VPS kalkan modundan çıkar, sadece kendi servislerini host eder.

## Değişiklik geçmişi

- **2026-09-16**: Postacim doğrudan VPS'e taşındı, mimari pasif duruma alındı
- **<ESKİ TARİH>**: İlk sürüm, tünel aktif
