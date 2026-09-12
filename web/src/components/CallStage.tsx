import { useState } from 'react';
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
  isFocus,
}: {
  identity: string;
  isLocal: boolean;
  isScreen: boolean;
  isFocus?: boolean;
}): React.ReactNode {
  return (
    <span className="pointer-events-none absolute bottom-2 left-2 flex max-w-[calc(100%-1rem)] items-center gap-1.5 rounded-sm border border-brass-700/60 bg-night-950/85 px-2 py-0.5">
      <span className="truncate font-display text-xs font-semibold uppercase tracking-[0.1em] text-paper-50">
        {nickFor(identity)}
        {isLocal && ' (sen)'}
      </span>
      {isScreen && <span className="shrink-0 font-mono text-[9px] text-lamp-400">ekran</span>}
      {isFocus && <span className="shrink-0 font-mono text-[9px] text-lamp-400">odak</span>}
    </span>
  );
}

// livekit's ParticipantTile renders its own (unstyled) nameplate + mute badges
// which overlap ours — hide them wherever we draw our own plate
const TILE_HIDE = '[&_.lk-participant-name]:hidden [&_.lk-track-muted-indicator-microphone]:hidden [&_.lk-track-muted-indicator-camera]:hidden';

interface TileProps {
  trackRef: TrackReference;
  onClick?: () => void;
  active?: boolean;
  isScreen?: boolean;
  isFocus?: boolean;
  /** fill the flex container (dominant tile) instead of aspect-video (strip/grid) */
  fill?: boolean;
}

function CamTile({ trackRef, onClick, active, isScreen, isFocus, fill }: TileProps): React.ReactNode {
  return (
    <div
      onClick={onClick}
      title={onClick ? (active ? 'büyütmeden çıkar' : 'büyüt') : undefined}
      className={`relative cursor-pointer overflow-hidden rounded-md border bg-night-850 transition-colors ${
        fill ? 'min-h-0 min-w-0 flex-1' : 'aspect-video w-full'
      } ${
        active ? 'border-lamp-500/80 ring-1 ring-lamp-500/50' : 'border-brass-700/50 hover:border-brass-500'
      } ${onClick ? '' : 'cursor-default'}`}
    >
      {/* object-cover: the video FILLS the tile (contain letterboxes it small);
          screen shares stay contain for readability, cams crop to fill */}
      <ParticipantTile
        trackRef={trackRef}
        className={`h-full w-full [&_video]:h-full [&_video]:w-full [&_video]:object-cover ${TILE_HIDE}`}
      />
      <NamePlate
        identity={trackRef.participant.identity}
        isLocal={trackRef.participant.isLocal}
        isScreen={isScreen}
        isFocus={isFocus === true}
      />
    </div>
  );
}

function CamPlaceholder({
  identity,
  isLocal,
  onClick,
  active,
}: {
  identity: string;
  isLocal: boolean;
  onClick?: () => void;
  active?: boolean;
}): React.ReactNode {
  return (
    <div
      onClick={onClick}
      title={onClick ? (active ? 'büyütmeden çıkar' : 'büyüt') : undefined}
      className={`relative flex aspect-video w-full items-center justify-center overflow-hidden rounded-md border bg-night-850 ${
        active ? 'border-lamp-500/80' : 'border-brass-700/50'
      } ${onClick ? 'cursor-pointer transition-colors hover:border-brass-500' : ''}`}
    >
      <Avatar userId={identity} label={nickFor(identity)} size={56} srcOverride={null} />
      <NamePlate identity={identity} isLocal={isLocal} isScreen={false} isFocus={active} />
    </div>
  );
}

/** Shared call stage for 1:1 calls and community voice rooms.
 *  Built from PARTICIPANTS, not tracks — a camera-off peer still owns their
 *  slot (avatar placeholder) and their video lands exactly there when they
 *  turn it on. A screen share, when present, is ALWAYS the dominant tile with
 *  a camera strip below (Discord style); otherwise cameras fill the area.
 *  Discord-style spotlight: clicking any tile enlarges that participant (their
 *  screen share if they have one, else camera); clicking again returns to the
 *  automatic layout. */
export default function CallStage({ emptyLabel }: { emptyLabel?: string }): React.ReactNode {
  const participants = useParticipants();
  const tracks = useTracks([Track.Source.Camera, Track.Source.ScreenShare], {
    onlySubscribed: false,
  });
  // livekit v2 disables a camera by MUTING the published track, not
  // unpublishing it — muted refs would keep rendering and paint black
  // <video> tiles. Treat a muted track as "camera off" so the participant's
  // avatar placeholder comes back instead.
  const live = (t: TrackReference): boolean => !!t.publication && !t.publication.isMuted;
  const screens = tracks.filter((t) => t.source === Track.Source.ScreenShare && live(t));
  const camByIdentity = new Map<string, TrackReference>();
  for (const t of tracks) {
    if (t.source === Track.Source.Camera && live(t) && !camByIdentity.has(t.participant.identity)) {
      camByIdentity.set(t.participant.identity, t);
    }
  }
  // manual spotlight (identity) — user override over the automatic layout
  const [spotlight, setSpotlight] = useState<string | null>(null);
  const spotlit = spotlight ? participants.find((p) => p.identity === spotlight) ?? null : null;

  const toggleSpotlight = (identity: string): void =>
    setSpotlight((cur) => (cur === identity ? null : identity));

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
  const stripTile = (p: (typeof participants)[number]): React.ReactNode => {
    const cam = camByIdentity.get(p.identity);
    const focused = p.identity === spotlight;
    return cam ? (
      <CamTile
        key={slotKey(p.identity)}
        trackRef={cam}
        active={focused}
        isScreen={false}
        onClick={() => toggleSpotlight(p.identity)}
      />
    ) : (
      <CamPlaceholder
        key={slotKey(p.identity)}
        identity={p.identity}
        isLocal={p.isLocal}
        active={focused}
        onClick={() => toggleSpotlight(p.identity)}
      />
    );
  };

  if (spotlight && spotlit) {
    // dominant: the spotlit participant — their screen share if any, else cam
    const spotScreen = screens.find((t) => t.participant.identity === spotlight);
    const spotCam = camByIdentity.get(spotlight);
    return (
      <>
        <RemoteAudio />
        <div className="flex min-h-0 flex-1 flex-col gap-2 p-3">
          <div className="flex min-h-0 flex-1 gap-2">
            {spotScreen ? (
              <CamTile
                key={spotlight + '-spot-screen'}
                trackRef={spotScreen}
                isScreen
                isFocus
                active
                fill
                onClick={() => setSpotlight(null)}
              />
            ) : spotCam ? (
              <CamTile key={spotlight + '-spot'} trackRef={spotCam} isFocus active fill onClick={() => setSpotlight(null)} />
            ) : (
              <div
                key={spotlight + '-spot-ph'}
                onClick={() => setSpotlight(null)}
                title="büyütmeden çıkar"
                className="flex min-h-0 min-w-0 flex-1 cursor-pointer items-center justify-center overflow-hidden rounded-md border border-lamp-500/80 bg-night-850"
              >
                <div className="h-full max-h-64">
                  <CamPlaceholder identity={spotlight} isLocal={spotlit.isLocal} active />
                </div>
              </div>
            )}
          </div>
          {/* everyone else in the strip — clicking swaps the spotlight */}
          <div className="flex h-32 shrink-0 gap-2 overflow-x-auto">
            {participants.filter((p) => p.identity !== spotlight).map(stripTile)}
          </div>
        </div>
      </>
    );
  }

  if (screens.length > 0) {
    return (
      <>
        <RemoteAudio />
        <div className="flex min-h-0 flex-1 flex-col gap-2 p-3">
          {/* primary stage — the share owns the full area, sized by the flex
              container (definite height, no aspect/percentage sizing cycles) */}
          <div className="flex min-h-0 flex-1 gap-2">
            {screens.map((t) => (
              <CamTile
                key={slotKey(t.participant.identity) + '-screen'}
                trackRef={t}
                isScreen
                fill
                onClick={() => toggleSpotlight(t.participant.identity)}
              />
            ))}
          </div>
          {/* every participant gets a strip slot — clicking enlarges (spotlight) */}
          <div className="flex h-32 shrink-0 gap-2 overflow-x-auto">
            {participants.map(stripTile)}
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
            <CamTile
              key={slotKey(p.identity)}
              trackRef={cam}
              onClick={() => toggleSpotlight(p.identity)}
            />
          ) : (
            <CamPlaceholder
              key={slotKey(p.identity)}
              identity={p.identity}
              isLocal={p.isLocal}
              onClick={() => toggleSpotlight(p.identity)}
            />
          );
        })}
      </div>
    </>
  );
}