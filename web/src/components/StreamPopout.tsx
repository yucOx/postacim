import { useState } from 'react';
import { RoomContext, useTracks, ParticipantTile } from '@livekit/components-react';
import { Track } from 'livekit-client';
import { Maximize2, X } from 'lucide-react';
import { useVoiceStore } from '../state/voiceStore';
import { nickFor } from '../lib/nick';
import { PigeonMark } from './Brand';

/** Discord-style corner pop-out for an incoming remote screen share.
 *  Always visible while a peer is sharing (even before the viewer clicks
 *  anything) — the frame is the affordance, the contents are the preview.
 *  Click "izle" to elevate the share to the main stage; click "kapat" or
 *  the × to dismiss (the stream is not stopped, only the preview is
 *  hidden until the next time the viewer opens it via the stage). */
export default function StreamPopout(): React.ReactNode {
  const room = useVoiceStore((s) => s.room);
  const watchingStream = useVoiceStore((s) => s.watchingStream);
  const setWatchingStream = useVoiceStore((s) => s.setWatchingStream);
  // local dismiss state — viewer's choice not to show the pop-out right now
  const [dismissed, setDismissed] = useState(false);

  if (!room) return null;
  return <Popout room={room} />;
}

function Popout({ room }: { room: NonNullable<ReturnType<typeof useVoiceStore.getState>['room']> }): React.ReactNode {
  const watchingStream = useVoiceStore((s) => s.watchingStream);
  const setWatchingStream = useVoiceStore((s) => s.setWatchingStream);
  const [dismissed, setDismissed] = useState(false);
  // uzak ekran paylaşımları (kendi paylaşımın gözükmez)
  const tracks = useTracks([Track.Source.ScreenShare], { onlySubscribed: true });
  const remoteScreens = tracks.filter((t) => !t.participant.isLocal && !(t.publication?.isMuted ?? false));
  if (remoteScreens.length === 0) return null;
  if (dismissed) return null;

  // izlenen paylaşım önde; yoksa ilk uzak paylaşım
  const active = remoteScreens.find((t) => t.participant.identity === watchingStream) ?? remoteScreens[0];
  if (!active) return null;
  const sharer = active.participant.identity;

  return (
    <div className="fixed bottom-4 right-4 z-40 w-80 select-none overflow-hidden rounded-lg border border-brass-600/70 bg-night-900 shadow-[0_18px_50px_-12px_rgba(0,0,0,0.85)]">
      <div className="flex items-center gap-2 border-b border-night-700 px-3 py-2">
        <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-stamp-500" aria-hidden />
        <span className="plate !text-[10px]">CANLI YAYIN</span>
        <span className="min-w-0 flex-1 truncate font-display text-sm font-semibold uppercase tracking-[0.08em] text-paper-50">
          {nickFor(sharer)}
        </span>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          className="shrink-0 rounded p-1 text-paper-500 transition-colors hover:bg-night-800 hover:text-paper-100"
          title="kapat"
          aria-label="yayın pop-out'unu kapat"
        >
          <X size={14} />
        </button>
      </div>
      <div className="relative aspect-video bg-night-850">
        <ParticipantTile
          trackRef={active}
          className="h-full w-full [&_video]:h-full [&_video]:w-full [&_video]:object-contain"
        />
        {/* pop-out zaten border'lı, içeriğin altında ince bir iç çerçeve
            (Discord mini player: kare çerçeve + içerik eşit sınırlar) */}
        <span className="pointer-events-none absolute inset-0 rounded-sm ring-1 ring-inset ring-brass-700/30" />
      </div>
      <div className="flex items-center gap-2 border-t border-night-700 bg-night-900/70 px-3 py-2">
        <button
          type="button"
          onClick={() => {
            setDismissed(false);
            setWatchingStream(sharer);
          }}
          className="flex flex-1 items-center justify-center gap-1.5 rounded border border-lamp-500/70 bg-lamp-100/60 px-2 py-1 text-xs font-semibold text-lamp-300 transition-colors hover:bg-lamp-500 hover:text-night-950"
          title="yayını ana sahneye al"
        >
          <Maximize2 size={13} />
          izle
        </button>
        {watchingStream === sharer && (
          <button
            type="button"
            onClick={() => setWatchingStream(null)}
            className="rounded border border-night-700 px-2 py-1 text-xs text-paper-300 transition-colors hover:text-paper-100"
            title="izlemeyi bırak"
          >
            izlemeyi bırak
          </button>
        )}
      </div>
    </div>
  );
}
