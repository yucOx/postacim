# Audit & funding kaynak notu

> v1.0.0 audit hazırlık sürecinde (Faz 8) ihtiyaç duyulabilecek dış
> kaynaklar — fon programları, güvenlik denetim firmaları, bağımsız
> araştırma önerileri. AGPL-3.0 açık kaynak, kar amacı gütmeyen
> proje için yol gösterici.

## Audit programları ve fon mekanizmaları

### Open Technology Fund (OTF) — Red Team Lab

- **Program**: [OTF Red Team Lab](https://www.opentech.fund/labs/red-team-lab)
  — gizlilik ve ifade özgürlüğü araçları için hedefli güvenlik
  denetimi ve "red teaming" fonlar.
- **Kapsam**: uçtan uca şifreli iletişim araçları, anti-sansür
  teknolojileri, güvenli tarama. postacim'in hedef kitlesi ve
  mimarisi (E2EE + self-host + AGPL) bu kapsamla uyumlu.
- **Başvuru**: dönemsel çağrılar — başvuru formu + kapsam
  teklifi. Karar OTF ekibinde; süreç 3–6 ay.
- **Çıktı**: bağımsız denetim raporu (postacim mainline'a
  yansıtılır + public release). Fon OTF tarafından denetim
  firmasına ödenir, projeye değil.

### Cure53

- **Program**: [Cure53](https://cure53.de/) — Berlin merkezli
  güvenlik denetim firması; browser, mobil, kripto, altyapı
  denetimi. Signal, ProtonMail, Tails, Tor Project ile
  çalışmaları var.
- **Kapsam**: kaynak denetimi (source audit), penetrasyon testi,
  kripto inceleme, threat model değerlendirmesi. Tipik
  süre 4–8 hafta, çıktı public rapor.
- **Başvuru**: doğrudan iletişim + kapsam teklifi. Ücretli;
  kar amacı gütmeyen projeler için indirimli paketler mevcut
  (FOSS istisnası).

### NCC Group

- **Program**: [NCC Group](https://www.nccgroup.com/) — büyük
  denetim firması; kripto, mobil, altyapı, IoT. Açık kaynak
  projelere "FOSS track" indirimi + public rapor seçeneği.

### Trail of Bits

- **Program**: [Trail of Bits](https://www.trailofbits.com/) —
  kripto, smart contract, sistem güvenliği. BuildVerify,
  Slither gibi araçları açık kaynak. Açık kaynak projeler için
  zaman zaman ücretsiz denetim (sponsorship).

### Radically Open Security

- **Program**: [Radically Open Security](https://www.radicallyopensecurity.com/)
  — Hollanda merkezli, "deliver hack back" modeli; açık kaynak
  ve sivil toplum projelerine denetim. Daha küçük bütçeli
  projelere uygun fiyat seçenekleri.

### Open Source Security (oss-security)

- **Liste**: [oss-security](https://www.openwall.com/lists/oss-security/)
  — public güvenlik bildirim listesi. Önemli açıklar için
  koordineli açıklama kanalı (90 gün kuralı).

## Fon ve sürdürülebilirlik

### Open Collective

- [Open Collective](https://opencollective.com/) — açık kaynak
  projeler için şeffaf bütçe + fatura. postacim için Open
  Collective sayfası açılabilir (bağış + masraf şeffaflığı).

### GitHub Sponsors

- [GitHub Sponsors](https://github.com/sponsors/) — `.github/FUNDING.yml`
  ile bağış butonu. Bu repo'da FUNDING.yml eklenebilir (henüz
  yok — karar kullanıcıda).

### NLnet Foundation

- [NLnet](https://nlnet.nl/) — Avrupa, açık kaynak + sivil
  toplum projeleri için hibe. Privacy & security track.

### EU Next Generation Internet (NGI)

- [NGI Zero](https://www.ngi.eu/) — AB fonlu, açık kaynak
  internet teknolojileri hibe programı. Privacy-enhancing
  technologies kapsamı uygun.

## Araştırma ve referans materyal

### Akademik / endüstriyel

- [Signal protokol spesifikasyonu](https://signal.org/docs/)
  — Double Ratchet + X3DH + Sesame (referans implementasyon
  + test vektörleri).
- [Matrix protocol](https://spec.matrix.org/) — Megolm (grup
  ratchet) + Olm (1:1). postacim'in PCS-lite kararının
  alternatiflerinden biri.
- [MLS RFC 9420](https://www.rfc-editor.org/rfc/rfc9420)
  — Messaging Layer Security. Faz 9 tetikleyicisi.
- [CONIKS](https://coniks.cs.princeton.edu/) — key transparency
  akademik referansı (Faz 6 gözlemsel sınırın alternatifi).

### Pratik kılavuzlar

- [OWASP ASVS](https://owasp.org/www-project-application-security-verification-standard/)
  — web uygulama güvenliği doğrulama standardı. postacim
  kendini ASVS Level 2 hedefli tutabilir.
- [NIST SP 800-63B](https://pages.nist.gov/800-63-3/sp800-63b.html)
  — kimlik doğrulama + şifre politikası. Argon2id parametreleri
  bu standarda uygun (64 MiB, t=3, p=1).
- [Mozilla SOPS](https://github.com/getsops/sops) — secret
  yönetimi (env şifreleme) — postacim'de `.env` gitignore +
  `/etc/postacim/` state ayrımı ile çözüldü; SOPS opsiyonel
  artı.

## Süreç önerisi (v1.0.0 sonrası)

1. **Sürüm tag + manifest** — kullanıcı `v1.0.0` tag'ini atar
   (kararı kullanıcıda); CI web bundle SHA manifest'i GitHub
   Release'e yükler.
2. **Public threat model yayını** — bu doküman + README tehdit
   modeli bölümü zaten public; audit başvurusu öncesi
   "Security" sekmesinde görünür.
3. **Başvuru** — OTF Red Team Lab (tercih, FOSS kapsamı) →
   Cure53 / NCC Group (yedek, ücretli). Başvuru 2–4 hafta sürer.
4. **Denetim** — 4–8 hafta; sonuç raporu public release
   (koordineli açıklama — 90 gün kuralı).
5. **Düzeltme + re-audit** — bulgular issue/PR olarak main'e;
   kritik bulgular koordineli release.

## Not

Bu doküman **Faz 8 kapsamında** hazırlanmıştır: audit için
kaynak ve başvuru yolu haritası. Doğrudan başvuru için kullanıcı
kararı + proje sahibinin resmi temsili gerekir (yuxor.ltd).
