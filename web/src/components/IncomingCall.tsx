import { useEffect, useRef } from 'react';
import { Phone, X } from 'lucide-react';
import { useVoiceStore } from '../state/voiceStore';
import { PigeonMark } from './Brand';

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
    <div className="fixed inset-0 z-[60] flex items-start justify-center bg-night-950/50 px-4 pt-20">
      <div className="animate-seal-in w-80 rounded-lg border border-brass-600/80 bg-night-900 p-6 text-center shadow-[0_24px_70px_-12px_rgba(0,0,0,0.9)]">
        <div className="relative mx-auto flex h-16 w-16 items-center justify-center">
          <span className="absolute inset-0 animate-ping rounded-full border border-lamp-600/50" aria-hidden />
          <span className="text-lamp-500">
            <PigeonMark size={30} />
          </span>
        </div>
        <p className="plate mt-4">GELEN GÖRÜŞME</p>
        <p className="mt-1 font-display text-xl font-semibold uppercase tracking-[0.08em] text-paper-50">
          {callState.fromNick}
        </p>
        <p className="mt-0.5 text-xs text-paper-500">şifreli hat — uçtan uca</p>
        <div className="mt-5 flex justify-center gap-4">
          <button
            onClick={() => void declineIncoming()}
            className="flex h-12 w-12 items-center justify-center rounded-full border border-stamp-500/70 bg-stamp-100 text-stamp-400 transition-colors hover:bg-stamp-500 hover:text-white"
            title="reddet"
            aria-label="aramayı reddet"
          >
            <X size={19} />
          </button>
          <button
            onClick={() => void acceptIncoming().catch(() => {})}
            className="flex h-12 w-12 items-center justify-center rounded-full bg-lamp-500 text-night-950 transition-colors hover:bg-lamp-400"
            title="kabul et"
            aria-label="aramayı kabul et"
          >
            <Phone size={19} />
          </button>
        </div>
      </div>
    </div>
  );
}
