#!/usr/bin/env bash
# web/dist içindeki dosyaların sha256 özet listesini üretir: hem stdout'a hem
# web/dist/INTEGRITY.txt'ye yazar; ayrıca aynı hash'lerden SRI biçimli
# INTEGRITY.sri.txt türetilir (sha256-<base64> — tarayıcı integrity="" özniteliği).
# Kullanım: build sonrası operatör listeyi bant dışı (imzalı release / başka
# sunucu) yayınlar; kullanıcı/izleyci kendi indirdiği dist ile karşılaştırır.
# CI: release.yml bu betiği v* tag'lerinde çalıştırıp manifest'i GitHub Release
# asset'i olarak yükler. NOT: dist Docker image içinde kaldığı için image
# build'ine otomatik bağlanmaz — liste dış yayını gerektirir.
set -euo pipefail

cd "$(dirname "$0")/.."
DIST=web/dist
OUT="$DIST/INTEGRITY.txt"
SRI="$DIST/INTEGRITY.sri.txt"

if [ ! -f "$DIST/index.html" ]; then
    echo "web/dist bulunamadı — önce 'npm run -w web build' çalıştır." >&2
    exit 1
fi

# tüm build çıktısı (index.html, assets/**, ...), önceki listelerin kendisi hariç
(
    cd "$DIST"
    find . -type f ! -name INTEGRITY.txt ! -name INTEGRITY.sri.txt -print0 | sort -z | xargs -0 sha256sum
) | tee "$OUT"

# SRI satırları INTEGRITY.txt'ten türetilir — aynı hash'in base64 kodlaması,
# ayrı hesap yok (hash uyuşmazlığı yapısal olarak imkânsız)
node -e '
const fs = require("fs");
const lines = fs.readFileSync(process.argv[1], "utf8").trimEnd().split("\n").map((l) => {
    const m = l.match(/^([0-9a-f]{64})\s+\*?(.*)$/);
    if (!m) throw new Error("INTEGRITY.txt satırı çözümlenemedi: " + l);
    return "sha256-" + Buffer.from(m[1], "hex").toString("base64") + "  " + m[2];
});
fs.writeFileSync(process.argv[2], lines.join("\n") + "\n");
' "$OUT" "$SRI"