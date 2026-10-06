import { useCallback, useEffect, useRef, useState } from 'react';
import { RoomContext, useTracks, useSpeakingParticipants, ParticipantTile } from '@livekit/components-react';
import { Track } from 'livekit-client';
import type { Participant } from 'livekit-client';
import { ChevronDown, ChevronUp, Maximize2, Mic, MicOff, PhoneOff, PictureInPicture2, Pin, PinOff, Video, VideoOff, Volume2, VolumeX } from 'lucide-react';
import { useT } from '../i18n/I18nProvider';
import { useAppStore } from '../state/appStore';
import { useAuthStore } from '../state/authStore';
import { useVoiceStore } from '../state/voiceStore';
import { nickFor } from '../lib/nick';
import { useSafeIsSpeaking } from '../lib/speaking';
import Avatar from './Avatar';

const WIDGET_W_NORMAL = 310;
const WIDGET_W_LARGE = 460;
const MARGIN = 16;
const PIP_SIZE_KEY = 'postacim.pipSize';

/** The minimized call — a draggable corner window over the chat, with snap
 *  back to the corner on double-click. Everything underneath stays interactive. */
export default function PiPWidget(): React.ReactNode {
  const { t } = useT();
  const room = useVoiceStore((s) => s.room);
  const isDmCall = useVoiceStore((s) => s.isDmCall);
  const callState = useVoiceStore((s) => s.callState);
  const joinedVoiceChannel = useVoiceStore((s) => s.joinedChannelId);
  const setPip = useVoiceStore((s) => s.setPip);
  const cancelCall = useVoiceStore((s) => s.cancelCall);
  const leave = useVoiceStore((s) => s.leave);
  const pipPos = useVoiceStore((s) => s.pipPos);
  const setPipPos = useVoiceStore((s) => s.setPipPos);
  const pipPinned = useVoiceStore((s) => s.pipPinned);
  const setPipPinned = useVoiceStore((s) => s.setPipPinned);
  const dms = useAppStore((s) => s.dms);
  const selectChannel = useAppStore((s) => s.selectChannel);
  const setPopoutOpen = useVoiceStore((s) => s.setPopoutOpen);
  const channel = useAppStore((s) => s.communities.flatMap((c) => c.channels).find((ch) => ch.id === joinedVoiceChannel));

  const [expanded, setExpanded] = useState(() => {
    try {
      return localStorage.getItem(PIP_SIZE_KEY) === 'large';
    } catch {
      return false;
    }
  });

  const toggleExpanded = (): void => {
    const next = !expanded;
    setExpanded(next);
    try {
      localStorage.setItem(PIP_SIZE_KEY, next ? 'large' : 'normal');
    } catch {
      // ignore
    }
  };

  const widgetWidth = expanded ? WIDGET_W_LARGE : WIDGET_W_NORMAL;
  const widgetHeight = expanded ? 360 : 260;

  const ref = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ dx: number; dy: number; pointerId: number } | null>(null);

  const snapToCorner = useCallback((): void => {
    if (typeof window === 'undefined') return;
    setPipPos({ x: window.innerWidth - widgetWidth - MARGIN, y: window.innerHeight - widgetHeight - MARGIN });
  }, [setPipPos, widgetWidth, widgetHeight]);

  // compute effective position: -1 sentinel → snap to bottom-right based on viewport
  const pos =
    pipPos.x < 0 || pipPos.y < 0
      ? { x: Math.max(0, (typeof window !== 'undefined' ? window.innerWidth : 1000) - widgetWidth - MARGIN), y: Math.max(0, (typeof window !== 'undefined' ? window.innerHeight : 800) - widgetHeight - MARGIN) }
      : pipPos;

  const clamp = useCallback((x: number, y: number): { x: number; y: number } => {
    const maxX = Math.max(0, window.innerWidth - widgetWidth - MARGIN);
    const maxY = Math.max(0, window.innerHeight - widgetHeight - MARGIN);
    return {
      x: Math.min(Math.max(0, x), maxX),
      y: Math.min(Math.max(0, y), maxY),
    };
  }, [widgetWidth, widgetHeight]);

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      // ignore drags started on action buttons
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
      if (pipPos.x < 0 || pipPos.y < 0) return;
      const next = clamp(pos.x, pos.y);
      if (next.x !== pipPos.x || next.y !== pipPos.y) setPipPos(next);
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [clamp, pos.x, pos.y, pipPos.x, pipPos.y, setPipPos]);

  if (!isDmCall && !joinedVoiceChannel) return null;
  if (isDmCall && !callState) return null;

  const title = isDmCall
    ? dms.find((d) => d.id === callState?.channelId)?.peer.nick ?? '?'
    : channel?.name ?? t('pip.roomName');

  const onMaximize = (): void => {
    setPip(false);
    if (isDmCall && callState) {
      useAppStore.getState().openDmChat(callState.channelId);
      useAppStore.setState({ view: 'dm' });
    } else if (!isDmCall && joinedVoiceChannel) {
      selectChannel(joinedVoiceChannel);
      useAppStore.setState({ view: 'community', activeDmId: null });
    }
  };

  const onHangUp = (): void => {
    if (isDmCall) void cancelCall();
    else void leave();
  };

  return (
    <div
      ref={ref}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onDoubleClick={snapToCorner}
      className={`fixed cursor-grab select-none overflow-hidden rounded-xl border border-brass-600/70 bg-night-950 shadow-[0_20px_60px_-15px_rgba(0,0,0,0.9)] transition-all duration-200 active:cursor-grabbing ${
        pipPinned ? 'z-[60]' : 'z-40'
      } ${expanded ? 'w-[460px]' : 'w-[310px]'}`}
      style={{ left: pos.x, top: pos.y, touchAction: 'none' }}
    >
      <div className="flex items-center gap-2 border-b border-night-700 bg-night-900/80 px-3 py-2">
        <span className="plate !text-[10px]">{isDmCall ? t('call.plate') : t('pip.roomName')}</span>
        <span className="min-w-0 flex-1 truncate font-display text-sm font-semibold uppercase tracking-[0.08em] text-paper-50">
          {title}
        </span>
        {/* sabitle — widget modal/menülerin (z-50) de üstünde kalır */}
        <button
          onClick={() => setPipPinned(!pipPinned)}
          className={`rounded p-1 transition-colors ${
            pipPinned ? 'text-lamp-400 hover:text-lamp-300' : 'text-paper-400 hover:bg-night-800 hover:text-paper-100'
          }`}
          title={pipPinned ? t('pip.unpin') : t('pip.pinTop')}
          aria-label={pipPinned ? t('pip.unpin') : t('pip.pinTop')}
          aria-pressed={pipPinned}
        >
          {pipPinned ? <Pin size={15} /> : <PinOff size={15} />}
        </button>
        {/* Discord tarzı pencere boyutunu büyütüp küçültme butonu */}
        <button
          onClick={toggleExpanded}
          className="rounded p-1 text-paper-400 transition-colors hover:bg-night-800 hover:text-paper-100"
          title={expanded ? 'Pencereyi küçült (310px)' : 'Pencereyi büyüt (460px)'}
          aria-label={expanded ? 'Pencereyi küçült' : 'Pencereyi büyüt'}
        >
          {expanded ? <ChevronDown size={15} /> : <ChevronUp size={15} />}
        </button>
        {/* her şeyin üstünde ayrı pencere (Document PiP) — CallPopout */}
        <button
          onClick={() => setPopoutOpen(true)}
          className="rounded p-1 text-paper-400 transition-colors hover:bg-night-800 hover:text-paper-100"
          title={t('pip.popout')}
          aria-label={t('pip.popoutAria')}
        >
          <PictureInPicture2 size={15} />
        </button>
        <button
          onClick={onMaximize}
          className="rounded p-1 text-paper-400 transition-colors hover:bg-night-800 hover:text-paper-100"
          title={t('pip.maximize')}
          aria-label={t('pip.maximizeAria')}
        >
          <Maximize2 size={15} />
        </button>
        <button
          onClick={onHangUp}
          className="rounded p-1 text-paper-400 transition-colors hover:bg-stamp-100 hover:text-stamp-400"
          title={t('pip.endCall')}
          aria-label={t('pip.endCallAria')}
        >
          <PhoneOff size={15} />
        </button>
      </div>
      {!room ? (
        <div className={`flex ${expanded ? 'h-64' : 'h-44'} flex-col items-center justify-center gap-2 text-paper-500`}>
          <Avatar userId={callState?.channelId ?? joinedVoiceChannel ?? ''} label={title} size={48} />
        </div>
      ) : (
        <RoomContext.Provider value={room}>
          <PiPStage expanded={expanded} />
          <PiPControls onEnd={onHangUp} />
        </RoomContext.Provider>
      )}
    </div>
  );
}

/** Discord tarzı PiP sahnesi:
 *  - Ana ekranda konuşan kişi (veya karşı tarafın ekranı/kamerası/avatarı)
 *  - Sağ alt köşede küçük pencere (bizim kendi kameramız veya avatarımız)
 *  CallPopout da kullanır — className verilirse yükseklik onunla ezilir.
 */
export function PiPStage({ expanded, className }: { expanded?: boolean; className?: string }): React.ReactNode {
  const tracks = useTracks([Track.Source.Camera, Track.Source.ScreenShare], {
    onlySubscribed: false,
  });
  const speaking = useSpeakingParticipants();
  const isDmCall = useVoiceStore((s) => s.isDmCall);
  const callState = useVoiceStore((s) => s.callState);
  const joinedVoiceChannel = useVoiceStore((s) => s.joinedChannelId);
  const peerId = (isDmCall ? callState?.channelId : joinedVoiceChannel) ?? '';

  // 1. Ana görünüm: Konuşan katılımcı varsa onun kamerası, yoksa ekran paylaşımı -> kamera -> avatar
  const remoteTracks = tracks.filter((t) => !t.participant.isLocal && !(t.publication?.isMuted ?? false));
  const activeRemoteSpeaker = speaking.find((p) => !p.isLocal);
  const speakerTrack = activeRemoteSpeaker
    ? remoteTracks.find((t) => t.participant.identity === activeRemoteSpeaker.identity)
    : undefined;

  const pick =
    speakerTrack ??
    remoteTracks.find((t) => t.source === Track.Source.ScreenShare) ??
    remoteTracks.find((t) => t.source === Track.Source.Camera) ??
    remoteTracks[0];

  const mainParticipant = pick?.participant;
  const isMainSpeaking = useSafeIsSpeaking(mainParticipant);

  // 2. Kendi küçük penceremiz (Discord self-view inset)
  const localCamTrack = tracks.find((t) => t.participant.isLocal && t.source === Track.Source.Camera && !(t.publication?.isMuted ?? false));
  const user = useAuthStore((s) => s.user);
  const isSelfSpeaking = useSafeIsSpeaking(useVoiceStore((s) => s.room?.localParticipant as Participant | undefined));

  return (
    <div className={`relative ${className ?? (expanded ? 'h-64' : 'h-44')} w-full overflow-hidden bg-night-900 flex items-center justify-center transition-all duration-200`}>
      {/* Ana büyük pencere (Karşı taraf / Konuşan) */}
      {pick ? (
        <div className={`relative h-full w-full ${isMainSpeaking ? 'ring-2 ring-emerald-500 shadow-[0_0_12px_rgba(16,185,129,0.45)]' : ''}`}>
          <ParticipantTile trackRef={pick} className="h-full w-full [&_video]:h-full [&_video]:w-full [&_video]:object-contain" />
          <span className="pointer-events-none absolute bottom-1.5 left-1.5 rounded-sm border border-brass-700/60 bg-night-950/85 px-1.5 py-px font-display text-[10px] font-semibold uppercase tracking-[0.1em] text-paper-50">
            {nickFor(pick.participant.identity)}
          </span>
        </div>
      ) : (
        <div className={`flex h-full w-full flex-col items-center justify-center gap-2 bg-night-850 ${isMainSpeaking ? 'ring-2 ring-emerald-500' : ''}`}>
          <Avatar userId={peerId} label={nickFor(peerId)} size={expanded ? 64 : 52} srcOverride={null} />
          <span className="font-display text-[11px] uppercase tracking-[0.14em] text-paper-300">{nickFor(peerId)}</span>
        </div>
      )}

      {/* Bizim küçük penceremiz (Discord tarzı sağ alt köşe inset) */}
      <div
        className={`absolute bottom-2 right-2 ${expanded ? 'h-20 w-28' : 'h-14 w-20'} overflow-hidden rounded-md border bg-night-950 shadow-lg transition-all ${
          isSelfSpeaking ? 'border-emerald-500 ring-2 ring-emerald-500' : 'border-brass-700/60'
        }`}
      >
        {localCamTrack ? (
          <ParticipantTile
            trackRef={localCamTrack}
            className="h-full w-full [&_video]:h-full [&_video]:w-full [&_video]:object-cover"
          />
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center bg-night-850">
            {user && <Avatar userId={user.id} label={user.nick} size={expanded ? 32 : 24} srcOverride={user.avatar_updated_at ? undefined : null} />}
            <span className="font-display text-[8px] uppercase tracking-wider text-paper-400">sen</span>
          </div>
        )}
      </div>
    </div>
  );
}

/** Discord tarzı şık ve kompakt PiP kontrol çubuğu */
export function PiPControls({ onEnd }: { onEnd: () => void }): React.ReactNode {
  const { t } = useT();
  const micOn = useVoiceStore((s) => s.micOn);
  const camOn = useVoiceStore((s) => s.camOn);
  const deafened = useVoiceStore((s) => s.deafened);
  const volume = useVoiceStore((s) => s.volume);
  const toggleMic = useVoiceStore((s) => s.toggleMic);
  const toggleCam = useVoiceStore((s) => s.toggleCam);
  const toggleDeafen = useVoiceStore((s) => s.toggleDeafen);

  const btnClass = (active: boolean, danger = false) =>
    `flex h-9 w-9 items-center justify-center rounded-full border transition-all ${
      danger
        ? 'border-stamp-500 bg-stamp-500 text-white hover:bg-stamp-400'
        : active
          ? 'border-brass-600/60 bg-night-800 text-paper-100 hover:border-brass-500 hover:bg-night-700'
          : 'border-stamp-500/70 bg-stamp-100 text-stamp-400 hover:bg-stamp-500 hover:text-white'
    }`;

  return (
    <div className="flex items-center justify-center gap-3 border-t border-night-700 bg-night-900 px-3 py-2">
      <button
        type="button"
        onClick={() => void toggleMic()}
        className={btnClass(micOn)}
        title={micOn ? t('call.micOn') : t('call.micOff')}
        aria-label={micOn ? t('call.micOn') : t('call.micOff')}
      >
        {micOn ? <Mic size={15} /> : <MicOff size={15} />}
      </button>
      <button
        type="button"
        onClick={() => void toggleCam()}
        className={btnClass(camOn)}
        title={camOn ? t('call.camOn') : t('call.camOff')}
        aria-label={camOn ? t('call.camOn') : t('call.camOff')}
      >
        {camOn ? <Video size={15} /> : <VideoOff size={15} />}
      </button>
      <button
        type="button"
        onClick={toggleDeafen}
        className={btnClass(!deafened, deafened)}
        title={deafened ? t('stream.unmute') : t('stream.mute')}
        aria-label={deafened ? t('stream.unmute') : t('stream.mute')}
      >
        {deafened || volume === 0 ? <VolumeX size={15} /> : <Volume2 size={15} />}
      </button>
      <button
        type="button"
        onClick={onEnd}
        className="flex h-9 w-9 items-center justify-center rounded-full bg-stamp-500 text-white transition-colors hover:bg-stamp-400 shadow"
        title={t('call.end')}
        aria-label={t('call.end')}
      >
        <PhoneOff size={15} />
      </button>
    </div>
  );
}
