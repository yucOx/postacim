#!/usr/bin/env bash
# Self-signed cert pair for LAN/single-host TLS (nginx + LiveKit share it).
# Usage: scripts/gen-certs.sh [hostname-or-ip ...]   (defaults: localhost + host IPs)
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p certs

SAN="DNS:localhost"
for h in "${@:-$(hostname -I 2>/dev/null || echo 127.0.0.1)}"; do
  if [[ $h =~ ^[0-9.]+$ ]]; then SAN+=", IP:$h"; else SAN+=", DNS:$h"; fi
done

openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 \
  -keyout certs/privkey.pem -out certs/fullchain.pem \
  -days 825 -nodes -subj "/CN=postacim" \
  -addext "subjectAltName=$SAN"

chmod 600 certs/privkey.pem
echo "certs/ altına sertifika üretildi (SAN: $SAN)"
echo "Şimdi: docker compose -f docker-compose.yml -f docker-compose.tls.yml up -d"
echo "ve .env içinde LIVEKIT_URL=https://<makine-adı-veya-ip>:7880"
