# 2026-11-18 UI/UX denetimi ve düzeltme paketi

4 subagent denetimi (modallar, arama UI, sohbet, state/yasam dongusu) → ~30 hata düzeltildi, 5 commit push edildi (4062793, a315ada, 73f6248, 0d2335d + ilk sohbet paketi). Build + 339 test yeşil.

## Kalıcı kurallar (CCE record_decision'a da yazıldı)
- Katman sırası: data-incoming-call (z-60) > Modal stack (z-50) > StreamWindow (z-40); Modal.tsx export'ları hasOpenModal/isInTopModal; backdrop kapatma pointerdown-kökenli
- wire()/wireEvents() unsub döndürür; Shell toplar
- wire() içinde yan etkili kurulum return'den ÖNCE (gossip kaydı vakası)
- App.tsx: Shell dışındayken voiceStore.teardownAll()
- 401 (/auth/* hariç) + WS 4003 → authStore.expireSession()
- Gizli sekmede aktif kanala gelen mesaj bildirir (visibilityState guard)

## Kalan (bilinçli olarak yapılmadı)
- ServerRail gizle-X touch'ta yok (uzun basış contextmenu ile gizlenebilir, iOS hariç)
- markRead gizli sekmede yine okur (bildirim gider ama unread 0 kalır) — Discord benzeri davranış için visibilitychange listener'lı mark-read gerekir
- popout'ta toast'lar iki pencerede de gösterilir (aynı store)
- HoverActions coarse-pointer'da her satırda görünür (kalabalık ama erişilebilir)

## i18n dil sızıntısı + deploy (aynı gün)
- Sunucu 108 hata mesajı Türkçe döner → web/src/lib/serverMsg.ts çeviri tablosu (api() katmanında), 42 gösterim noktası dokunulmadan çözüldü; istemci throw'ları sarıldı; UI'da kalan 4 sabit metin t()'ye bağlandı (commit 106c38d)
- Deploy (lokal): server 4000 ✓, web 8081 ✓ (8080 = gui.py çakışması, .env WEB_PORT=8081), livekit ✓ — livekit/livekit.yaml boş dizindi (Docker bind-mount tuzağı), example'dan lokal config yazıldı (use_external_ip: false). .env ve livekit.yaml gitignored — VPS'te WEB_PORT 8080 kalır
