import { useCallback, useEffect, useRef } from 'react';
import { RoomContext, useTracks, ParticipantTile } from '@livekit/components-react';
import { Track } from 'livekit-client';
import { Maximize2, PhoneOff } from 'lucide-react';
import { useAppStore } from '../state/appStore';
import { useVoiceStore } from '../state/voiceStore';
import { nickFor } from '../lib/nick';
import { PigeonMark } from './Brand';
import CallControls from './CallControls';

const WIDGET_W = 288; // w-72
const WIDGET_H = 252; // header + tile + controls
const MARGIN = 16;

/** The minimized call — a draggable corner window over the chat, with snap
 *  back to the corner on double-click. Everything underneath stays interactive. */
export default function PiPWidget(): React.ReactNode {
  const room = useVoiceStore((s) => s.room);
  const callState = useVoiceStore((s) => s.callState);
  const setPip = useVoiceStore((s) => s.setPip);
  const cancelCall = useVoiceStore((s) => s.cancelCall);
  const pipPos = useVoiceStore((s) => s.pipPos);
  const setPipPos = useVoiceStore((s) => s.setPipPos);
  const dms = useAppStore((s) => s.dms);

  const ref = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ dx: number; dy: number; pointerId: number } | null>(null);

  const snapToCorner = useCallback((): void => {
    if (typeof window === 'undefined') return;
    setPipPos({ x: window.innerWidth - WIDGET_W - MARGIN, y: window.innerHeight - WIDGET_H - MARGIN });
  }, [setPipPos]);

  // compute effective position: -1 sentinel → snap to bottom-right based on viewport
  const pos =
    pipPos.x < 0 || pipPos.y < 0
      ? { x: window.innerWidth - WIDGET_W - MARGIN, y: window.innerHeight - WIDGET_H - MARGIN }
      : pipPos;

  const clamp = useCallback((x: number, y: number): { x: number; y: number } => {
    const maxX = Math.max(MARGIN, window.innerWidth - WIDGET_W - MARGIN);
    const maxY = Math.max(MARGIN, window.innerHeight - WIDGET_H - MARGIN);
    return {
      x: Math.min(Math.max(MARGIN, x), maxX),
      y: Math.min(Math.max(MARGIN, y), maxY),
    };
  }, []);

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      // ignore drags started on the action buttons
      const tgt = e.target as HTMLElement;
      if (tgt.closest('button')) return;
      ref.current?.setPointerCapture(e.pointerId);
      dragRef.current = { dx: e.clientX - pos.x, dy: e.clientY - pos.y, pointerId: e.pointerId };
    },
    [pos.x, pos.y],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      const d = dragRef.current;
      if (!d || d.pointerId !== e.pointerId) return;
      setPipPos(clamp(e.clientX - d.dx, e.clientY - d.dy));
    },
    [clamp, setPipPos],
  );

  const endDrag = useCallback((e: React.PointerEvent<HTMLElement>) => {
    const d = dragRef.current;
    if (!d || d.pointerId !== e.pointerId) return;
    ref.current?.releasePointerCapture(e.pointerId);
    dragRef.current = null;
  }, []);

  // re-clamp on viewport resize so a dragged widget never gets stranded offscreen
  useEffect(() => {
    const onResize = (): void => {
      const next = clamp(pos.x, pos.y);
      if (next.x !== pipPos.x || next.y !== pipPos.y) setPipPos(next);
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [clamp, pos.x, pos.y, pipPos.x, pipPos.y, setPipPos]);

  if (!callState) return null;
  const peerNick = dms.find((d) => d.id === callState.channelId)?.peer.nick ?? '?';

  return (
    <div
      ref={ref}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onDoubleClick={snapToCorner}
      className="fixed z-40 w-72 cursor-grab select-none overflow-hidden rounded-lg border border-brass-600/70 bg-night-900 shadow-[0_18px_50px_-12px_rgba(0,0,0,0.85)] active:cursor-grabbing"
      style={{ left: pos.x, top: pos.y, touchAction: 'none' }}
    >
      <div className="flex items-center gap-2 border-b border-night-700 px-3 py-2">
        <span className="plate">GÖRÜŞME</span>
        <span className="min-w-0 flex-1 truncate font-display text-sm font-semibold uppercase tracking-[0.08em] text-paper-50">
          {peerNick}
        </span>
        <button
          onClick={() => setPip(false)}
          className="rounded p-1 text-paper-500 transition-colors hover:bg-night-800 hover:text-paper-100"
          title="büyüt"
          aria-label="aramayı büyüt"
        >
          <Maximize2 size={14} />
        </button>
        <button
          onClick={() => void cancelCall()}
          className="rounded p-1 text-paper-500 transition-colors hover:bg-stamp-100 hover:text-stamp-400"
          title="aramayı bitir"
          aria-label="aramayı bitir"
        >
          <PhoneOff size={14} />
        </button>
      </div>
      {!room ? (
        <div className="flex h-40 items-center justify-center text-paper-500">
          <PigeonMark size={22} className="text-brass-600" />
        </div>
      ) : (
        <RoomContext.Provider value={room}>
          <PiPTile />
          <CallControls variant="call" onEnd={() => void cancelCall()} endLabel="bitir" />
        </RoomContext.Provider>
      )}
    </div>
  );
}

/** prefers the remote screen share, then camera; falls back to anything */
function PiPTile(): React.ReactNode {
  const tracks = useTracks([Track.Source.Camera, Track.Source.ScreenShare, Track.Source.Microphone], {
    onlySubscribed: true,
  });
  // muted = camera/screen off (livekit keeps muted tracks published) — those
  // would paint a black tile, drop them and fall through to the waiting state
  const remote = tracks.filter((t) => !t.participant.isLocal && !(t.publication?.isMuted ?? false));
  const pick =
    remote.find((t) => t.source === Track.Source.ScreenShare) ??
    remote.find((t) => t.source === Track.Source.Camera) ??
    remote[0];
  if (!pick) {
    return (
      <div className="flex h-40 flex-col items-center justify-center gap-2 bg-night-850 text-paper-500">
        <PigeonMark size={24} className="text-brass-600" />
        <span className="font-display text-[11px] uppercase tracking-[0.18em]">karşı taraf bekleniyor</span>
      </div>
    );
  }
  return (
    <div className="relative h-40 bg-night-850">
      <ParticipantTile trackRef={pick} className="h-full w-full" />
      <span className="pointer-events-none absolute bottom-1.5 left-1.5 rounded-sm border border-brass-700/60 bg-night-950/85 px-1.5 py-px font-display text-[10px] font-semibold uppercase tracking-[0.1em] text-paper-50">
        {nickFor(pick.participant.identity)}
      </span>
    </div>
  );
}
