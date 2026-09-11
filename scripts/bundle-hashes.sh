#!/usr/bin/env bash
# web/dist içindeki dosyaların sha256 özet listesini üretir: hem stdout'a hem
# web/dist/INTEGRITY.txt'ye yazar. Kullanım: build sonrası operatör listeyi bant
# dışı (imzalı release / başka sunucu) yayınlar; kullanıcı/izleyci kendi
# indirdiği dist ile karşılaştırır. NOT: dist Docker image içinde kaldığı için
# image build'ine otomatik bağlanmaz — liste dış yayını gerektirir.
set -euo pipefail

cd "$(dirname "$0")/.."
DIST=web/dist
OUT="$DIST/INTEGRITY.txt"

if [ ! -f "$DIST/index.html" ]; then
    echo "web/dist bulunamadı — önce 'npm run -w web build' çalıştır." >&2
    exit 1
fi

# tüm build çıktısı (index.html, assets/**, ...), bir önceki listeden kendisi hariç
(
    cd "$DIST"
    find . -type f ! -name INTEGRITY.txt -print0 | sort -z | xargs -0 sha256sum
) | tee "$OUT"