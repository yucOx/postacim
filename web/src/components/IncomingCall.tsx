import { useEffect, useRef } from 'react';
import { useVoiceStore } from '../state/voiceStore';

// WebAudio ring — no audio files, two-tone pattern like a phone
function useRing(active: boolean): void {
  const ctxRef = useRef<AudioContext | null>(null);
  useEffect(() => {
    if (!active) return;
    const ctx = new AudioContext();
    ctxRef.current = ctx;
    let stopped = false;
    const tone = (freq: number, at: number, dur: number): void => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = freq;
      osc.connect(gain);
      gain.connect(ctx.destination);
      const t = ctx.currentTime + at;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.12, t + 0.02);
      gain.gain.setValueAtTime(0.12, t + dur - 0.05);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.start(t);
      osc.stop(t + dur + 0.05);
    };
    const ring = (): void => {
      tone(440, 0, 0.35);
      tone(480, 0, 0.35);
      tone(440, 0.5, 0.35);
      tone(480, 0.5, 0.35);
    };
    ring();
    const interval = setInterval(() => {
      if (!stopped) ring();
    }, 2000);
    return () => {
      stopped = true;
      clearInterval(interval);
      void ctx.close();
    };
  }, [active]);
}

export default function IncomingCall(): React.ReactNode {
  const callState = useVoiceStore((s) => s.callState);
  const acceptIncoming = useVoiceStore((s) => s.acceptIncoming);
  const declineIncoming = useVoiceStore((s) => s.declineIncoming);
  useRing(callState?.phase === 'incoming');

  if (!callState || callState.phase !== 'incoming') return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center bg-black/40 pt-24">
      <div className="w-80 animate-pulse rounded-2xl border border-neutral-700 bg-neutral-900 p-6 text-center shadow-2xl">
        <div className="text-4xl">📞</div>
        <p className="mt-3 text-lg font-semibold">{callState.fromNick}</p>
        <p className="text-sm text-neutral-500">şifreli arama…</p>
        <div className="mt-5 flex justify-center gap-4">
          <button
            onClick={() => void acceptIncoming().catch(() => {})}
            className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-600 text-xl hover:bg-emerald-500"
            title="kabul"
          >
            ✆
          </button>
          <button
            onClick={() => void declineIncoming()}
            className="flex h-12 w-12 items-center justify-center rounded-full bg-red-600 text-xl hover:bg-red-500"
            title="red"
          >
            ✕
          </button>
        </div>
      </div>
    </div>
  );
}
