# 2026-07-24 — Gizlilik vaadi sağlamlaştırma (kurul kararı)

**Konu:** Eksikler, potansiyel sorunlar, UI — tamamen gizlilik odaklı ürün olarak postacim.
**Danışmanlar:** visionary, skeptic, pragmatist, designer (keşif brifiyle).

**Hüküm:** Özellik seti tamam; sıra vaadi tutturmada. Yeni özellik yok — hardening + güven ritüeli.
Kesilen: dosya/emoji/bot/dizin/AI/çoklu cihaz ("şifreli Discord" tuzakları). MLS + taşınabilir
kimlik = büyük bet, ilk kullanıcı dalgasından sonra.

**Kanıtlı blocker'lar (şüpheci, dosya:satır):**
- B1 trustProxy yok → tüm rate limit'ler nginx arkasında TEK global kova (self-DoS).
- B3 kick'te rekey yok + davet düşmüyor → atılan üye eski davetle her şeyi okur.
- B4 LiveKit eviction çağrısı hiç yok → atılan üye sesli kanalı dinlemeye devam eder.
- B5 şifre değişimi session'ları düşürmez. B2+B6 TLS yok + ws:// hardcode (HTTPS'te WS ölür).
- R5 CSP yok, token localStorage. R1/R2 kanal+join-password uçları limitsiz.

**Aksiyon (sıra):**
1. Sprint Bütünlük: trustProxy+user-id limit anahtarları; pending_rekey (rekey'siz davet/mesaj blok);
   admin rotate yetkisi; LiveKit RemoveParticipant üyelik kaybında; şifre→DELETE sessions;
   default LIVEKIT_SECRET refuse; kanal/join-pw rate limit. e2e ile doğrula.
2. Sprint Taşıma: TLS+HSTS, wss dallanması, strict CSP, token→httpOnly cookie, WS backoff.
3. Sprint Güven: BIP-39 kurtarma ifadesi (üç converged açı: UX trust + R3 kurtarıcı + taşınabilir
   kimlik tohumu), şifre güç göstergesi, confirm()/alert() sökümü → branded dialog+toast.
4. Sonra: mobil drawer, aria pass; MLS+portable-identity beti.

**Doğrulanmayan varsayımlar:** LiveKit TTL davranışı (canlı odada kick testi), @fastify/rate-limit
keyGenerator davranışı (proxy arkasında 6 IP'li 429 testi).
