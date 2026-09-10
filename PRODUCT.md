# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Global, herkese açık kitle. Birincil kullanıcı: verilerinin toplanmadığından emin olmak isteyen, Discord benzeri bir sohbet deneyimi arayan herkes — teknik olmayan kişiler dahil. Eşit ağırlıkta masaüstü ve mobil tarayıcı.

## Product Purpose

postacim (posta güvercini): uçtan uca şifreli sohbet. Topluluklar, metin/sesli odalar, DM, grup DM, 1:1 şifreli sesli/görüntülü arama. Sunucu hiçbir içeriği okuyamaz: mesaj anahtarları üyelerin açık anahtarlarına sarılır, aramalar SFrame ile uçtan uca şifrelenir, okundu bilgisi yalnızca istemcide tutulur. Başarı: kullanıcı güvenlik iddiasını arayüzde görebilsin ve uygulamayı her gün kullanmak istesin.

## Positioning

"Discord'un mekanikleri, sıfır bilgi" — sohbet/oda/arama deneyimi Discord'dan tanıdık, ama sunucu kördür: mesaj, arama, okundu durumu, kimlik. Sunucu yalnızca sarılı anahtar kutuları ve şifreli bayt görür. Komşu hiçbir ürün bu iddiayı aynı bütünlükle taşıyamaz.

## Operating Context

Self-host: docker compose (web/nginx, API sunucusu, LiveKit). Tarayıcıda çalışır, kurulum yok. TLS overlay ile HTTPS. Giriş: nick + şifre (Argon2id); kurtarma 12 kelimelik BIP39 ifadesi; davet linkiyle katılım.

## Capabilities and Constraints

- E2EE metin (kanal başına dönen anahtar epoch'ları; üye çıkarılınca rekey + kanal kilit gösterimi)
- E2EE sesli/görüntülü arama (LiveKit + SFrame), 1:1 DM araması
- DM, grup DM (üye ekleme = anahtar yenileme), arkadaşlık akışı
- Topluluk oluşturma/davet/başvuru, owner/admin moderasyon, ban = rekey
- ws realtime, kalıcı yeniden bağlanma; okundu/sessiz bildirim istemci tarafı
- Bekleyen ürün ihtiyaçları: arama sırasında sohbet, çağrıyı küçültüp PiP, çağrı kutularında karşı tarafın adı
- UI dili Türkçe; küresel kitle için i18n açık bir karardır (henüz kararlaştırılmadı)

## Brand Commitments

- Ad: postacim / posta güvercini; 🕊️ motifi mevcut kullanımda
- Ses: samimi, küçük harf dostu Türkçe ("uçtan uca şifreli", "postacim")
- Gizlilik iddiası görünür olmalı: şifreleme durumu arayüzde taşınır

## Evidence on Hand

Çalışan tam yığın: web/ (React + Tailwind v4), server/ (Fastify), canlı docker deploy. Ürün adı ve mekanikler README'de. Sentez dışı tanıtım/başarı verisi yok — uydurulmamalı.

## Product Principles

1. Sunucu kördür, görünür şekilde: şifreleme durumu her zaman arayüzde taşınır, gizlenen değil gösterilen şeydir.
2. Tanıdık mekanik, sıfır bilgi: Discord'dan gelen kullanıcı yönünü bulur; güvendi arayüzden alır.
3. Sadelik kapsar: teknik olmayan kullanıcı akışı kaybolmadan kullanır.
4. Eşit masaüstü/mobil: her ekran iki hedefle doğrulanır.
