import { RoomContext, useTracks, ParticipantTile } from '@livekit/components-react';
import { Track } from 'livekit-client';
import { Minimize2 } from 'lucide-react';
import { useAppStore } from '../state/appStore';
import { useVoiceStore } from '../state/voiceStore';
import { nickFor } from '../lib/nick';
import { PigeonMark } from './Brand';
import CallControls from './CallControls';

/** One participant window — video with a proper name plate underneath.
 *  LiveKit identity is the user id; nickFor resolves the visible name. */
function Plate({ identity, isLocal, extra }: { identity: string; isLocal: boolean; extra?: string }) {
  const nick = nickFor(identity);
  return (
    <div className="pointer-events-none absolute bottom-2 left-2 flex max-w-[calc(100%-1rem)] items-center gap-1.5 rounded-sm border border-brass-700/60 bg-night-950/85 px-2 py-0.5">
      <span className="truncate font-display text-xs font-semibold uppercase tracking-[0.1em] text-paper-50">
        {nick}
        {isLocal && ' (sen)'}
      </span>
      {extra && <span className="shrink-0 font-mono text-[9px] text-lamp-400">{extra}</span>}
    </div>
  );
}

function Grid(): React.ReactNode {
  const tracks = useTracks([Track.Source.Camera, Track.Source.Microphone, Track.Source.ScreenShare], {
    onlySubscribed: false,
  });
  const seen = new Set<string>();
  const tiles = tracks.filter((t) => {
    if (seen.has(t.participant.identity)) return false;
    // one tile per person; camera wins over mic-only, screen share wins over both
    if (t.source === Track.Source.Microphone) return false;
    const hasBetter = tracks.some(
      (o) =>
        o.participant.identity === t.participant.identity &&
        (o.source === Track.Source.ScreenShare || (o.source === Track.Source.Camera && t.source === Track.Source.Microphone)),
    );
    if (hasBetter) return false;
    seen.add(t.participant.identity);
    return true;
  });
  // 1 participant → centered, max 720px; 2 → side-by-side equal; 3+ → auto-fit grid.
  // Screen shares break out of the cap and span the full row so 16:9 sources aren't letterboxed.
  const cols =
    tiles.length === 0
      ? '1fr'
      : tiles.length === 1
        ? 'minmax(0, 720px)'
        : tiles.length === 2
          ? 'repeat(2, minmax(0, 1fr))'
          : 'repeat(auto-fit, minmax(280px, 1fr))';
  return (
    <div
      className="grid flex-1 auto-rows-min content-center gap-3 overflow-y-auto p-4"
      style={{ gridTemplateColumns: cols, justifyItems: tiles.length <= 2 ? 'center' : 'stretch' }}
    >
      {tiles.map((t) => {
        const isScreen = t.source === Track.Source.ScreenShare;
        return (
          <div
            key={`${t.participant.identity}-${t.source}`}
            className={[
              'relative flex w-full items-center justify-center overflow-hidden rounded-md border border-brass-700/50 bg-night-850',
              isScreen ? 'aspect-video max-h-full' : 'aspect-video',
            ].join(' ')}
          >
            <ParticipantTile trackRef={t} className="h-full w-full" />
            <Plate
              identity={t.participant.identity}
              isLocal={t.participant.isLocal}
              extra={isScreen ? 'ekran' : undefined}
            />
          </div>
        );
      })}
    </div>
  );
}

/** 1:1 DM call surface — fullscreen overlay; minimize hands the room to the PiP corner
 *  so the chat underneath stays fully usable during the call. */
export default function CallView(): React.ReactNode {
  const room = useVoiceStore((s) => s.room);
  const callState = useVoiceStore((s) => s.callState);
  const error = useVoiceStore((s) => s.error);
  const setPip = useVoiceStore((s) => s.setPip);
  const cancelCall = useVoiceStore((s) => s.cancelCall);
  const dms = useAppStore((s) => s.dms);
  if (!callState) return null;
  const peerNick = dms.find((d) => d.id === callState.channelId)?.peer.nick ?? '?';
  const status =
    callState.phase === 'ringing' ? 'çalıyor…' : callState.phase === 'ended' ? (callState.note ?? 'bitti') : 'görüşme açık';

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-night-950/97">
      <div className="flex items-center gap-3 border-b border-night-700 bg-night-900/60 px-4 py-2.5">
        <span className="plate">GÖRÜŞME</span>
        <span className="font-display text-lg font-semibold uppercase tracking-[0.08em] text-paper-50">{peerNick}</span>
        <span className="sealed-band">
          {status}
        </span>
        <button
          onClick={() => setPip(true)}
          className="btn-ghost ml-auto !px-2 !py-1"
          title="küçült — sohbete dön"
          aria-label="aramayı küçült"
        >
          <Minimize2 size={14} />
          küçült
        </button>
      </div>
      {error && <div className="border-b border-stamp-500/50 bg-stamp-100 px-4 py-2 text-sm text-stamp-400">{error}</div>}
      {!room ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-paper-500">
          <PigeonMark size={30} className="text-brass-600" />
          <p className="text-sm">vagona bağlanıyor…</p>
        </div>
      ) : (
        <RoomContext.Provider value={room}>
          <Grid />
          <CallControls variant="call" onEnd={() => void cancelCall()} endLabel="bitir" onMinimize={() => setPip(true)} />
        </RoomContext.Provider>
      )}
    </div>
  );
}
