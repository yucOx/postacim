import { RoomContext, useTracks, ParticipantTile } from '@livekit/components-react';
import { Track } from 'livekit-client';
import { Maximize2, PhoneOff } from 'lucide-react';
import { useAppStore } from '../state/appStore';
import { useVoiceStore } from '../state/voiceStore';
import { nickFor } from '../lib/nick';
import { PigeonMark } from './Brand';
import CallControls from './CallControls';

/** The minimized call — a corner window over the chat. Everything underneath
 *  stays interactive; expand returns the fullscreen view. */
export default function PiPWidget(): React.ReactNode {
  const room = useVoiceStore((s) => s.room);
  const callState = useVoiceStore((s) => s.callState);
  const setPip = useVoiceStore((s) => s.setPip);
  const cancelCall = useVoiceStore((s) => s.cancelCall);
  const dms = useAppStore((s) => s.dms);
  if (!callState) return null;
  const peerNick = dms.find((d) => d.id === callState.channelId)?.peer.nick ?? '?';

  return (
    <div className="fixed bottom-4 right-4 z-40 w-72 overflow-hidden rounded-lg border border-brass-600/70 bg-night-900 shadow-[0_18px_50px_-12px_rgba(0,0,0,0.85)]">
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

/** prefers the remote camera; falls back to anything, then to the mark */
function PiPTile(): React.ReactNode {
  const tracks = useTracks([Track.Source.Camera, Track.Source.ScreenShare, Track.Source.Microphone], {
    onlySubscribed: true,
  });
  const remote = tracks.filter((t) => !t.participant.isLocal);
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
