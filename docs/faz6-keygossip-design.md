# Faz 6 — Key transparency gossip: tasarım özeti

> SECURITY-ROADMAP.md Faz 6 uygulamasının kısa tasarım belgesi. Yol haritası
> akış kuralı 2: kısa tasarım, hangi dosya, hangi invariant korunuyor, kapsam
> dışı. Spec'in bu hali uygulama öncesi yazıldı; implementasyon buna bağlı.

---

## 1. Hedef ve dürüst sınır

Anahtar defteri (key_log) **head damgasının** istemciler arası WS ile
paylaşımı. Amaç: kötü sunucunun iki istemciye iki farklı defter göstermesi
(view-splitting / anti-forking) durumunda, istemcilerden en az biri
çelişkiyi **gözlemsel olarak** yakalayabilsin.

**Dürüst sınır:**
- Bu bir CONIKS/Keybase **kanıt zinciri değildir**. Çatışma çözümü
  gözlemseldir: iki online istemci aynı toplulukta aynı anda etkileşirken
  farklı head gördüklerini fark eder. Tam CONIKS için ek olarak per-entry
  kanıt ağacı (MAP) + periyodik tutarlılık kanıtı gerekirdi — kapsam dışı.
- Bant dışı doğrulama hâlâ **en güçlü** kanıt: iki cihazın profildeki
  damgayi karşılaştırması. Gossip, çevrimiçi senaryoyu kapatır; çevrimdışı
  senaryo zaten bant dışı damga karşılaştırmasıyla çözülür.
- Tek online istemci hiçbir çelişki yakalayamaz (gözlemci yok). Sunucu,
  tek online istemciye karşı sonsuza dek farklı defter gösterebilir.
  Bu sınır README "Bilinen sınırlar"a yazılır.

## 2. Wire format

### 2.1 Client → server: `keylog_head`

```jsonc
{
  "type": "keylog_head",
  "id": 42,                    // sunucunun /keys/log?head=42 ile bildirdiği id
  "hash": "abcdef…64 hex",     // entry_hash (SHA-256 hex, küçük harf)
  "communities": ["c_1", "c_2"] // üyesi olunan topluluklar (broadcast scope)
}
```

Periyodik yayın: **5 dakikada bir** (periyot değişkeni: `GOSSIP_PERIOD_MS`,
fazla trafik olmasın; JIT tetikleyici: `syncKeyLog` başarılı olunca bir
yayın). Gönderen kendi doğrulanmış head'ini gönderir — `syncKeyLog`'dan
dönen head, `pgv.keylog.head` localStorage'ında zaten saklanıyor.

Sığ sınır: `id` pozitif tam sayı (1 ≤ id ≤ 2^31), `hash` 64 hex karakter
(`/^[0-9a-f]{64}$/`), `communities` dizi, her eleman string; toplam
JSON ≤ 4 KiB. Tek online istemci (ağ) için periyot JIT tetikleme ile
düşürülebilir — `syncKeyLog` başarılı olunca ilk 5 dk'yı beklemeden
bir yayın.

### 2.2 Server → client: `keylog_head`

Sunucu: gelen `keylog_head` frame'ini **opak relay** eder:
- Yayıncı (sender) = authed socket userId
- Hedef kitle = `communities[i]` topluluğunun **üyeleri** (üye olmayanlara
  göndermez, gönderen hariç)
- `from` eklenir (gönderen userId) — alıcı gözlemci kime ait head gördüğünü
  bilsin
- Saklama yok, doğrulama yok (server sığ sınırı geçer + üyelik kontrolü)

```jsonc
// server → istemciler
{
  "type": "keylog_head",
  "community_id": "c_1",   // tek bir topluluk (broadcast scope'u)
  "id": 42,
  "hash": "abcdef…",
  "from": "u_xyz"          // sunucu ekler
}
```

Sunucu neden her topluluğu ayrı ayrı yayar? Çünkü üyelik scope'a göre değişir
ve relay'i tek scope'ta tutmak sunucunun kitle yayınını kolaylaştırır. Bir
istemci N toplulukta üyeyse N kopya alır (gossip doğası gereği: kanal
kitlesinin TAMAMI'nın görmesi gerekiyor; birleştirme gerekmiyor).

## 3. İstemci tarafı çatışma politikası

CONIKS/Keybase modelinin basitleştirilmiş hali. Gelen `keylog_head` frame'i
için dört durum (bizim head = `myHead`, gelen = `remote`):

| Durum | Koşul | Aksiyon |
|---|---|---|
| 1. eşleşme | `myHead.id === remote.id && myHead.hash === remote.hash` | sessiz (gürültü değil) |
| 2. ileri head (gerideyiz) | `myHead.id < remote.id` | `syncKeyLog` tetikle; eşleşirse sessiz; eşleşmezse bant |
| 3. aynı id farklı hash | `myHead.id === remote.id && myHead.hash !== remote.hash` | **kırmızı bant** (fork / yeniden yazım kanıtı) |
| 4. geride head (biz öndeyiz) | `myHead.id > remote.id` | **kırmızı bant** (fork — gözlemci geride) |

Durum 2 sessiz tetikleme: ağ gecikmesi / çevrimdışı kalma doğal olarak bu
durumu üretir; panik yerine otomatik düzeltme. Durum 2 tetiklemesinden sonra
`syncKeyLog` çelişki dönerse (örn. yeni çekilen sayfa aynı id'de farklı
hash gösterir) → yine bant.

Durum 3 + 4 için **ayrı bant**: `keylogForkWarning` (mevcut `keylogWarning`'ı
GENİŞLETME — iki farklı çelişki türü farklı metin gerektirir; karar
`record_decision`). Metin: "başka bir istemci farklı anahtar defteri head'i
görüyor — sunucu iki kullanıcıya farklı defter gösteriyor olabilir (fork).
Bant dışı damga karşılaştırması ile doğrula."

## 4. Bant (UI)

Mevcut bant altyapısı korunur (Shell.tsx, `keylogWarning` + `dhUpdateWarning`
şablonu). Yeni alan: `securityStore.keylogForkWarning`. 3 bant → aynı görsel
şablon; her biri kendi i18n metnini gösterir (5 dilde parity test'i geçmeli).

## 5. Sunucu invariant

**Sunucu plaintext görmez — değişmez invariant.** `keylog_head` payload'ı
public alanlar (id + hash + community_id) içerir — sunucu bunları zaten
`/keys/log` üzerinden dağıtıyor; yeni sızdırıcı yok. Sunucu:
- Doğrulama yok (id/hash biçim sınırı dışında yorum yok)
- Saklama yok (frame bellek içi, hub'da publish and forget)
- Üyelik kontrolü var (üye olmayan topluluk adını gönderemez)
- Relay scope = üye olduğu topluluklar (üye olmayan almaz)
- `from` her zaman authed userId (sahte atfı engelle)

## 6. Test stratejisi

- **hardening deseni (sunucu invariant)**: `keylog_head` relay şeması —
  üye duyurusu kitleye gider, üye olmayan almaz, sığ sınır dışı düşer,
  payload saklanmaz (DB'de tablo yok, plaintext invariant)
- **birim (client)**: gossip reducer — 4 durum makinesi, çift tetikleme
  yok (a → b → a idempotent), 5dk periyot JIT tetikleme ile
- **senaryo (client)**: iki istemci simülasyonu — alice head X, bob head Y
  → bant; alice head X, bob head X+5 → alice sessiz sync; alice head X,
  bob head X → sessiz
- **negatif (server)**: üye olmayan gönderim reddi; 64-hex dışı hash düşer;
  pozitif olmayan id düşer

## 7. Değişen dosyalar (tahmini)

- `server/src/ws/index.ts` — `keylog_head` relay handler
- `web/src/lib/keygossip.ts` — istemci reducer + periyodik yayın
- `web/src/state/securityStore.ts` — yeni `keylogForkWarning` alanı + flag
- `web/src/ws/socket.ts` / `appStore.ts` — gelen `keylog_head` işleme
- `web/src/i18n/locales/*.ts` — `keylogForkWarning` çevirisi (5 dil)
- `web/src/components/Shell.tsx` — 3. bant render
- `server/test/keygossip.test.ts` — relay invariant
- `web/src/lib/keygossip.test.ts` — client reducer
- `docs/`, `README.md`, `ARCHITECTURE.md`, `CHANGELOG.md` — dokümanlar

## 8. Kapsam dışı (Faz 7+)

- Per-entry kanıt ağacı (CONIKS MAP) — sunucu her entry için ayrı kanıt
  sunmalı; şu an tüm defter indirilip doğrulanıyor (O(N) — binlerce
  kullanıcı için kabul edilebilir)
- Çevrimdışı çatışma çözümü — bant dışı damga karşılaştırması hâlâ
  tek güvenilir yol
- Çoklu cihaz — Faz 7; cihaz başına ayrı gossip pin (kim hangi
  cihazdan ne gördü)
- Sunucu blacklist — kötü sunucu tespit edilince merkezi yayın
