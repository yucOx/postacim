# Güvenlik Politikası

postacim, uçtan uca şifreli bir iletişim aracıdır — güvenlik açıkları olağan
hatalardan daha ciddi sonuçlar doğurur. Bildiriminize öncelik veriyoruz.

## Güvenlik açığını nasıl bildirirsiniz

**Lütfen GitHub issue AÇMAYIN** — public issue, açığı düzeltilmeden tüm
dünyaya duyurmak anlamına gelir.

Özel kanallar:

1. **GitHub Private Vulnerability Reporting** (tercih edilen): bu repoda
   **Security → Report a vulnerability** sekmesini kullanın. Yalnız
   maintainers görür, düzeltme yayınlanana kadar gizli kalır.
2. Alternatif: repo sahibine profil üzerinden özel mesaj (coordinasyon için
   ikinci yol).

**İlk yanıt hedefi: 72 saat.** Kabul edilen açıklar için düzeltme
zaman çizelgesini birlikte belirleriz (kural: koordineli açıklama, 90 gün).

## Kapsam — neler bildirilmeli

- **Kripto**: mesaj/anahtar çözümü, AAD bağlama atlatması, ratchet zinciri
  kırılması, anahtar defteri (key transparency) zincir sahteciliği, kimlik
  blob'unun yetkisiz açılması
- **Auth**: oturum çalma/fiksasyon, rate limit atlatma, nick enumeration,
  yetkisiz kanal/topluluk/DM erişimi, rekey atlatması (çıkarılan üyenin
  sonraki mesajları okuması)
- **Web**: XSS (CSP'yi aşan), CSRF, WebSocket auth atlatması, injection
- **Sunucu**: yetki yükseltme (member → admin → owner), ban/davet sistemi
  atlatması, hesap silme işleminden veri artığı
- **Medya**: LiveKit token sahteciliği, SFrame baypası, ekran paylaşımı
  kill switch'ini (`SCREEN_SHARE=off`) token seviyesini değiştirmeden aşma

## Kapsam dışı — bilinen ve kabul edilmiş sınırlar

Bunlar README "Tehdit modeli ve bilinen sınırlar" bölümünde dürüstçe
dokümante edilmiştir; bildirmenize gerek yok (yine de iyi niyetli tartışmaya
açıktır):

- **Metadata sızıntısı** — sosyal graf (kim kiminle), zamanlama, presence,
  oda/kanal/üye listesi sunucuda görünür (içerik değil). Padding ile mesaj
  boyutu çıkarımı zorlaştırılır; tam metadata gizleme roadmap'te değil.
- **Web JS trust** — uygulama JS sunucudan dağıtılır; kötü niyetli sunucu
  değişmiş JS ile anahtarları çalabilir. Signed release olmadan tarayıcı
  E2EE'de kapatılamaz (yapısal sınır).
- **Sansür/sıralama** — kör sunucu mesaj gizleyebilir/sıralamayı
  manipüle edebilir (client binding ile tespit edilebilir, engellenemez).
- **Cihaz üzerindeki saldırgan** — çalışmış tarayıcı, malware, fiziksel
  erişim kapsam dışıdır.
- **ML Sistemi çıktıları üzerindeki denemeler** (nick brute force vs.) —
  rate limit'ler zaten bunları sınırlandırır; "limiti aştım" tek başına
  açık değildir (limiti aşan mantık hatası açık **olabilir**).

## Ödül (bug bounty)

Ödül programımız yok — postacim açık kaynak ve kar amacı gütmez. Ciddi
açıklar için: bildiren kişinin adı (isterseniz takma ad) düzeltme
commit'inde ve RELEASES notlarında anılır.

## Güvenlik iddialarını doğrulama

Dokümandaki her güvenlik iddiası koda karşı doğrulanabilir olmalı:

```bash
npm test   # 173+ test: kripto birim + kara kutu entegrasyon
```

Kripto mimarisi: README "Kripto mimarisi" tablosu + ARCHITECTURE "Anahtar
yaşam döngüsü". Ağ katmanı: docs/NETWORKING.md. Dağıtım sertleştirmesi:
deploy/vps-fresh-install.md.
