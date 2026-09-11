import { ParticipantTile, useTracks } from '@livekit/components-react';
import { Track } from 'livekit-client';
import type { TrackReference } from '@livekit/components-react';
import { nickFor } from '../lib/nick';

function NamePlate({ trackRef, isScreen }: { trackRef: TrackReference; isScreen: boolean }): React.ReactNode {
  return (
    <span className="pointer-events-none absolute bottom-2 left-2 flex max-w-[calc(100%-1rem)] items-center gap-1.5 rounded-sm border border-brass-700/60 bg-night-950/85 px-2 py-0.5">
      <span className="truncate font-display text-xs font-semibold uppercase tracking-[0.1em] text-paper-50">
        {nickFor(trackRef.participant.identity)}
        {trackRef.participant.isLocal && ' (sen)'}
      </span>
      {isScreen && <span className="shrink-0 font-mono text-[9px] text-lamp-400">ekran</span>}
    </span>
  );
}

function CamTile({ trackRef }: { trackRef: TrackReference }): React.ReactNode {
  return (
    <div className="relative aspect-video w-full overflow-hidden rounded-md border border-brass-700/50 bg-night-850">
      <ParticipantTile trackRef={trackRef} className="h-full w-full" />
      <NamePlate trackRef={trackRef} isScreen={false} />
    </div>
  );
}

/** Shared call stage for 1:1 calls and community voice rooms.
 *  A screen share, when present, is ALWAYS the dominant tile — it fills the
 *  stage area while camera tiles sit in a fixed-height strip below (Discord
 *  style), one per participant, so a sharer's camera stays visible. Without a
 *  share the cameras get the whole area: 1 → centered capped, 2 → split,
 *  3+ → auto-fit grid. */
export default function CallStage({ emptyLabel }: { emptyLabel?: string }): React.ReactNode {
  const tracks = useTracks([Track.Source.Camera, Track.Source.Microphone, Track.Source.ScreenShare], {
    onlySubscribed: false,
  });
  const videos = tracks.filter((t) => t.source !== Track.Source.Microphone);
  const screens = videos.filter((t) => t.source === Track.Source.ScreenShare);
  const cams: TrackReference[] = [];
  const seen = new Set<string>();
  for (const t of videos) {
    // one camera tile per participant; screen share tiles are handled above
    if (t.source !== Track.Source.Camera || seen.has(t.participant.identity)) continue;
    seen.add(t.participant.identity);
    cams.push(t);
  }

  if (screens.length === 0 && cams.length === 0) {
    return emptyLabel ? (
      <div className="flex flex-1 items-center justify-center text-sm text-paper-500">{emptyLabel}</div>
    ) : (
      <div className="flex-1" />
    );
  }

  if (screens.length > 0) {
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-2 p-3">
        {/* primary stage — the share owns the full area, sized by the flex
            container (definite height, no aspect/percentage sizing cycles) */}
        <div className="flex min-h-0 flex-1 gap-2">
          {screens.map((t) => (
            <div
              key={`${t.participant.identity}-${t.source}`}
              className="relative min-h-0 min-w-0 flex-1 overflow-hidden rounded-md border border-brass-700/50 bg-night-850"
            >
              <ParticipantTile trackRef={t} className="h-full w-full" />
              <NamePlate trackRef={t} isScreen />
            </div>
          ))}
        </div>
        {cams.length > 0 && (
          <div className="flex h-32 shrink-0 gap-2 overflow-x-auto">
            {cams.map((t) => (
              <div key={`${t.participant.identity}-${t.source}`} className="relative aspect-video h-full shrink-0">
                <ParticipantTile trackRef={t} className="h-full w-full" />
                <NamePlate trackRef={t} isScreen={false} />
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  const cols =
    cams.length === 1
      ? 'minmax(0, 720px)'
      : cams.length === 2
        ? 'repeat(2, minmax(0, 1fr))'
        : 'repeat(auto-fit, minmax(280px, 1fr))';
  return (
    <div
      className="grid flex-1 auto-rows-min content-center gap-3 overflow-y-auto p-4"
      style={{ gridTemplateColumns: cols, justifyItems: cams.length <= 2 ? 'center' : 'stretch' }}
    >
      {cams.map((t) => (
        <CamTile key={`${t.participant.identity}-${t.source}`} trackRef={t} />
      ))}
    </div>
  );
}
