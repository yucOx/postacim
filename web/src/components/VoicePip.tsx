import { useRef, useState } from 'react';
import { Mic, MicOff, PhoneOff, PictureInPicture2, Pin, PinOff, Users, Video, VideoOff } from 'lucide-react';
import { ParticipantTile, RoomContext, useTracks } from '@livekit/components-react';
import { Track } from 'livekit-client';
import type { TrackReference } from '@livekit/components-react';
import { useAppStore } from '../state/appStore';
import { useVoiceStore } from '../state/voiceStore';
import { nickFor } from '../lib/nick';
import { toast } from './Toast';

const NO_PARTICIPANTS: { user_id: string; nick: string }[] = [];

// hangi akış büyük gösterilsin: otomatik (ekran önce) / ekran / kamera
type VidPref = 'auto' | 'screen' | 'camera';
const VID_PREF_KEY = 'postacim.pipVideo';
function loadVidPref(): VidPref {
  try {
    const v = localStorage.getItem(VID_PREF_KEY);
    return v === 'screen' || v === 'camera' ? v : 'auto';
  } catch {
    return 'auto';
  }
}

/** minimized community video call: video stage (screen share first, then
 *  cameras), compact controls and a real browser Picture-in-Picture escape
 *  hatch so the call can float over other windows */
function VideoStage({ wrapRef }: { wrapRef: React.RefObject<HTMLDivElement | null> }): React.ReactNode {
  // onlySubscribed: false — own camera shows too (Discord mini-player style)
  const tracks = useTracks([Track.Source.Camera, Track.Source.ScreenShare], { onlySubscribed: false });
  // livekit v2 disables a camera by MUTING the track — muted refs paint black
  const live = (t: TrackReference): boolean => !!t.publication && !t.publication.isMuted;
  const screens = tracks.filter((t) => t.source === Track.Source.ScreenShare && live(t));
  const cams = tracks.filter((t) => t.source === Track.Source.Camera && live(t));
  // hangisi büyük gösterilsin: otomatik → ekran önce; kullanıcı ekrandan
  // kamera/oto arasında döngüyle seçebilir (Discord odak akışı gibi)
  const [pref, setPref] = useState<VidPref>(loadVidPref);
  const remoteCam = cams.find((t) => !t.participant.isLocal) ?? null;
  const pick =
    pref === 'screen'
      ? (screens[0] ?? remoteCam ?? cams[0] ?? null)
      : pref === 'camera'
        ? (remoteCam ?? cams[0] ?? screens[0] ?? null)
        : (screens[0] ?? remoteCam ?? cams[0] ?? null);
  const cycle = (): void => {
    const next: VidPref = pref === 'auto' ? 'screen' : pref === 'screen' ? 'camera' : 'auto';
    setPref(next);
    try {
      localStorage.setItem(VID_PREF_KEY, next);
    } catch {
      // private mode — session-only
    }
  };
  if (!pick) {
    return (
      <div className="flex h-32 flex-col items-center justify-center bg-night-850 text-paper-500">
        <VideoOff size={16} aria-hidden />
        <span className="mt-1 font-display text-[10px] uppercase tracking-[0.14em]">kamera kapalı</span>
      </div>
    );
  }
  return (
    <div ref={wrapRef} className="relative h-32 overflow-hidden bg-night-850">
      <ParticipantTile
        trackRef={pick}
        className="h-full w-full [&_video]:h-full [&_video]:w-full [&_video]:object-cover [&_.lk-participant-name]:hidden [&_.lk-track-muted-indicator-microphone]:hidden [&_.lk-track-muted-indicator-camera]:hidden"
      />
      <span className="pointer-events-none absolute bottom-1 left-1.5 rounded-sm border border-brass-700/60 bg-night-950/85 px-1.5 py-px font-display text-[10px] font-semibold uppercase tracking-[0.1em] text-paper-50">
        {pick.participant.isLocal ? 'sen' : nickFor(pick.participant.identity)}
      </span>
      {screens.length > 0 && cams.length > 0 && (
        <button
          type="button"
          onClick={cycle}
          className="absolute bottom-1 right-1.5 rounded-sm border border-brass-700/60 bg-night-950/85 px-1.5 py-px font-display text-[10px] font-semibold uppercase tracking-[0.1em] text-paper-50 transition-colors hover:border-lamp-500/70 hover:text-lamp-400"
          title="büyük gösterilecek akışı değiştir (oto → ekran → kamera)"
        >
          {pref === 'auto' ? 'oto' : pref === 'screen' ? 'ekran' : 'kamera'}
        </button>
      )}
    </div>
  );
}

/** the minimized community call — Discord-style corner widget over the chat:
 *  live video stage, mic/cam toggles, room shortcut, hang up, and a real
 *  browser Picture-in-Picture escape hatch (video floats over other apps) */
export default function VoicePip(): React.ReactNode {
  const room = useVoiceStore((s) => s.room);
  const channelId = useVoiceStore((s) => s.joinedChannelId);
  const micOn = useVoiceStore((s) => s.micOn);
  const camOn = useVoiceStore((s) => s.camOn);
  const toggleMic = useVoiceStore((s) => s.toggleMic);
  const toggleCam = useVoiceStore((s) => s.toggleCam);
  const leave = useVoiceStore((s) => s.leave);
  const pipPinned = useVoiceStore((s) => s.pipPinned);
  const setPipPinned = useVoiceStore((s) => s.setPipPinned);
  const selectChannel = useAppStore((s) => s.selectChannel);
  const channel = useAppStore((s) => s.communities.flatMap((c) => c.channels).find((ch) => ch.id === channelId));
  const videoWrapRef = useRef<HTMLDivElement>(null);

  const round = (extra: string): string =>
    `flex h-8 w-8 items-center justify-center rounded-full border transition-colors ${extra}`;

  const enterBrowserPip = async (): Promise<void> => {
    const v = videoWrapRef.current?.querySelector('video');
    if (!v || typeof v.requestPictureInPicture !== 'function') {
      // LAN http (localhost dışı) güvenli bağlam sayılmaz — API orada yok
      toast.error('bu tarayıcıda pencere içi pencere yok — https gerekir');
      return;
    }
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture();
      await v.requestPictureInPicture();
    } catch {
      toast.error('pencere içinde pencere açılamadı');
    }
  };

  if (!channelId) return null;

  return (
    <div
      className={`fixed bottom-4 right-4 w-72 rounded-lg border border-brass-600/70 bg-night-900 shadow-[0_18px_50px_-12px_rgba(0,0,0,0.85)] ${
        pipPinned ? 'z-[60]' : 'z-40'
      }`}
    >
      <div className="flex items-center gap-2 px-3 py-2">
        <Users size={14} className="shrink-0 text-lamp-500" aria-hidden />
        <button
          type="button"
          onClick={() => {
            selectChannel(channelId);
            useAppStore.setState({ view: 'community', activeDmId: null });
          }}
          className="min-w-0 flex-1 truncate text-left font-display text-sm font-semibold uppercase tracking-[0.08em] text-paper-50 transition-colors hover:text-lamp-400"
          title="sesli odaya dön"
        >
          {channel?.name ?? 'sesli oda'}
        </button>
        <button
          type="button"
          onClick={() => setPipPinned(!pipPinned)}
          className={`shrink-0 rounded p-1 transition-colors ${
            pipPinned ? 'text-lamp-400 hover:text-lamp-300' : 'text-paper-500 hover:text-paper-100'
          }`}
          title={pipPinned ? 'pinlemeyi kaldır' : 'en üstte sabitle'}
          aria-label={pipPinned ? 'pinlemeyi kaldır' : 'en üstte sabitle'}
          aria-pressed={pipPinned}
        >
          {pipPinned ? <Pin size={13} /> : <PinOff size={13} />}
        </button>
      </div>
      {room ? (
        <RoomContext.Provider value={room}>
          <VideoStage wrapRef={videoWrapRef} />
        </RoomContext.Provider>
      ) : (
        <div className="flex h-32 items-center justify-center bg-night-850 font-display text-[11px] uppercase tracking-[0.14em] text-paper-500">
          odaya bağlanıyor…
        </div>
      )}
      <div className="flex items-center gap-2 px-3 py-2">
        <button
          type="button"
          onClick={() => void toggleMic()}
          className={round(
            micOn
              ? 'border-brass-600/60 bg-night-700 text-paper-50 hover:border-brass-500'
              : 'border-stamp-500/70 bg-stamp-500 text-white hover:bg-stamp-400',
          )}
          title={micOn ? 'mikrofonu kapat' : 'mikrofonu aç'}
          aria-label={micOn ? 'mikrofonu kapat' : 'mikrofonu aç'}
          aria-pressed={micOn}
        >
          {micOn ? <Mic size={14} /> : <MicOff size={14} />}
        </button>
        <button
          type="button"
          onClick={() => void toggleCam()}
          className={round(
            camOn
              ? 'border-brass-600/60 bg-night-700 text-paper-50 hover:border-brass-500'
              : 'border-stamp-500/70 bg-stamp-500 text-white hover:bg-stamp-400',
          )}
          title={camOn ? 'kamerayı kapat' : 'kamerayı aç'}
          aria-label={camOn ? 'kamerayı kapat' : 'kamerayı aç'}
          aria-pressed={camOn}
        >
          {camOn ? <Video size={14} /> : <VideoOff size={14} />}
        </button>
        <span className="flex-1" aria-hidden />
        <button
          type="button"
          onClick={() => void enterBrowserPip()}
          className={round('border-brass-600/60 bg-night-700 text-paper-50 hover:border-brass-500')}
          title="tarayıcı pencere içinde pencere"
          aria-label="tarayıcı pencere içinde pencere"
        >
          <PictureInPicture2 size={14} />
        </button>
        <button
          type="button"
          onClick={() => void leave()}
          className={round('border-stamp-500/70 bg-stamp-100 text-stamp-400 hover:bg-stamp-500 hover:text-white')}
          title="sesli odadan ayrıl"
          aria-label="sesli odadan ayrıl"
        >
          <PhoneOff size={13} />
        </button>
      </div>
    </div>
  );
}