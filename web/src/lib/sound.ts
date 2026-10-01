// Bildirim sesleri — MP3 dosyaları (Higgsfield ile üretildi, sessizlik
// kırpılıp -18 LUFS'a normalize edildi). Dosya yoksa WebAudio yedeğine
// düşülür, o da yoksa sessiz kalır (rozet/toast yine görünür).
import { useSettingsStore, type SoundKey } from '../state/settingsStore';

// 'call', 'leave', 'mute', 'unmute' burada YOK: tekrarlayan/kısa tık
// sesleri dosyada değil WebAudio'da sentezleniyor (Higgsfield bu desenleri
// güvenilir üretmedi — leave 2 denemede boş, mute yarı sessiz/uzun çıktı)
const FILES: Partial<Record<SoundKey, string>> = {
  message: '/sounds/msg.mp3',
  mention: '/sounds/mention.mp3',
  invite: '/sounds/invite.mp3',
  friend: '/sounds/friend.mp3',
  join: '/sounds/join.mp3',
};

let ctx: AudioContext | null = null;
const cache = new Map<string, HTMLAudioElement>();

/** master ses seviyesi — bildirimler göze de kulağa da uygun olsun diye
 *  kasten orta bir değerde; kullanıcı tarayıcı ses seviyesinden ayarlar */
const volume = 0.7;

/** Olay başına kazanç yok: tüm dosyalar üretim sonrası -18 LUFS'a
 *  normalize edildiği için çalma seviyesi tek yerden (volume) yeter. */


function getAudio(key: SoundKey): HTMLAudioElement | null {
  if (typeof Audio === 'undefined') return null;
  const url = FILES[key];
  if (!url) return null; // 'call' dosyasız — playSound onu zil Burst'ına yollar
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

const FALLBACK: Partial<Record<SoundKey, { freqs: number[]; step: number; dur: number; peak: number }>> = {
  message: { freqs: [659.25, 880], step: 0.1, dur: 0.35, peak: 0.12 },
  mention: { freqs: [880, 1108.73], step: 0.09, dur: 0.45, peak: 0.18 },
  invite: { freqs: [587.33, 783.99, 1046.5], step: 0.11, dur: 0.3, peak: 0.14 },
  friend: { freqs: [523.25, 659.25, 783.99], step: 0.1, dur: 0.28, peak: 0.14 },
  join: { freqs: [523.25, 783.99], step: 0.07, dur: 0.22, peak: 0.12 },
  leave: { freqs: [783.99, 523.25], step: 0.07, dur: 0.25, peak: 0.12 },
  mute: { freqs: [349.23], step: 0.05, dur: 0.12, peak: 0.12 },
  unmute: { freqs: [523.25], step: 0.05, dur: 0.12, peak: 0.12 },
};

/** tek seferlik ses çalar. `force` = ayarlarda önizleme düğmesi:
 *  kapalı bir kategoriyi de duyurur, yoksa "neden önizleme çalmıyor"
 *  sorusu kalır. Gerçek bildirimlerde force yoktur. */
export function playSound(key: SoundKey, force = false): void {
  const s = useSettingsStore.getState();
  if (!force && (!s.soundOn || !s.soundKeys[key])) return;
  // zil dosyası yok — tek seferlik önizlemede de aynı vuruş çalar
  if (key === 'call') {
    ringBurst();
    return;
  }
  const el = getAudio(key);
  const f = FALLBACK[key];
  if (!f) return;
  if (!el) {
    fallbackTone(f.freqs, f.step, f.dur, f.peak);
    return;
  }
  el.currentTime = 0;
  el.volume = volume;
  el.play().catch(() => {
    // autoplay engellendi ya da dosya 404 — yedeğe düş
    fallbackTone(f.freqs, f.step, f.dur, f.peak);
  });
}

// --- Gelen arama zili — DOSYASIZ, WebAudio ile sentezlenir ---
// Neden MP3 değil: Higgsfield'in ürettiği "ringtone" dosyaları klasik zil
// desenini vermiyordu (ölçüldü: 4 sn'de 3.45 sn sessizlik, tek bir tık).
// Zil tekrarlayan bir desen olduğu için WebAudio hem doğru deseni verir
// hem dosya/izin sorunu yaşatmaz. Klasik zil: iki kısa bip, ara boşluk.

let ringTimer: ReturnType<typeof setInterval> | null = null;

/** tek bir "bip çifti" — iki aynı nota, kısa aralıkla */
function ringBurst(): void {
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
    const t0 = ctx.currentTime;
    // üç nota: iki hızlı + biraz gecikmiş üçüncü — "tık-tık-tık" hissi
    const notes: [number, number][] = [
      [880, 0], // A5
      [660, 0.16], // E5
      [880, 0.32], // A5 — biraz daha yumuşak
    ];
    for (const [freq, at] of notes) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, t0 + at);
      gain.gain.exponentialRampToValueAtTime(0.16 * volume, t0 + at + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + at + 0.28);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t0 + at);
      osc.stop(t0 + at + 0.32);
    }
  } catch {
    // audio blocked until first user gesture — modal/rozet yine görünür
  }
}

function ringOnce(): void {
  const s = useSettingsStore.getState();
  if (!s.soundOn || !s.soundKeys.call) return;
  ringBurst();
}

export function startRing(): void {
  stopRing();
  if (!useSettingsStore.getState().soundOn || !useSettingsStore.getState().soundKeys.call) return;
  ringOnce();
  // 1.6 sn'de bir: iki vuruş çalıp ~1.1 sn dinlenir, sonra yine — klasik
  // telefon zilinin ritmi (bunu çok hızlı yapmak "alarm" gibi duyuluyor)
  ringTimer = setInterval(ringOnce, 1600);
}

export function stopRing(): void {
  if (ringTimer !== null) {
    clearInterval(ringTimer);
    ringTimer = null;
  }
  // zil WebAudio ile sentezleniyor: timer durunca yeni vuruş gelmez, ama
  // başlamış bir vuruşun kuyruğu ~0.3 sn sürer. Durdurmak zorunda değil
  // (susturulmuş bir çağrıda son vuruş bitene kadar duyulması normal).
}
