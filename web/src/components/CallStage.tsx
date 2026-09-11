import { ParticipantTile, useParticipants, useTracks, AudioTrack } from '@livekit/components-react';
import { Track } from 'livekit-client';
import type { TrackReference } from '@livekit/components-react';
import { nickFor } from '../lib/nick';
import Avatar from './Avatar';

/** Remote mic audio — invisible <audio> elements. Without this nothing in the
 *  app attaches RemoteAudioTracks (stage tiles are video-only), so peers would
 *  publish fine but nobody would hear them. Local mic is never attached (echo). */
function RemoteAudio(): React.ReactNode {
  const tracks = useTracks([Track.Source.Microphone], { onlySubscribed: true });
  return (
    <>
      {tracks
        .filter((t) => !t.participant.isLocal)
        .map((t) => (
          <AudioTrack key={t.participant.identity} trackRef={t} className="hidden" />
        ))}
    </>
  );
}

function NamePlate({
  identity,
  isLocal,
  isScreen,
}: {
  identity: string;
  isLocal: boolean;
  isScreen: boolean;
}): React.ReactNode {
  return (
    <span className="pointer-events-none absolute bottom-2 left-2 flex max-w-[calc(100%-1rem)] items-center gap-1.5 rounded-sm border border-brass-700/60 bg-night-950/85 px-2 py-0.5">
      <span className="truncate font-display text-xs font-semibold uppercase tracking-[0.1em] text-paper-50">
        {nickFor(identity)}
        {isLocal && ' (sen)'}
      </span>
      {isScreen && <span className="shrink-0 font-mono text-[9px] text-lamp-400">ekran</span>}
    </span>
  );
}

function CamTile({ trackRef }: { trackRef: TrackReference }): React.ReactNode {
  return (
    <div className="relative aspect-video w-full overflow-hidden rounded-md border border-brass-700/50 bg-night-850">
      {/* object-cover: the video FILLS the tile (contain letterboxes it small);
          screen shares stay contain for readability, cams crop to fill */}
      <ParticipantTile trackRef={trackRef} className="h-full w-full [&_video]:h-full [&_video]:w-full [&_video]:object-cover" />
      <NamePlate identity={trackRef.participant.identity} isLocal={trackRef.participant.isLocal} isScreen={false} />
    </div>
  );
}

function CamPlaceholder({ identity, isLocal }: { identity: string; isLocal: boolean }): React.ReactNode {
  return (
    <div className="relative flex aspect-video w-full items-center justify-center overflow-hidden rounded-md border border-brass-700/50 bg-night-850">
      <Avatar userId={identity} label={nickFor(identity)} size={56} srcOverride={null} />
      <NamePlate identity={identity} isLocal={isLocal} isScreen={false} />
    </div>
  );
}

/** Shared call stage for 1:1 calls and community voice rooms.
 *  Built from PARTICIPANTS, not tracks — a camera-off peer still owns their
 *  slot (avatar placeholder) and their video lands exactly there when they
 *  turn it on. A screen share, when present, is ALWAYS the dominant tile with
 *  a camera strip below (Discord style); otherwise cameras fill the area. */
export default function CallStage({ emptyLabel }: { emptyLabel?: string }): React.ReactNode {
  const participants = useParticipants();
  const tracks = useTracks([Track.Source.Camera, Track.Source.ScreenShare], {
    onlySubscribed: false,
  });
  const screens = tracks.filter((t) => t.source === Track.Source.ScreenShare);
  const camByIdentity = new Map<string, TrackReference>();
  for (const t of tracks) {
    if (t.source === Track.Source.Camera && !camByIdentity.has(t.participant.identity)) {
      camByIdentity.set(t.participant.identity, t);
    }
  }

  if (participants.length === 0) {
    return (
      <>
        <RemoteAudio />
        {emptyLabel ? (
          <div className="flex flex-1 items-center justify-center text-sm text-paper-500">{emptyLabel}</div>
        ) : (
          <div className="flex-1" />
        )}
      </>
    );
  }

  const slotKey = (identity: string): string => identity;

  if (screens.length > 0) {
    return (
      <>
        <RemoteAudio />
        <div className="flex min-h-0 flex-1 flex-col gap-2 p-3">
          {/* primary stage — the share owns the full area, sized by the flex
              container (definite height, no aspect/percentage sizing cycles) */}
          <div className="flex min-h-0 flex-1 gap-2">
            {screens.map((t) => (
              <div
                key={slotKey(t.participant.identity) + '-screen'}
                className="relative min-h-0 min-w-0 flex-1 overflow-hidden rounded-md border border-brass-700/50 bg-night-850"
              >
                <ParticipantTile trackRef={t} className="h-full w-full" />
                <NamePlate identity={t.participant.identity} isLocal={t.participant.isLocal} isScreen />
              </div>
            ))}
          </div>
          {/* every participant gets a strip slot — placeholder when cam is off */}
          <div className="flex h-32 shrink-0 gap-2 overflow-x-auto">
            {participants.map((p) => {
              const cam = camByIdentity.get(p.identity);
              return cam ? (
                <div key={slotKey(p.identity)} className="relative aspect-video h-full shrink-0">
                  <ParticipantTile
                    trackRef={cam}
                    className="h-full w-full [&_video]:h-full [&_video]:w-full [&_video]:object-cover"
                  />
                  <NamePlate identity={p.identity} isLocal={p.isLocal} isScreen={false} />
                </div>
              ) : (
                <div key={slotKey(p.identity)} className="aspect-video h-full shrink-0">
                  <CamPlaceholder identity={p.identity} isLocal={p.isLocal} />
                </div>
              );
            })}
          </div>
        </div>
      </>
    );
  }

  const count = participants.length;
  const cols =
    count === 1
      ? 'minmax(0, 720px)'
      : count === 2
        ? 'repeat(2, minmax(0, 1fr))'
        : 'repeat(auto-fit, minmax(280px, 1fr))';
  return (
    <>
      <RemoteAudio />
      <div
        className="grid flex-1 auto-rows-min content-center gap-3 overflow-y-auto p-4"
        style={{ gridTemplateColumns: cols, justifyItems: count <= 2 ? 'center' : 'stretch' }}
      >
        {participants.map((p) => {
          const cam = camByIdentity.get(p.identity);
          return cam ? (
            <CamTile key={slotKey(p.identity)} trackRef={cam} />
          ) : (
            <CamPlaceholder key={slotKey(p.identity)} identity={p.identity} isLocal={p.isLocal} />
          );
        })}
      </div>
    </>
  );
}