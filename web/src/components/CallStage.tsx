import { useEffect, useRef, useState } from 'react';
import { ParticipantTile, useParticipants, useTracks, AudioTrack } from '@livekit/components-react';
import { Track } from 'livekit-client';
import type { Participant } from 'livekit-client';
import type { TrackReference } from '@livekit/components-react';
import { Volume2, VolumeX } from 'lucide-react';
import { nickFor } from '../lib/nick';
import { useVoiceStore } from '../state/voiceStore';
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

/** Remote screen-share audio — attached invisibly; the viewer's volume/mute
 *  controls drive the gain. Only shares the viewer is actually WATCHING are
 *  attached (unwatched live tiles stay silent). Local share audio is never
 *  attached (echo). */
function ShareAudio({ volume, muted, activeIds }: { volume: number; muted: boolean; activeIds: string[] }): React.ReactNode {
  const tracks = useTracks([Track.Source.ScreenShareAudio], { onlySubscribed: true });
  return (
    <>
      {tracks
        .filter((t) => !t.participant.isLocal && activeIds.includes(t.participant.identity))
        .map((t) => (
          <AudioTrack key={t.participant.identity} trackRef={t} volume={muted ? 0 : volume} className="hidden" />
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
  /** absolute overlay inside the tile (e.g. the sharer's stop button) */
  overlay?: React.ReactNode;
  /** tooltip override — the dominant tile's click toggles layout, not "büyüt" */
  title?: string;
}

function VideoTile({ trackRef, onClick, active = false, isScreen = false, isFocus = false, fill, overlay, title: titleProp }: TileProps): React.ReactNode {
  return (
    <div
      onClick={onClick}
      title={titleProp ?? (onClick ? (active ? 'büyütmeden çıkar' : 'büyüt') : undefined)}
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
      {overlay}
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

  const toggleScreen = useVoiceStore((s) => s.toggleScreen);
  // paylaşım görünümü yerleşimi: odak (büyük + sağ şerit) / yan yana eşit bölmeler
  const [shareLayout, setShareLayout] = useState<'focus' | 'side'>('focus');
  // izleyici yayın sesi: 0-1 + sessize alma (ekran paylaşımı sesi)
  const [shareVolume, setShareVolume] = useState(1);
  const [shareMuted, setShareMuted] = useState(false);

  const toggleSpotlight = (kind: 'screen' | 'cam', identity: string): void => {
    const key = `${kind}:${identity}`;
    setSpotlight((cur) => (cur === key ? null : key));
  };

  // odağa geçmeden önceki yayın yerleşimi — odaklı kamerayı küçültünce odak
  // yayınına değil, geldiğin yerleşime dön (side'dan büyüttüysen side'a düş)
  const returnLayout = useRef<'focus' | 'side'>('focus');
  const spotCam = (identity: string): void => {
    returnLayout.current = shareLayout;
    setSpotlight(`cam:${identity}`);
  };
  const releaseSpot = (): void => {
    setSpotlight(null);
    setShareLayout(returnLayout.current);
  };

  // yan yana düzende bir kameraya/avatara tıklamak o akışa odaklanıp odak
  // görünümüne döner — spotlight'i set etmek yetmez, side dalı odak dalından
  // önce koşulsuz render ettiği için aksi hâlde tıklama görünmez şekilde yutulur
  const focusFromSide = (identity: string): void => {
    spotCam(identity);
    setShareLayout('focus');
  };

  // yeni katılan olunca odağı bırak — sonradan bağlanan şeritte küçük kalmasın,
  // herkes eşit büyüklükte başlasın
  const prevCount = useRef(participants.length);
  useEffect(() => {
    if (participants.length > prevCount.current) setSpotlight(null);
    prevCount.current = participants.length;
  }, [participants.length]);

  // KENDİ yayınım başlayınca büyük alanı yayın alsın — bayat spotlight (mesela
  // kamerası kapalı birine tıklayıp büyütülmüş odak) yayını şeritte küçülterek
  // gizlemesin. Başkasının yayını otomatik alınmaz: "canlı" döşemesi olarak
  // görünür, izleyici tıklayınca izler (Discord Watch Stream mantığı)
  const ownScreenCount = screens.filter((t) => t.participant.isLocal).length;
  const prevOwnScreens = useRef(0);
  useEffect(() => {
    if (ownScreenCount > prevOwnScreens.current) {
      setSpotlight(null);
      setShareLayout('focus');
    }
    prevOwnScreens.current = ownScreenCount;
  }, [ownScreenCount]);

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
        className={`relative aspect-video w-full cursor-pointer overflow-hidden rounded-md border bg-night-850 transition-colors ${border} ${TILE_HIDE}`}
      >
        <ParticipantTile trackRef={cam} className="h-full w-full [&_video]:h-full [&_video]:w-full [&_video]:object-cover" />
        <NamePlate identity={p.identity} isLocal={p.isLocal} isScreen={false} isFocus={focused} />
      </div>
    ) : (
      <div
        key={slotKey(p.identity)}
        onClick={() => toggleSpotlight('cam', p.identity)}
        title={focused ? 'büyütmeden çıkar' : 'büyüt'}
        className={`flex aspect-video w-full cursor-pointer items-center justify-center overflow-hidden rounded-md border bg-night-850 transition-colors ${border}`}
      >
        <Avatar userId={p.identity} label={nickFor(p.identity)} size={56} srcOverride={null} />
        <NamePlate identity={p.identity} isLocal={p.isLocal} isScreen={false} isFocus={focused} />
      </div>
    );
  };

  // tüm canlı video akışları (ekran + kamera) — odak modeli bunlar üzerinde:
  // odaktaki video büyük, geri kalan TÜM akışlar (odaklı kişinin diğer
  // kamerası/ekranı dahil) şeritte — Discord davranışı
  const allVideos: { key: string; trackRef: TrackReference; isScreen: boolean; identity: string }[] = [
    ...screens.map((t) => ({
      key: `screen:${t.participant.identity}`,
      trackRef: t,
      isScreen: true,
      identity: t.participant.identity,
    })),
    ...[...camByIdentity.values()].map((t) => ({
      key: `cam:${t.participant.identity}`,
      trackRef: t,
      isScreen: false,
      identity: t.participant.identity,
    })),
  ];

  // ekran paylaşımı varken iki yerleşim: 'focus' (odak solda büyük + sağ
  // dikey şerit) ve 'side' (tüm akışlar normal aramadaki gibi yan yana eşit
  // bölmeler). Yayına tıklamak ikisi arasında geçer. Paylaşan kişi kendi
  // yayınında 'paylaşımı durdur' butonunu görür.
  const stopBtn = (small = false): React.ReactNode => (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        void toggleScreen();
      }}
      className={`absolute right-2 top-2 z-10 rounded-md border border-stamp-500/70 bg-night-950/85 font-semibold text-stamp-400 transition-colors hover:bg-stamp-500 hover:text-white ${
        small ? 'px-1.5 py-0.5 text-[10px]' : 'px-2 py-1 text-xs'
      }`}
    >
      paylaşımı durdur
    </button>
  );

  // varsayılan odak: yalnız kendi yayınım — başkasının yayını izleyiciye
  // dayatılmaz, canlı döşemesi olarak izlemesi için bekler (Discord akışı)
  const autoFocusVideo = spotlight ? null : (allVideos.find((v) => v.isScreen && v.trackRef.participant.isLocal) ?? null);
  const focusedKey = spotlight ?? (autoFocusVideo?.key ?? null);
  const focusedVideo = focusedKey ? (allVideos.find((v) => v.key === focusedKey) ?? null) : null;
  const focusId = focusedKey?.split(':')[1] ?? null;
  const focusPerson = focusId ? participants.find((p) => p.identity === focusId) ?? null : null;

  // yan yana mod: ekran paylaşımı + tüm akışlar/avatarlar eşit bölmeler
  if (screens.length > 0 && shareLayout === 'side') {
    const paneFor = (v: { key: string; trackRef: TrackReference; isScreen: boolean; identity: string }): React.ReactNode => {
      const own = v.trackRef.participant.isLocal && v.isScreen;
      return (
        <div
          key={v.key}
          onClick={() => (v.isScreen ? setShareLayout('focus') : focusFromSide(v.identity))}
          title={v.isScreen ? 'odak görünümüne dön' : 'büyüt'}
          className={`relative min-h-0 min-w-0 flex-1 cursor-pointer overflow-hidden rounded-md border ${
            spotlight === v.key ? 'border-lamp-500/80' : 'border-brass-700/50 hover:border-brass-500'
          } bg-night-850 transition-colors ${TILE_HIDE}`}
        >
          <ParticipantTile
            trackRef={v.trackRef}
            className="h-full w-full [&_video]:h-full [&_video]:w-full [&_video]:object-contain"
          />
          <NamePlate identity={v.identity} isLocal={v.trackRef.participant.isLocal} isScreen={v.isScreen} />
          {own && stopBtn(true)}
        </div>
      );
    };
    const videoIds = new Set(allVideos.map((v) => v.identity));
    return (
      <>
        <RemoteAudio />
        <ShareAudio
          volume={shareVolume}
          muted={shareMuted}
          activeIds={screens.filter((t) => !t.participant.isLocal).map((t) => t.participant.identity)}
        />
        <div className="flex min-h-0 flex-1 gap-2 p-3">
          {allVideos.map(paneFor)}
          {participants
            .filter((p) => !videoIds.has(p.identity))
            .map((p) => (
              <div
                key={slotKey(p.identity)}
                onClick={() => focusFromSide(p.identity)}
                title="büyüt"
                className="flex min-h-0 min-w-0 flex-1 cursor-pointer items-center justify-center overflow-hidden rounded-md border border-brass-700/50 bg-night-850 transition-colors hover:border-brass-500"
              >
                <Avatar userId={p.identity} label={nickFor(p.identity)} size={72} srcOverride={null} />
                <NamePlate identity={p.identity} isLocal={p.isLocal} isScreen={false} />
              </div>
            ))}
        </div>
      </>
    );
  }

  // odak modu: manuel odak ya da varsayılan ekran paylaşımı büyük + sağ
  // dikey şeritte TÜM katılımcıların slotu (akışı olanın tile'ı, olmayanın
  // avatarı) — kimse kaybolmaz
  if (focusedKey && (focusedVideo || focusPerson)) {
    const slotFor = (p: Participant): React.ReactNode => {
      const pVideos = allVideos.filter((v) => v.identity === p.identity && v.key !== focusedKey);
      if (pVideos.length > 0) {
        return pVideos.map((v) => {
          const own = v.trackRef.participant.isLocal && v.isScreen;
          return (
            <div
              key={v.key}
              onClick={() => (v.isScreen ? setSpotlight(v.key) : spotCam(v.identity))}
              title="büyüt"
              className={`relative aspect-video w-full shrink-0 cursor-pointer overflow-hidden rounded-md border ${
                spotlight === v.key ? 'border-lamp-500/80' : 'border-brass-700/50 hover:border-brass-500'
              } bg-night-850 transition-colors ${TILE_HIDE}`}
            >
              <ParticipantTile
                trackRef={v.trackRef}
                className={`h-full w-full [&_video]:h-full [&_video]:w-full ${fit(v.isScreen)}`}
              />
              <NamePlate identity={v.identity} isLocal={v.trackRef.participant.isLocal} isScreen={v.isScreen} />
              {own && stopBtn(true)}
            </div>
          );
        });
      }
      return (
        <div
          key={slotKey(p.identity) + '-slot'}
          onClick={p.identity === focusId ? undefined : () => spotCam(p.identity)}
          title={p.identity === focusId ? undefined : 'büyüt'}
          className="relative flex aspect-video w-full shrink-0 items-center justify-center overflow-hidden rounded-md border border-brass-700/50 bg-night-850"
        >
          <Avatar userId={p.identity} label={nickFor(p.identity)} size={44} srcOverride={null} />
          <NamePlate identity={p.identity} isLocal={p.isLocal} isScreen={false} />
        </div>
      );
    };
    return (
      <>
        <RemoteAudio />
        <ShareAudio
          volume={shareVolume}
          muted={shareMuted}
          activeIds={focusedVideo?.isScreen && !focusedVideo.trackRef.participant.isLocal ? [focusedVideo.identity] : []}
        />
        <div className="flex min-h-0 flex-1 gap-2 p-3">
          <div className="flex min-h-0 min-w-0 flex-1">
            {focusedVideo ? (
              <VideoTile
                key={focusedVideo.key}
                trackRef={focusedVideo.trackRef}
                isScreen={focusedVideo.isScreen}
                isFocus={!!spotlight}
                fill
                title={focusedVideo.isScreen ? 'yan yana göster' : 'büyütmeden çıkar'}
                onClick={() => {
                  if (focusedVideo.isScreen) setShareLayout((l) => (l === 'side' ? 'focus' : 'side'));
                  else releaseSpot();
                }}
                overlay={
                  <div className="absolute left-2 top-2 z-10 flex items-center gap-1.5">
                    {focusedVideo.isScreen && !focusedVideo.trackRef.participant.isLocal && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          releaseSpot();
                        }}
                        className="rounded-md border border-night-700 bg-night-950/85 px-2 py-1 text-xs font-semibold text-paper-300 transition-colors hover:text-paper-100"
                        title="yayını izlemeyi bırak — kameralara dön"
                      >
                        izlemeyi bırak
                      </button>
                    )}
                    {!focusedVideo.trackRef.participant.isLocal && (
                      <div className="flex items-center gap-1.5 rounded-md border border-night-700 bg-night-950/85 px-2 py-1">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setShareMuted((m) => !m);
                          }}
                          className="text-paper-300 transition-colors hover:text-lamp-400"
                          title={shareMuted ? 'yayın sesini aç' : 'yayın sesini kapat'}
                          aria-label={shareMuted ? 'yayın sesini aç' : 'yayın sesini kapat'}
                        >
                          {shareMuted || shareVolume === 0 ? <VolumeX size={14} /> : <Volume2 size={14} />}
                        </button>
                        <input
                          type="range"
                          min={0}
                          max={100}
                          value={shareMuted ? 0 : Math.round(shareVolume * 100)}
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) => {
                            setShareVolume(Number(e.target.value) / 100);
                            setShareMuted(false);
                          }}
                          className="w-20 accent-lamp-500"
                          aria-label="yayın sesi seviyesi"
                        />
                      </div>
                    )}
                  </div>
                }
              />
            ) : (
              focusPerson && (
                <div
                  key={focusedKey + '-ph'}
                  onClick={releaseSpot}
                  title="büyütmeden çıkar"
                  className="flex min-h-0 min-w-0 flex-1 cursor-pointer items-center justify-center overflow-hidden rounded-md border border-lamp-500/80 bg-night-850"
                >
                  <Avatar userId={focusId!} label={nickFor(focusId!)} size={96} srcOverride={null} />
                  <NamePlate identity={focusId!} isLocal={focusPerson.isLocal} isScreen={false} isFocus />
                </div>
              )
            )}
          </div>
          <div className="flex w-44 shrink-0 flex-col gap-2 overflow-y-auto">{participants.map(slotFor)}</div>
        </div>
      </>
    );
  }

  const count = participants.length;

  // izlenmeyen uzak yayınlar — kameraların yanında "canlı" döşemesi olarak
  // bekler, tıklayınca izlenmeye başlanır (odak moduna geçer)
  const liveScreens = screens.filter((t) => !t.participant.isLocal && spotlight !== `screen:${t.participant.identity}`);
  const liveBadge = (
    <span className="absolute right-2 top-2 z-10 flex items-center gap-1 rounded-sm border border-stamp-500/70 bg-night-950/85 px-1.5 py-0.5 font-display text-[9px] font-semibold uppercase tracking-[0.1em] text-stamp-400">
      <span className="h-1.5 w-1.5 rounded-full bg-stamp-500" aria-hidden />
      canlı
    </span>
  );
  const watchLive = (t: TrackReference): void => {
    setSpotlight(`screen:${t.participant.identity}`);
    setShareLayout('focus');
  };

  // 1-2 kişide Discord gibi: bölmeler sahnenin tüm yüksekliğini doldurur,
  // video contain (kırpma yok) — baştan beri büyük durur
  if (count <= 2) {
    return (
      <>
        <RemoteAudio />
        <div className="flex min-h-0 flex-1 gap-3 p-4">
          {liveScreens.map((t) => (
            <div
              key={`live:${t.participant.identity}`}
              onClick={() => watchLive(t)}
              title="yayını izle"
              className={`relative min-h-0 min-w-0 flex-1 cursor-pointer overflow-hidden rounded-md border border-lamp-500/80 bg-night-850 transition-colors hover:border-lamp-400 ${TILE_HIDE}`}
            >
              <ParticipantTile
                trackRef={t}
                className="h-full w-full [&_video]:h-full [&_video]:w-full [&_video]:object-contain"
              />
              <NamePlate identity={t.participant.identity} isLocal={false} isScreen />
              {liveBadge}
            </div>
          ))}
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
        {liveScreens.map((t) => (
          <div
            key={`live:${t.participant.identity}`}
            onClick={() => watchLive(t)}
            title="yayını izle"
            className={`relative aspect-video w-full cursor-pointer overflow-hidden rounded-md border border-lamp-500/80 bg-night-850 transition-colors hover:border-lamp-400 ${TILE_HIDE}`}
          >
            <ParticipantTile
              trackRef={t}
              className="h-full w-full [&_video]:h-full [&_video]:w-full [&_video]:object-contain"
            />
            <NamePlate identity={t.participant.identity} isLocal={false} isScreen />
            {liveBadge}
          </div>
        ))}
        {participants.map((p) => stripTile(p))}
      </div>
    </>
  );
}