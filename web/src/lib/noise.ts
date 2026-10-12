// Dummy trafik — metadata zamanlama gizlemesi: gerçek mesajların gönderim
// anını gürültüye gömmek için, giriş yapmış istemci arada rastgele boyutta
// anlamsız blob POST eder. Sunucu saklamaz (yalnız 204); istemci de
// hatayı sessizce yutar — gürültü asla kullanıcıya görünmez.
import { api } from '../api/client';
import { b64, randomBytes } from '../crypto/bytes';
import { useAuthStore } from '../state/authStore';

// üst kuyruklu gecikme: 1 dk taban + üstel rastgele (≈3 dk ort., 9 dk'da
// kırpılır) → toplam 1–10 dk arası, seyrek uzun boşluklar da mümkün
function nextDelayMs(): number {
  const exp = -Math.log(1 - Math.random()) * 180_000;
  return 60_000 + Math.min(exp, 540_000);
}

export function startNoise(): () => void {
  // giriş yoksa hiç başlama (Shell zaten yalnız authed mount olur)
  if (!useAuthStore.getState().user) return () => {};
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const tick = (): void => {
    if (stopped) return;
    // oturum düştüyse (logout) artık zamanlama sızıntısı yaratma
    if (!useAuthStore.getState().user) return;
    // 32..4096 rastgele byte → base64 → tek alan; hata sessiz
    const len = 32 + Math.floor(Math.random() * 4065);
    void api('/noise', { method: 'POST', body: { b: b64(randomBytes(len)) } }).catch(() => {
      /* gürültü — hata görülmez */
    });
    timer = setTimeout(tick, nextDelayMs());
  };
  timer = setTimeout(tick, nextDelayMs());
  return () => {
    stopped = true;
    if (timer !== undefined) clearTimeout(timer);
  };
}
