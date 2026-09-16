#!/bin/bash
# postacim — VPS state restore + diff check
#
# Git'te tracked olmayan VPS-e-özgü dosyaları /etc/postacim/ dizininden
# repo'ya restore eder. Eğer yeni .example dosyaları geldiyse, eski .env
# ile diff'i gösterir (yeni alanları ayarlamayı hatırlatır).
#
# Kullanım:
#   ./scripts/deploy-state.sh         # restore + diff
#   ./scripts/deploy-state.sh diff    # sadece diff göster
#   ./scripts/deploy-state.sh status  # restore kaynak durumunu göster
#
# Çıktı: tüm normal; hata varsa exit 1.
set -e

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
STATE_DIR="/etc/postacim"

RED='\033[0;31m'
GRN='\033[0;32m'
YEL='\033[1;33m'
NC='\033[0m'

log() { echo -e "$@"; }
err() { log "${RED}$@${NC}" >&2; }
ok()  { log "${GRN}$@${NC}"; }
wrn() { log "${YEL}$@${NC}"; }

status() {
  echo "── VPS state durumu ──"
  if [ -d "$STATE_DIR" ]; then
    ls -la "$STATE_DIR" | tail -n +2 | awk '{print "  ", $NF, "(" $5 " byte)"}'
  else
    err "  /etc/postacim yok — ilk kurulum gerekli"
    return 1
  fi
  echo
  echo "── repo'daki hedefler ──"
  for f in .env livekit/livekit.yaml; do
    if [ -e "$REPO_ROOT/$f" ] && [ ! -L "$REPO_ROOT/$f" ]; then
      echo "  ✓ $f (tracked DEĞİL — local)"
    else
      echo "  ✗ $f yok"
    fi
  done
}

restore() {
  if [ ! -d "$STATE_DIR" ]; then
    err "✗ $STATE_DIR yok — ilk kurulum gerekli"
    echo "  Kurmak için:"
    echo "    sudo mkdir -p $STATE_DIR"
    echo "    sudo cp .env.example $STATE_DIR/.env && sudo chmod 600 $STATE_DIR/.env"
    echo "    sudo cp livekit/livekit.yaml.example $STATE_DIR/livekit.yaml"
    echo "  Sonra gerçek değerleri düzenle ve bu script'i tekrar çalıştır."
    return 1
  fi

  # 1. .env
  if [ -f "$STATE_DIR/.env" ]; then
    cp "$STATE_DIR/.env" "$REPO_ROOT/.env"
    chmod 600 "$REPO_ROOT/.env"
    ok "✓ .env geri yüklendi (VPS state)"
  else
    err "✗ $STATE_DIR/.env yok"
    return 1
  fi

  # 2. livekit.yaml
  if [ -f "$STATE_DIR/livekit.yaml" ]; then
    cp "$STATE_DIR/livekit.yaml" "$REPO_ROOT/livekit/livekit.yaml"
    chmod 644 "$REPO_ROOT/livekit/livekit.yaml"
    ok "✓ livekit/livekit.yaml geri yüklendi (VPS state)"
  else
    err "✗ $STATE_DIR/livekit.yaml yok"
    return 1
  fi
}

# .env vs .env.example diff — yeni alan geldi mi kontrol
diff_env() {
  if [ ! -f .env ] || [ ! -f .env.example ]; then
    return 0
  fi
  # Hem aktif hem commented (#) KEY'leri karşılaştır
  local env_keys=$(grep -E '^[#]?[A-Z][A-Z0-9_]+=' .env 2>/dev/null | sed 's/^#//' | cut -d= -f1 | sort -u)
  local ex_keys=$(grep -E '^[#]?[A-Z][A-Z0-9_]+=' .env.example 2>/dev/null | sed 's/^#//' | cut -d= -f1 | sort -u)

  local new_in_example=$(comm -13 <(echo "$env_keys") <(echo "$ex_keys"))
  local new_in_env=$(comm -23 <(echo "$env_keys") <(echo "$ex_keys"))

  if [ -n "$new_in_example" ]; then
    wrn ""
    wrn "⚠️  .env.example'da yeni alanlar var (.env'de yok):"
    for k in $new_in_example; do
      wrn "    + $k"
    done
    wrn "  Yeni özellik gelmiş olabilir — /etc/postacim/.env'yi güncelle:"
    wrn "    grep -E '^($(echo $new_in_example | tr ' ' '|'))=' .env.example"
  fi

  if [ -n "$new_in_env" ]; then
    wrn ""
    wrn "⚠️  .env'de olup .env.example'da olmayan alanlar (lokal özel):"
    for k in $new_in_env; do
      wrn "    - $k"
    done
  fi
}

# livekit.yaml.example vs livekit.yaml karşılaştırma (sadece anahtar/alan varlığı)
diff_livekit() {
  if [ ! -f livekit/livekit.yaml ] || [ ! -f livekit/livekit.yaml.example ]; then
    return 0
  fi
  # Top-level key + nested rtc/turn key'leri karşılaştır
  local cur_keys=$(grep -E '^[a-z_]+:' livekit/livekit.yaml | sort -u)
  local ex_keys=$(grep -E '^[a-z_]+:' livekit/livekit.yaml.example | sort -u)

  local new_in_example=$(comm -13 <(echo "$cur_keys") <(echo "$ex_keys"))

  if [ -n "$new_in_example" ]; then
    wrn ""
    wrn "⚠️  livekit.yaml.example'da yeni alanlar var (mevcut yaml'da yok):"
    for k in $new_in_example; do
      wrn "    + $k"
    done
    wrn "  Yeni özellik gelmiş olabilir — /etc/postacim/livekit.yaml'yi güncelle."
  fi
}

case "${1:-restore}" in
  status)
    status
    ;;
  diff)
    diff_env
    diff_livekit
    ;;
  restore|"")
    echo "── restore ──"
    restore
    echo
    echo "── diff kontrolü ──"
    diff_env
    diff_livekit
    echo
    ok "✓ tamamlandı"
    echo
    echo "Container'ları yeni config ile restart etmek için:"
    echo "  docker compose up -d --force-recreate server livekit"
    echo "Nginx reload (livekit.yaml değiştiyse):"
    echo "  systemctl reload nginx"
    ;;
  *)
    err "bilinmeyen komut: $1"
    echo "kullanım: $0 [status|diff|restore]"
    exit 1
    ;;
esac
