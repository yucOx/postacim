// Bildirim sesleri — MP3 dosyaları (Higgsfield ile üretildi, sessizlik
// kırpılıp -18 LUFS'a normalize edildi). Dosya yoksa WebAudio yedeğine
// düşülür, o da yoksa sessiz kalır (rozet/toast yine görünür).
import { useSettingsStore, type SoundKey } from '../state/settingsStore';

const FILES: Record<SoundKey, string> = {
  message: '/sounds/msg.mp3',
  mention: '/sounds/mention.mp3',
  call: '/sounds/ring.mp3',
  invite: '/sounds/invite.mp3',
  friend: '/sounds/friend.mp3',
};

let ctx: AudioContext | null = null;
const cache = new Map<string, HTMLAudioElement>();

/** master ses seviyesi — bildirimler göze de kulağa da uygun olsun diye
 *  kasten orta bir değerde; kullanıcı tarayıcı ses seviyesinden ayarlar */
const volume = 0.7;

function getAudio(key: SoundKey): HTMLAudioElement | null {
  if (typeof Audio === 'undefined') return null;
  const url = FILES[key];
  let el = cache.get(url);
  if (!el) {
    el = new Audio(url);
    el.preload = 'auto';
    el.volume = volume;
    cache.set(url, el);
  }
  return el;
}

// --- WebAudio yedeği (dosya yüklenemezse) ---

function fallbackTone(freqs: number[], step: number, dur: number, peak: number): void {
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
    const t0 = ctx.currentTime;
    freqs.forEach((freq, i) => {
      const osc = ctx!.createOscillator();
      const gain = ctx!.createGain();
      const at = t0 + i * step;
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(peak * volume, at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + dur);
      osc.connect(gain);
      gain.connect(ctx!.destination);
      osc.start(at);
      osc.stop(at + dur + 0.05);
    });
  } catch {
    // audio blocked until first user gesture — the toast/badge still shows
  }
}

const FALLBACK: Record<SoundKey, { freqs: number[]; step: number; dur: number; peak: number }> = {
  message: { freqs: [659.25, 880], step: 0.1, dur: 0.35, peak: 0.12 },
  mention: { freqs: [880, 1108.73], step: 0.09, dur: 0.45, peak: 0.18 },
  call: { freqs: [783.99, 783.99], step: 0.18, dur: 0.22, peak: 0.14 },
  invite: { freqs: [587.33, 783.99, 1046.5], step: 0.11, dur: 0.3, peak: 0.14 },
  friend: { freqs: [523.25, 659.25, 783.99], step: 0.1, dur: 0.28, peak: 0.14 },
};

/** tek seferlik ses çalar. `force` = ayarlarda önizleme düğmesi:
 *  kapalı bir kategoriyi de duyurur, yoksa "neden önizleme çalmıyor"
 *  sorusu kalır. Gerçek bildirimlerde force yoktur. */
export function playSound(key: SoundKey, force = false): void {
  const s = useSettingsStore.getState();
  if (!force && (!s.soundOn || !s.soundKeys[key])) return;
  const el = getAudio(key);
  if (!el) {
    const f = FALLBACK[key];
    fallbackTone(f.freqs, f.step, f.dur, f.peak);
    return;
  }
  el.currentTime = 0;
  el.volume = volume;
  el.play().catch(() => {
    // autoplay engellendi ya da dosya 404 — yedeğe düş
    const f = FALLBACK[key];
    fallbackTone(f.freqs, f.step, f.dur, f.peak);
  });
}

// --- Gelen arama zili: ring.mp3 döngüde, stopRing() ile kesilir ---

let ringTimer: ReturnType<typeof setInterval> | null = null;

function ringOnce(): void {
  const s = useSettingsStore.getState();
  if (!s.soundOn || !s.soundKeys.call) return;
  const el = getAudio('call');
  if (!el) {
    fallbackTone(FALLBACK.call.freqs, FALLBACK.call.step, FALLBACK.call.dur, FALLBACK.call.peak);
    return;
  }
  el.currentTime = 0;
  el.volume = volume;
  el.play().catch(() => {
    fallbackTone(FALLBACK.call.freqs, FALLBACK.call.step, FALLBACK.call.dur, FALLBACK.call.peak);
  });
}

export function startRing(): void {
  stopRing();
  if (!useSettingsStore.getState().soundOn || !useSettingsStore.getState().soundKeys.call) return;
  ringOnce();
  ringTimer = setInterval(ringOnce, 3200);
}

export function stopRing(): void {
  if (ringTimer !== null) {
    clearInterval(ringTimer);
    ringTimer = null;
  }
  // çalan örnek varsa durdur — yeni çağrı başlamadan eskisi susmaz
  cache.get(FILES.call)?.pause();
}
