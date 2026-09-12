import { useEffect, useRef, useState } from 'react';
import { ParticipantTile, useParticipants, useTracks, AudioTrack } from '@livekit/components-react';
import { Track } from 'livekit-client';
import type { Participant } from 'livekit-client';
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
const TILE_HIDE =
  ' [&_.lk-participant-name]:hidden [&_.lk-track-muted-indicator-microphone]:hidden [&_.lk-track-muted-indicator-camera]:hidden';

// ekran paylaşımı asla kırpılmaz (contain — okunabilirlik); kameralar
// alanı doldurur (cover — Discord davranışı)
const fit = (isScreen: boolean): string =>
  isScreen ? '[&_video]:object-contain' : '[&_video]:object-cover';

interface TileProps {
  trackRef: TrackReference;
  onClick?: () => void;
  active?: boolean;
  isScreen?: boolean;
  isFocus?: boolean;
  /** fill the flex container (dominant tile) instead of aspect-video (strip/grid) */
  fill?: boolean;
}

function VideoTile({ trackRef, onClick, active = false, isScreen = false, isFocus = false, fill }: TileProps): React.ReactNode {
  return (
    <div
      onClick={onClick}
      title={onClick ? (active ? 'büyütmeden çıkar' : 'büyüt') : undefined}
      className={`relative cursor-pointer overflow-hidden rounded-md border bg-night-850 transition-colors ${
        fill ? 'min-h-0 min-w-0 flex-1' : 'aspect-video w-full'
      } ${
        active ? 'border-lamp-500/80 ring-1 ring-lamp-500/50' : 'border-brass-700/50 hover:border-brass-500'
      } ${fill ? '[&_video]:object-contain' : fit(isScreen)}${TILE_HIDE}`}
    >
      <ParticipantTile trackRef={trackRef} className="h-full w-full [&_video]:h-full [&_video]:w-full" />
      <NamePlate
        identity={trackRef.participant.identity}
        isLocal={trackRef.participant.isLocal}
        isScreen={isScreen}
        isFocus={isFocus}
      />
    </div>
  );
}

function PlaceholderTile({
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
 *  automatic layout. Screen shares are never cropped — they letterbox. */
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
  // manual spotlight — tracks the exact video clicked ("screen:<id>" /
  // "cam:<id>"), Discord-style: clicking a camera focuses the camera even if
  // that person also shares their screen
  const [spotlight, setSpotlight] = useState<string | null>(null);
  const spotKind: 'screen' | 'cam' = spotlight?.startsWith('screen:') ? 'screen' : 'cam';
  const spotId = spotlight?.split(':')[1] ?? null;
  const spotlit = spotId ? participants.find((p) => p.identity === spotId) ?? null : null;

  const toggleSpotlight = (kind: 'screen' | 'cam', identity: string): void => {
    const key = `${kind}:${identity}`;
    setSpotlight((cur) => (cur === key ? null : key));
  };

  // yeni katılan olunca odağı bırak — sonradan bağlanan şeritte küçük kalmasın,
  // herkes eşit büyüklükte başlasın
  const prevCount = useRef(participants.length);
  useEffect(() => {
    if (participants.length > prevCount.current) setSpotlight(null);
    prevCount.current = participants.length;
  }, [participants.length]);

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
  const stripTile = (p: Participant): React.ReactNode => {
    const cam = camByIdentity.get(p.identity);
    const focused = spotlight === `cam:${p.identity}`;
    const border = focused ? 'border-lamp-500/80' : 'border-brass-700/50';
    return cam ? (
      <div
        key={slotKey(p.identity)}
        onClick={() => toggleSpotlight('cam', p.identity)}
        title={focused ? 'büyütmeden çıkar' : 'büyüt'}
        className={`relative aspect-video h-full shrink-0 cursor-pointer overflow-hidden rounded-md border bg-night-850 transition-colors ${border} ${TILE_HIDE}`}
      >
        <ParticipantTile trackRef={cam} className="h-full w-full [&_video]:h-full [&_video]:w-full [&_video]:object-cover" />
        <NamePlate identity={p.identity} isLocal={p.isLocal} isScreen={false} isFocus={focused} />
      </div>
    ) : (
      <div
        key={slotKey(p.identity)}
        onClick={() => toggleSpotlight('cam', p.identity)}
        title={focused ? 'büyütmeden çıkar' : 'büyüt'}
        className={`flex aspect-video h-full shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-md border bg-night-850 transition-colors ${border}`}
      >
        <Avatar userId={p.identity} label={nickFor(p.identity)} size={56} srcOverride={null} />
        <NamePlate identity={p.identity} isLocal={p.isLocal} isScreen={false} isFocus={focused} />
      </div>
    );
  };

  // odaklı kişinin dominant tile'ı: kullanıcının tıkladığı akış önce
  // (ekran contain — asla kırpılmaz; kamera cover); kaybolursa diğer akışına düşer
  const dominant = (p: Participant): React.ReactNode => {
    const screen = screens.find((t) => t.participant.identity === p.identity);
    const cam = camByIdentity.get(p.identity);
    const track = spotKind === 'screen' ? (screen ?? cam) : (cam ?? screen);
    if (!track) {
      return (
        <div
          key={slotKey(p.identity) + '-dominant-ph'}
          onClick={() => setSpotlight(null)}
          title="büyütmeden çıkar"
          className="flex min-h-0 min-w-0 flex-1 cursor-pointer items-center justify-center overflow-hidden rounded-md border border-lamp-500/80 bg-night-850"
        >
          <Avatar userId={p.identity} label={nickFor(p.identity)} size={96} srcOverride={null} />
          <NamePlate identity={p.identity} isLocal={p.isLocal} isScreen={false} isFocus />
        </div>
      );
    }
    const isScreen = track.source === Track.Source.ScreenShare;
    return (
      <VideoTile
        key={slotKey(p.identity) + '-dominant'}
        trackRef={track}
        isScreen={isScreen}
        isFocus
        fill
        onClick={() => setSpotlight(null)}
      />
    );
  };

  if (spotlit) {
    return (
      <>
        <RemoteAudio />
        <div className="flex min-h-0 flex-1 flex-col gap-2 p-3">
          <div className="flex min-h-0 flex-1 gap-2">{dominant(spotlit)}</div>
          <div className="flex h-32 shrink-0 gap-2 overflow-x-auto">
            {participants.filter((p) => p.identity !== spotId).map(stripTile)}
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
              <VideoTile
                key={slotKey(t.participant.identity) + '-screen'}
                trackRef={t}
                isScreen
                fill
                onClick={() => toggleSpotlight('screen', t.participant.identity)}
              />
            ))}
          </div>
          {/* every participant gets a strip slot — clicking enlarges (spotlight) */}
          <div className="flex h-32 shrink-0 gap-2 overflow-x-auto">{participants.map(stripTile)}</div>
        </div>
      </>
    );
  }

  const count = participants.length;

  // 1-2 kişide Discord gibi: bölmeler sahnenin tüm yüksekliğini doldurur,
  // video contain (kırpma yok) — baştan beri büyük durur
  if (count <= 2) {
    return (
      <>
        <RemoteAudio />
        <div className="flex min-h-0 flex-1 gap-3 p-4">
          {participants.map((p) => {
            const cam = camByIdentity.get(p.identity);
            const focused = spotlight === `cam:${p.identity}`;
            return (
              <div
                key={slotKey(p.identity)}
                onClick={() => toggleSpotlight('cam', p.identity)}
                title={focused ? 'büyütmeden çıkar' : 'büyüt'}
                className={`relative min-h-0 min-w-0 flex-1 cursor-pointer overflow-hidden rounded-md border bg-night-850 transition-colors ${
                  focused ? 'border-lamp-500/80' : 'border-brass-700/50 hover:border-brass-500'
                } ${TILE_HIDE}`}
              >
                {cam ? (
                  <ParticipantTile
                    trackRef={cam}
                    className="h-full w-full [&_video]:h-full [&_video]:w-full [&_video]:object-contain"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center">
                    <Avatar userId={p.identity} label={nickFor(p.identity)} size={72} srcOverride={null} />
                  </div>
                )}
                <NamePlate identity={p.identity} isLocal={p.isLocal} isScreen={false} isFocus={focused} />
              </div>
            );
          })}
        </div>
      </>
    );
  }

  return (
    <>
      <RemoteAudio />
      <div
        className="grid flex-1 auto-rows-min content-center gap-3 overflow-y-auto p-4"
        style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' }}
      >
        {participants.map((p) => stripTile(p))}
      </div>
    </>
  );
}