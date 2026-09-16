# VPS kalkan + WireGuard tüneli — mimari ve kurulum kaydı

> Postacim'in üretim topolojisi. Bu doküman `deploy/wireguard-shield-setup.md`
> (VPS'te gerçek kurulum sırasında yazılan, secret'ları maskeli kayıt) ile
> birlikte taşınma/tekrar kurulum için referanstır.

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
tarayıcı ──HTTPS──> Cloudflare (proxied, DOMAIN<)
                        │
                        ▼
                   VPS (VPS_IP<)          ── kalkan / kapı
                   ├─ nginx :443  ─┬─ /api,/ws → 10.10.0.2:4000
                   │               └─ / (statik+/livekit) → 10.10.0.2:8080
                   ├─ WireGuard :51820/udp (tek açık UDP)
                   └─ iptables NAT: 50000-50100/udp, 7881/tcp, 3478/udp
                        → DNAT → 10.10.0.2
                        │
                 ═══════╪═══════ WireGuard tüneli (UDP 51820, ev→VPS kurulur)
                        │
                        ▼
                   EV (gerçek sunucu)          ── sıfır açık port
                   ├─ web container  10.10.0.2:8080  (nginx: statik + /livekit proxy)
                   ├─ server container 10.10.0.2:4000
                   └─ livekit (host network) *:7880/7881/50000-50100/3478
```

Trafik akışları:

- **HTTP/WS/sinyal**: CF → VPS nginx → tünel → ev (nginx→server ya da web)
- **Medya (ses/video UDP)**: istemci → VPS:50000-50100/udp → **DNAT** → tünel → ev LiveKit.
  LiveKit `--node-ip VPS_IP<` ile ICE candidate'larında VPS IP'sini duyurur —
  istemci eve değil VPS'e bağlanır, geri kalanı DNAT'ın işi.
- **Geri dönüş**: VPS'te `MASQUERADE -o wg0` evin cevaplarını VPS IP'sinden dışarı taşır
  (conntrack geriye doğru un-DNAT yapar — istemci her şeyi VPS'ten geliyormuş gibi görür).

Ev IP'si hiçbir yerde geçmez: ICE candidate'ları, XFF, DNS — hepsi VPS'i gösterir.
DDoS senaryosu: hattı doyan VPS'tir; DNS'i yeni VPS'e çevir, devam.

## Konfigürasyon envanteri

### Ev — `/etc/wireguard/wg0.conf`

```ini
[Interface]
Address = 10.10.0.2/24
PrivateKey = <REDACTED — ev.key>

[Peer]
PublicKey = <REDACTED — VPS public key>
Endpoint = VPS_IP<:51820
AllowedIPs = 10.10.0.0/24        # yalnız tünel ağı — tüm interneti VPS'ten çekme
PersistentKeepalive = 25         # outbound tutar; evde inbound port gerekmez
```

```bash
sudo systemctl enable --now wg-quick@wg0
```

### Ev — container bağlamaları (`~/postacim/.env`)

```bash
WEB_HOST=10.10.0.2       # docker web :8080 tünel IP'sinde
SERVER_HOST=10.10.0.2    # server :4000 tünel IP'sinde
LIVEKIT_URL=https://DOMAIN</livekit   # tarayıcıya duyurulan SFU adresi (CF arkası)
```

### Ev — LiveKit dış IP (`docker-compose.yml` livekit command)

```yaml
command:
  - --config
  - /etc/livekit.yaml
  - --keys
  - "..."
  - --node-ip
  - VPS_IP<
```

`livekit.yaml`'da `use_external_ip: false` kalır. `nat_1_to_1_ip` v1.13.1'de YOK
(config parse crash'i — `--node-ip` flag'i bunun stabil yolu).

### Ev — ufw

```bash
sudo ufw allow from 172.16.0.0/12 comment 'docker networks -> host'   # web container→LiveKit (172.17.x docker0 DEĞİL, br-xxxx!)
sudo ufw allow in on wg0        # tünel paketleri (7881 SYN'leri burada DROP oluyordu)
sudo ufw route allow in on wg0  # routed trafik (varsayılan ufw 'deny (routed)')
sudo ufw route allow out on wg0
# /etc/default/ufw: DEFAULT_FORWARD_POLICY="ACCEPT"
```

### VPS — `/etc/wireguard/wg0.conf`

```ini
[Interface]
Address = 10.10.0.1/24
ListenPort = 51820
PrivateKey = <REDACTED — vps.key>

[Peer]
PublicKey = <REDACTED — ev public key>
AllowedIPs = 10.10.0.2/32
```

### VPS — NAT (`/etc/ufw/before.rules` en üstü, `*filter`'dan önce)

```
*nat
:PREROUTING ACCEPT [0:0]
:POSTROUTING ACCEPT [0:0]
-A PREROUTING -i ens192 -p udp --dport 50000:50100 -j DNAT --to-destination 10.10.0.2
-A PREROUTING -i ens192 -p tcp --dport 7881 -j DNAT --to-destination 10.10.0.2
-A PREROUTING -i ens192 -p udp --dport 3478 -j DNAT --to-destination 10.10.0.2
-A POSTROUTING -o wg0 -j MASQUERADE
COMMIT
```

(uhz INPUT: 22, 80, 443, 51820/udp — DNAT'li trafik INPUT'a girmez, PREROUTING
routing kararından önce çalışır; hedef 10.10.0.2 olduğundan paket FORWARD'a gider.)

### VPS — sysctl + nginx

```bash
net.ipv4.ip_forward=1        # /etc/sysctl.d/99-wg.conf
```
nginx: `deploy/nginx-postacim.conf` — hedefler `127.0.0.1` değil `10.10.0.2`.
Sertifika: evde üretilip `rsync /etc/letsencrypt/` ile taşınır.

### Cloudflare

`DOMAIN<` A → VPS IP, **Proxied** (turuncu). WebSockets destekli;
medya UDP'yi CF taşımaz — DNAT halleder.

## Kurulum sırası (yeni kalkan VPS'i için)

1. `apt install wireguard` + key üret → ev conf'unu güncelle (Endpoint)
2. `wg0.conf` + `systemctl enable --now wg-quick@wg0` → `ping 10.10.0.2` tünel testi
3. `ip_forward=1` + before.rules NAT bloğu (arayüzü `ip route | awk '/^default/{print $5}'` ile bul) + ufw INPUT portları + `ufw enable`
4. nginx conf'u (hedef 10.10.0.2) + sertifika rsync + `certbot --nginx -d DOMAIN<`
5. Evde: compose `--node-ip` güncelle + `docker compose restart livekit`
6. CF A kaydı → yeni VPS IP
7. Test: `curl https://DOMAIN</api/health` → `{"ok":true}`, `nc -zv <vps> 7881`, arama

## Sorun giderme — başımıza gelenler

| Belirti | Kök neden | Çözüm |
|---|---|---|
| WS `Invalid Upgrade header` 400 | nginx'te `Upgrade $connection_upgrade` yazılmış (map çıktısı literal "upgrade"); ws lib "websocket" bekler | `proxy_set_header Upgrade $http_upgrade;` |
| Tünel handshake yok (0 B rx) | peer key uyuşmazlığı — private key public key sanıldı | `wg show` iki tarafta key'leri karşılaştır |
| `nat_1_to_1_ip` config crash loop | alan v1.13.1'de yok | compose `--node-ip <ip>` flag'i |
| web container→LiveKit timeout | ufw `allow in on docker0` yetmez — compose **br-xxxx** network'ünden girer | `ufw allow from 172.16.0.0/12` |
| 7881'e SYN gelir, SYN-ACK dönmez | ev ufw INPUT default deny, `allow in on wg0` eksikti | `ufw allow in on wg0` |
| `/livekit` 000 timeout (sinyal) | aynı zincir — ufw docker subnet izni | yukarıdakiyle aynı |
| tanı yöntemi | `tcpdump -ni wg0 port 7881` (eve paket düşüyor mu) + `iptables -t nat -L -n -v` sayaçları | hairpin test sayaçları yanıltır — testi DIŞARIDAN yap |

## Bilinen temizlik TODO'ları

- [ ] VPS'te duplicate DNAT kuralları (aynı kural 3 kopya) — `iptables -t nat -D PREROUTING <no>` ile tekrarlar silinmeli, `netfilter-persistent save`/ufw reload
- [ ] WG private key rotasyonu (kurulum sırasında sohbet ortamına düştü) — iki tarafta `wg genkey`, conf'ları güncelle, restart
- [ ] `wireguard-shield-setup.md` (VPS'teki gerçek kurulum kaydı) repoya alınacaksa `scp` ile eve çekilmeli
