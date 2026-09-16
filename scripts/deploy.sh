#!/usr/bin/env bash
# deploy — backend + web + livekit'i ayağa kaldırır (nginx MANUEL: README
# "Host nginx + certbot" bölümü / deploy/nginx-postacim.conf).
#
# Kullanım:
#   ./scripts/deploy.sh              # build + up + health kontrolü
#   ./scripts/deploy.sh --no-build   # build'sız recreate (sadece env/config değişimi)
#
# Yeni makinede: .env yoksa .env.example'dan üretir ve güçlü LiveKit
# anahtar çiftini otomatik basar — tek komutla canlıya çıkılır.
set -euo pipefail
cd "$(dirname "$0")/.."

NO_BUILD=false
[[ "${1:-}" == "--no-build" ]] && NO_BUILD=true

step() { printf '\n\033[1;36m▶ %s\033[0m\n' "$*"; }
ok()   { printf '  \033[0;32m✓ %s\033[0m\n' "$*"; }
warn() { printf '  \033[0;33m! %s\033[0m\n' "$*"; }
die()  { printf '  \033[0;31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

command -v docker >/dev/null || die "docker yok — önce docker kur"
docker compose version >/dev/null 2>&1 || die "docker compose plugin yok"

# --- .env ---
step ".env kontrolü"
if [[ ! -f .env ]]; then
  cp .env.example .env
  warn ".env yoktu — .env.example'dan üretildi"
  step "LiveKit anahtar çifti üretiliyor"
  KEYOUT=$(docker run --rm livekit/livekit-server:v1.13.1 generate-keys)
  API_KEY=$(awk '/API Key:/ {print $3}' <<<"$KEYOUT")
  SECRET=$(awk '/API Secret:/ {print $3}' <<<"$KEYOUT")
  [[ -n "$API_KEY" && -n "$SECRET" ]] || die "anahtar üretimi başarısız"
  sed -i "s|^LIVEKIT_API_KEY=.*|LIVEKIT_API_KEY=$API_KEY|" .env
  sed -i "s|^LIVEKIT_SECRET=.*|LIVEKIT_SECRET=$SECRET|" .env
  ok "güçlü çift basıldı ($API_KEY)"
else
  ok "var"
fi

# --- build + up ---
if $NO_BUILD; then
  step "compose up (build'sız)"
  docker compose up -d
else
  step "compose build + up"
  docker compose up -d --build
fi

# livekit config'i bind-mount: image değişmediği için up recreate etmez —
# config güncellemeleri (ör. prometheus_port) ancak restart ile geçer
step "livekit config tazeleme (restart)"
docker compose restart livekit

# --- health ---
wait_url() { # wait_url <ad> <url> <hak>
  local name="$1" url="$2" tries="${3:-30}"
  for _ in $(seq 1 "$tries"); do
    if curl -sf -o /dev/null --max-time 2 "$url"; then ok "$name → $url"; return 0; fi
    sleep 1
  done
  die "$name yanıt vermiyor → $url (log: docker compose logs --tail 50)"
}

step "sağlık kontrolü"
wait_url "server"  "http://127.0.0.1:4000/api/health"
WEB_PORT=$(grep -E '^WEB_PORT=' .env | cut -d= -f2 | tr -d ' ')
wait_url "web"     "http://127.0.0.1:${WEB_PORT:-8080}/"
wait_url "livekit" "http://127.0.0.1:6789/metrics"

step "durum"
docker compose ps --format 'table {{.Name}}\t{{.Status}}'

cat <<'EOF'

✓ deploy tamam — nginx MANUEL (bir kere):
    sudo cp deploy/nginx-postacim.conf /etc/nginx/sites-available/postacim
    sudo ln -s /etc/nginx/sites-available/postacim /etc/nginx/sites-enabled/
    # server_name düzenle, sonra:
    sudo nginx -t && sudo systemctl reload nginx
    sudo certbot --nginx -d <domain>        # SSL

  izleme: netdata http://localhost:19999 · stats: GET /api/stats
EOF
