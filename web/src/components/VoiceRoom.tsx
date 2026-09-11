import { useEffect } from 'react';
import { RoomContext, useTracks, ParticipantTile } from '@livekit/components-react';
import { Track } from 'livekit-client';
import { AlertTriangle, Volume2 } from 'lucide-react';
import { useAppStore } from '../state/appStore';
import { useVoiceStore } from '../state/voiceStore';
import { nickFor } from '../lib/nick';
import CallControls from './CallControls';

function Grid() {
  const tracks = useTracks([Track.Source.Camera, Track.Source.Microphone, Track.Source.ScreenShare], {
    onlySubscribed: false,
  });
  const seen = new Set<string>();
  const tiles = tracks.filter((t) => {
    // one tile per participant; screen share and camera beat mic-only
    if (seen.has(t.participant.identity)) return false;
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
  if (tiles.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-paper-500">
        odada yalnızsın — mikrofon/kamera aç, başkaları katılınca burada görünür
      </div>
    );
  }
  // 1 → centered capped; 2 → equal split; 3+ → auto-fit grid. Screen shares span full width.
  const cols =
    tiles.length === 1
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
            <span className="pointer-events-none absolute bottom-2 left-2 flex max-w-[calc(100%-1rem)] items-center gap-1.5 rounded-sm border border-brass-700/60 bg-night-950/85 px-2 py-0.5">
              <span className="truncate font-display text-xs font-semibold uppercase tracking-[0.1em] text-paper-50">
                {nickFor(t.participant.identity)}
                {t.participant.isLocal && ' (sen)'}
              </span>
              {isScreen && <span className="shrink-0 font-mono text-[9px] text-lamp-400">ekran</span>}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export default function VoiceRoom({ channelId, channelName }: { channelId: string; channelName: string }) {
  const room = useVoiceStore((s) => s.room);
  const joined = useVoiceStore((s) => s.joinedChannelId);
  const error = useVoiceStore((s) => s.error);
  const join = useVoiceStore((s) => s.join);
  const leave = useVoiceStore((s) => s.leave);
  const needsRekey = useAppStore(
    (s) =>
      !!s.communities
        .find((c) => c.id === s.activeCommunityId)
        ?.channels.find((ch) => ch.id === channelId)?.needs_rekey,
  );

  useEffect(() => {
    if (!needsRekey && joined !== channelId) void join(channelId).catch(() => {});
  }, [channelId, joined, join, needsRekey]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-3 border-b border-night-700 bg-night-900/40 px-4 py-2.5">
        <Volume2 size={17} className="text-brass-500" aria-hidden />
        <span className="font-display text-lg font-semibold uppercase tracking-[0.08em] text-paper-50">
          {channelName}
        </span>
        <span className="sealed-band">uçtan uca · sframe</span>
      </div>
      {needsRekey && (
        <div className="flex items-center gap-2 border-b border-lamp-600/40 bg-lamp-100/70 px-4 py-2 text-sm text-lamp-300">
          <AlertTriangle size={14} className="shrink-0 text-lamp-500" />
          Bir üye çıkarıldı — sahip/admin kanal anahtarını yenileyene kadar oda kilitli.
        </div>
      )}
      {error && <div className="border-b border-stamp-500/50 bg-stamp-100 px-4 py-2 text-sm text-stamp-400">{error}</div>}
      {!room ? (
        <div className="flex flex-1 items-center justify-center text-sm text-paper-500">odaya bağlanıyor…</div>
      ) : (
        <RoomContext.Provider value={room}>
          <Grid />
          <CallControls variant="room" onEnd={() => void leave()} endLabel="ayrıl" />
        </RoomContext.Provider>
      )}
    </div>
  );
}
