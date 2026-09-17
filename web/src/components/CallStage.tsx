import { useEffect, useRef, useState } from 'react';
import { ParticipantTile, useParticipants, useTracks, AudioTrack, useIsSpeaking, useIsMuted } from '@livekit/components-react';
import { Track } from 'livekit-client';
import type { Participant } from 'livekit-client';
import type { TrackReference } from '@livekit/components-react';
import { MicOff, LayoutGrid, Volume2, VolumeX } from 'lucide-react';
import { nickFor } from '../lib/nick';
import { useT } from '../i18n/I18nProvider';
import { useVoiceStore } from '../state/voiceStore';
import Avatar from './Avatar';

/** Remote mic audio — invisible <audio> elements. Without this nothing in the
 *  app attaches RemoteAudioTracks (stage tiles are video-only), so peers would
 *  publish fine but nobody would hear them. Local mic is never attached (echo). */
function RemoteAudio(): React.ReactNode {
  const tracks = useTracks([Track.Source.Microphone], { onlySubscribed: true });
  const volume = useVoiceStore((s) => s.volume);
  const deafened = useVoiceStore((s) => s.deafened);
  return (
    <>
      {tracks
        .filter((t) => !t.participant.isLocal)
        .map((t) => (
          <AudioTrack
            key={t.participant.identity}
            trackRef={t}
            volume={deafened ? 0 : volume}
            muted={deafened}
            className="hidden"
          />
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
  const masterVol = useVoiceStore((s) => s.volume);
  const deafened = useVoiceStore((s) => s.deafened);
  return (
    <>
      {tracks
        .filter((t) => !t.participant.isLocal && activeIds.includes(t.participant.identity))
        .map((t) => (
          <AudioTrack
            key={t.participant.identity}
            trackRef={t}
            volume={deafened || muted ? 0 : masterVol * volume}
            muted={deafened || muted}
            className="hidden"
          />
        ))}
    </>
  );
}

function MuteBadgeInner({ participant }: { participant: Participant }): React.ReactNode {
  const isMuted = useIsMuted({ participant, source: Track.Source.Microphone });
  if (!isMuted) return null;
  return (
    <div
      className="pointer-events-none absolute bottom-2 right-2 z-10 flex h-6 w-6 items-center justify-center rounded-full border border-stamp-500/70 bg-night-950/90 text-stamp-400 shadow-md"
      title="Mikrofon kapalı"
    >
      <MicOff size={13} />
    </div>
  );
}

function MuteBadge({ participant, isScreen }: { participant?: Participant; isScreen?: boolean }): React.ReactNode {
  if (!participant || isScreen) return null;
  return <MuteBadgeInner participant={participant} />;
}

function NamePlateMuteIcon({ participant }: { participant: Participant }): React.ReactNode {
  const isMuted = useIsMuted({ participant, source: Track.Source.Microphone });
  if (!isMuted) return null;
  return (
    <span className="flex items-center text-stamp-400" title="Mikrofon kapalı">
      <MicOff size={11} />
    </span>
  );
}

function NamePlate({
  participant,
  identity,
  isLocal,
  isScreen,
  isFocus,
}: {
  participant?: Participant;
  identity: string;
  isLocal: boolean;
  isScreen: boolean;
  isFocus?: boolean;
}): React.ReactNode {
  const { t } = useT();
  return (
    <span className="pointer-events-none absolute bottom-2 left-2 flex max-w-[calc(100%-3rem)] items-center gap-1.5 rounded-sm border border-brass-700/60 bg-night-950/85 px-2 py-0.5">
      <span className="truncate font-display text-xs font-semibold uppercase tracking-[0.1em] text-paper-50">
        {nickFor(identity)}
        {isLocal && ` (${t('call.nameSelf')})`}
      </span>
      {isScreen && <span className="shrink-0 font-mono text-[9px] text-lamp-400">{t('call.nameScreen')}</span>}
      {isFocus && <span className="shrink-0 font-mono text-[9px] text-lamp-400">{t('call.nameFocus')}</span>}
      {!isScreen && participant && <NamePlateMuteIcon participant={participant} />}
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

// yayınun gerçek en-boy oranı — tile'ı görüntüye tam oturtmak için (Discord:
// pencere görüntünün şeklini takip eder, kırpma/boş bant olmaz). Boyut
// henüz bilinmiyorsa null → 16:9 varsayılanı kullanılır.
function trackAspect(t: TrackReference): number | null {
  const track = t.publication?.track;
  if (!track) return null;
  const dims = (track as unknown as { dimensions?: { width?: number; height?: number } }).dimensions;
  if (dims?.width && dims?.height) return dims.width / dims.height;
  try {
    const s = (track as unknown as { mediaStreamTrack?: MediaStreamTrack }).mediaStreamTrack?.getSettings();
    if (s?.width && s?.height) return s.width / s.height;
  } catch {
    // bazı tarayıcılar remote track'te getSettings'i boş döndürür — düş
  }
  return null;
}

interface SpeakingTileProps {
  participant?: Participant;
  isScreen?: boolean;
  active?: boolean;
  className?: string;
  children?: React.ReactNode;
  onClick?: () => void;
  title?: string;
  style?: React.CSSProperties;
}

function SpeakingTile({
  participant,
  isScreen = false,
  active = false,
  className = '',
  children,
  onClick,
  title,
  style,
}: SpeakingTileProps): React.ReactNode {
  const isSpeaking = useIsSpeaking(participant);
  const borderClass = !isScreen && isSpeaking
    ? 'border-emerald-500 ring-2 ring-emerald-500 shadow-[0_0_12px_rgba(16,185,129,0.45)]'
    : active
      ? 'border-lamp-500/80 ring-1 ring-lamp-500/50'
      : 'border-brass-700/50 hover:border-brass-500';
  return (
    <div
      onClick={onClick}
      title={title}
      style={style}
      className={`transition-all duration-150 ${borderClass} ${className}`}
    >
      {children}
    </div>
  );
}

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
  const { t } = useT();
  return (
    <SpeakingTile
      participant={trackRef.participant}
      isScreen={isScreen}
      active={active}
      onClick={onClick}
      title={titleProp ?? (onClick ? (active ? t('stream.enlargeExit') : t('stream.enlarge')) : undefined)}
      className={`relative cursor-pointer overflow-hidden rounded-md border bg-night-850 ${
        fill ? 'min-h-0 min-w-0 flex-1' : 'aspect-video w-full'
      } ${fill ? '[&_video]:object-contain' : fit(isScreen)}${TILE_HIDE}`}
    >
      <ParticipantTile trackRef={trackRef} className="h-full w-full [&_video]:h-full [&_video]:w-full" />
      <NamePlate
        participant={trackRef.participant}
        identity={trackRef.participant.identity}
        isLocal={trackRef.participant.isLocal}
        isScreen={isScreen}
        isFocus={isFocus}
      />
      <MuteBadge participant={trackRef.participant} isScreen={isScreen} />
      {overlay}
    </SpeakingTile>
  );
}

function PlaceholderTile({
  participant,
  identity,
  isLocal,
  onClick,
  active,
}: {
  participant?: Participant;
  identity: string;
  isLocal: boolean;
  onClick?: () => void;
  active?: boolean;
}): React.ReactNode {
  const { t } = useT();
  return (
    <SpeakingTile
      participant={participant}
      active={active}
      onClick={onClick}
      title={onClick ? (active ? t('stream.enlargeExit') : t('stream.enlarge')) : undefined}
      className={`relative flex aspect-video w-full items-center justify-center overflow-hidden rounded-md border bg-night-850 ${
        onClick ? 'cursor-pointer' : ''
      }`}
    >
      <Avatar userId={identity} label={nickFor(identity)} size={56} srcOverride={null} />
      <NamePlate participant={participant} identity={identity} isLocal={isLocal} isScreen={false} isFocus={active} />
      <MuteBadge participant={participant} isScreen={false} />
    </SpeakingTile>
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
  const { t } = useT();
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
    if (spotlight === key) {
      setSpotlight(null);
      return;
    }
    // büyütme anındaki yerleşimi mühürle — küçültünce buraya dön (bayat
    // eski 'side' tercihi istemsizce yan yana düzen açmasın)
    returnLayout.current = shareLayout;
    returnSpot.current = null;
    setSpotlight(key);
  };

  // odağa geçmeden önceki yayın yerleşimi — odaklı kamerayı küçültünce
  // geldiğin yerleşime dön (side'dan büyüttüysen side'a düş)
  const returnLayout = useRef<'focus' | 'side'>('focus');
  // yayın izlerken bir kamerayı büyütürsen çıkışta yine O yayına dön (Discord:
  // yayın → şeritten kamera → küçült → yayın). Kameradan kameraya geçiş
  // zincirlenmez — küçültünce düz düzene düşer.
  const returnSpot = useRef<string | null>(null);
  const spotCam = (identity: string): void => {
    returnLayout.current = shareLayout;
    returnSpot.current = spotlight?.startsWith('screen:') ? spotlight : null;
    setSpotlight(`cam:${identity}`);
  };
  const releaseSpot = (): void => {
    const back = returnSpot.current;
    returnSpot.current = null;
    setSpotlight(back);
    setShareLayout(back ? 'focus' : returnLayout.current);
  };

  // bir yayını izlemeye başla (canlı döşemesi / şerit / side bölmesi) — çıkışta
  // hep düz kamera düzenine dönmek için yerleşimi odak'a sabitleriz
  const watchScreen = (identity: string): void => {
    returnLayout.current = 'focus';
    returnSpot.current = null;
    setSpotlight(`screen:${identity}`);
    setShareLayout('focus');
  };
  // izlemeyi bırak: spotlight'ı bırak + kamera düzenine dön — returnLayout'a
  // güvenme, eski 'side' tercihi yayını tekrar büyük gösterebilir
  const unwatch = (): void => {
    returnSpot.current = null;
    setSpotlight(null);
    setShareLayout('focus');
  };

  // İZLENMEYEN uzak yayın izleyicide HİÇ render edilmez (içerik preview'ı bile
  // değil) — yalnız yayıncının kendi döşemesinde "canlı" rozet butonu belirir;
  // rozete tıklayınca izlenir, izlemeyi bırakınca yayın tamamen kaybolur ve
  // rozet geri gelir. Bu yüzden kamera durumundan bağımsız çalışır.
  const shareByIdentity = new Map(
    screens.filter((t) => !t.participant.isLocal).map((t) => [t.participant.identity, t]),
  );
  // canlı yayın rozeti — tıklayınca doğrudan spotlight almak yerine küçük
  // bir onay penceresi açılır: "katıl" / "vazgeç" (Discord Go Live mantığı;
  // istemeden spot alıp çağrı akışını bozmamak için)
  const [joinPrompt, setJoinPrompt] = useState<string | null>(null);
  const liveBadgeBtn = (identity: string): React.ReactNode => {
    const open = joinPrompt === identity;
    return (
      <div
        onClick={(e) => e.stopPropagation()}
        className="absolute right-2 top-2 z-10"
      >
        {open ? (
          <div className="flex flex-col gap-1.5 rounded-md border border-brass-600/70 bg-night-950/95 p-2 shadow-[0_8px_24px_-6px_rgba(0,0,0,0.7)]">
            <span className="font-display text-[10px] font-semibold uppercase tracking-[0.1em] text-stamp-400">
              {t('call.liveNow', { name: nickFor(identity) })}
            </span>
            <span className="text-[11px] text-paper-300">{t('stream.joinPrompt')}</span>
            <div className="flex gap-1.5">
              <button
                type="button"
                onClick={() => {
                  setJoinPrompt(null);
                  watchScreen(identity);
                }}
                className="flex-1 rounded border border-lamp-500/70 bg-lamp-100/60 px-2 py-1 text-[11px] font-semibold text-lamp-300 transition-colors hover:bg-lamp-500 hover:text-night-950"
                title={t('stream.badgeTitle')}
              >
                {t('stream.join')}
              </button>
              <button
                type="button"
                onClick={() => setJoinPrompt(null)}
                className="flex-1 rounded border border-night-700 px-2 py-1 text-[11px] text-paper-300 transition-colors hover:text-paper-100"
                title={t('stream.decline')}
              >
                {t('stream.decline')}
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setJoinPrompt(identity);
            }}
            className="flex items-center gap-1 rounded-sm border border-stamp-500/70 bg-night-950/85 px-1.5 py-0.5 font-display text-[9px] font-semibold uppercase tracking-[0.1em] text-stamp-400 transition-colors hover:bg-stamp-500 hover:text-white"
            title={t('stream.badgeTitle')}
          >
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-stamp-500" aria-hidden />
            {t('stream.badgeWatch')}
          </button>
        )}
      </div>
    );
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
    if (participants.length > prevCount.current) {
      returnSpot.current = null;
      setSpotlight(null);
    }
    prevCount.current = participants.length;
  }, [participants.length]);
  // prompt açıkken peer paylaşımı durdurursa havada kalmasın
  useEffect(() => {
    if (joinPrompt && !shareByIdentity.has(joinPrompt)) setJoinPrompt(null);
  }, [joinPrompt, shareByIdentity]);

  // KENDİ yayınım başlayınca büyük alanı yayın alsın — bayat spotlight (mesela
  // kamerası kapalı birine tıklayıp büyütülmüş odak) yayını şeritte küçülterek
  // gizlemesin. Başkasının yayını otomatik alınmaz: "canlı" döşemesi olarak
  // görünür, izleyici tıklayınca izler (Discord Watch Stream mantığı)
  const ownScreenCount = screens.filter((t) => t.participant.isLocal).length;
  const prevOwnScreens = useRef(0);
  useEffect(() => {
    if (ownScreenCount > prevOwnScreens.current) {
      returnSpot.current = null;
      setSpotlight(null);
      setShareLayout('focus');
    }
    prevOwnScreens.current = ownScreenCount;
  }, [ownScreenCount]);
  // side tercihi yayınsız kalmasın: yayınlar bitince sıfırla — kalan eski
  // 'side' bir sonraki UZAK yayını otomatik büyük gösterirdi (izleyici izlemeden
  // izleme moduna düşüyordu)
  useEffect(() => {
    if (screens.length === 0) setShareLayout('focus');
  }, [screens.length]);
  // izlenen yayın bitince spotlight'ı bırak — ölü screen: anahtarı odak boş
  // avatar placeholder'ına kilitler, kameraya dönemiyordun
  useEffect(() => {
    if (spotlight?.startsWith('screen:') && !screens.some((t) => `screen:${t.participant.identity}` === spotlight)) {
      returnSpot.current = null;
      setSpotlight(null);
      setShareLayout('focus');
    }
  }, [screens, spotlight]);

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
    const aspect = cam ? trackAspect(cam) : null;
    return cam ? (
      <SpeakingTile
        key={slotKey(p.identity)}
        participant={p}
        active={focused}
        onClick={() => toggleSpotlight('cam', p.identity)}
        title={focused ? t('stream.enlargeExit') : t('stream.enlarge')}
        style={aspect ? { aspectRatio: `${aspect}` } : undefined}
        className={`relative aspect-video w-full cursor-pointer overflow-hidden rounded-md border bg-night-850 ${TILE_HIDE}`}
      >
        <ParticipantTile
          trackRef={cam}
          className="h-full w-full [&_video]:h-full [&_video]:w-full [&_video]:object-contain"
        />
        <NamePlate participant={p} identity={p.identity} isLocal={p.isLocal} isScreen={false} isFocus={focused} />
        <MuteBadge participant={p} isScreen={false} />
        {shareByIdentity.has(p.identity) && liveBadgeBtn(p.identity)}
      </SpeakingTile>
    ) : (
      <SpeakingTile
        key={slotKey(p.identity)}
        participant={p}
        active={focused}
        onClick={() => toggleSpotlight('cam', p.identity)}
        title={focused ? t('stream.enlargeExit') : t('stream.enlarge')}
        className="flex aspect-video w-full cursor-pointer items-center justify-center overflow-hidden rounded-md border bg-night-850"
      >
        <Avatar userId={p.identity} label={nickFor(p.identity)} size={56} srcOverride={null} />
        <NamePlate participant={p} identity={p.identity} isLocal={p.isLocal} isScreen={false} isFocus={focused} />
        <MuteBadge participant={p} isScreen={false} />
        {shareByIdentity.has(p.identity) && liveBadgeBtn(p.identity)}
      </SpeakingTile>
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
      {t('call.stopShare')}
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
        <SpeakingTile
          key={v.key}
          participant={v.trackRef.participant}
          isScreen={v.isScreen}
          active={spotlight === v.key}
          onClick={() => (v.isScreen ? watchScreen(v.identity) : focusFromSide(v.identity))}
          title={v.isScreen ? t('stream.enlargeStream') : t('stream.enlarge')}
          className={`relative min-h-0 min-w-0 flex-1 cursor-pointer overflow-hidden rounded-md border bg-night-850 ${TILE_HIDE}`}
        >
          <ParticipantTile
            trackRef={v.trackRef}
            className="h-full w-full [&_video]:h-full [&_video]:w-full [&_video]:object-contain"
          />
          <NamePlate
            participant={v.trackRef.participant}
            identity={v.identity}
            isLocal={v.trackRef.participant.isLocal}
            isScreen={v.isScreen}
          />
          <MuteBadge participant={v.trackRef.participant} isScreen={v.isScreen} />
          {own && stopBtn(true)}
        </SpeakingTile>
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
              <SpeakingTile
                key={slotKey(p.identity)}
                participant={p}
                onClick={() => focusFromSide(p.identity)}
                title={t('stream.enlarge')}
                className="flex min-h-0 min-w-0 flex-1 cursor-pointer items-center justify-center overflow-hidden rounded-md border bg-night-850"
              >
                <Avatar userId={p.identity} label={nickFor(p.identity)} size={72} srcOverride={null} />
                <NamePlate participant={p} identity={p.identity} isLocal={p.isLocal} isScreen={false} />
                <MuteBadge participant={p} isScreen={false} />
              </SpeakingTile>
            ))}
        </div>
      </>
    );
  }

  // odak modu (Discord Go Live): odak/yayın büyük + ALT yatay şeritte TÜM
  // katılımcılar yan yana (akışı olanın tile'ı, olmayanın avatarı) — kimse
  // kaybolmaz
  if (focusedKey && (focusedVideo || focusPerson)) {
    const slotFor = (p: Participant): React.ReactNode => {
      // Şeritte hangi videolar gösterilir:
      //  - focused bir SCREEN ise, o kişinin kendi screen'i atlanır (büyük
      //    alanda zaten var — şeritte tekrarlanmasın). Kamerası kalır.
      //  - focused bir CAM ise, o kişinin kamerası da ŞERİTTE GÖRÜNÜR
      //    (büyük alan + şerit aynı anda; LiveKit tek track'ten 2 video
      //    elementi besler, Adaptive Stream aynı katmanı paylaşır).
      const focusedIsScreen = spotKind === 'screen';
      const pVideos = allVideos.filter(
        (v) => v.identity === p.identity && !(focusedIsScreen && v.key === focusedKey),
      );
      if (pVideos.length > 0) {
        return pVideos.map((v) => {
          const own = v.trackRef.participant.isLocal && v.isScreen;
          const aspect = trackAspect(v.trackRef);
          return (
            <SpeakingTile
              key={v.key}
              participant={v.trackRef.participant}
              isScreen={v.isScreen}
              active={spotlight === v.key}
              onClick={() => (v.isScreen ? watchScreen(v.identity) : spotCam(v.identity))}
              title={t('stream.enlarge')}
              style={aspect ? { aspectRatio: `${aspect}` } : undefined}
              className={`relative h-full aspect-video shrink-0 cursor-pointer overflow-hidden rounded-md border bg-night-850 ${TILE_HIDE}`}
            >
              <ParticipantTile
                trackRef={v.trackRef}
                className="h-full w-full [&_video]:h-full [&_video]:w-full [&_video]:object-contain"
              />
              <NamePlate
                participant={v.trackRef.participant}
                identity={v.identity}
                isLocal={v.trackRef.participant.isLocal}
                isScreen={v.isScreen}
              />
              <MuteBadge participant={v.trackRef.participant} isScreen={v.isScreen} />
              {own && stopBtn(true)}
            </SpeakingTile>
          );
        });
      }
      return (
        <SpeakingTile
          key={slotKey(p.identity) + '-slot'}
          participant={p}
          onClick={p.identity === focusId ? undefined : () => spotCam(p.identity)}
          title={p.identity === focusId ? undefined : t('stream.enlarge')}
          className="relative flex h-full aspect-video shrink-0 items-center justify-center overflow-hidden rounded-md border bg-night-850"
        >
          <Avatar userId={p.identity} label={nickFor(p.identity)} size={44} srcOverride={null} />
          <NamePlate participant={p} identity={p.identity} isLocal={p.isLocal} isScreen={false} />
          <MuteBadge participant={p} isScreen={false} />
        </SpeakingTile>
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
        <div className="flex min-h-0 flex-1 flex-col gap-2 p-3">
          <div className="flex min-h-0 min-w-0 flex-1">
            {focusedVideo ? (
              <VideoTile
                key={focusedVideo.key}
                trackRef={focusedVideo.trackRef}
                isScreen={focusedVideo.isScreen}
                isFocus={!!spotlight}
                fill
                title={focusedVideo.isScreen ? t('stream.sideBySide') : t('stream.enlargeExit')}
                onClick={() => {
                  if (focusedVideo.isScreen) setShareLayout((l) => (l === 'side' ? 'focus' : 'side'));
                  else releaseSpot();
                }}
                overlay={
                  <div className="absolute left-2 top-2 z-10 flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        releaseSpot();
                      }}
                      className="flex items-center gap-1 rounded-md border border-night-700 bg-night-950/85 px-2 py-1 text-xs font-semibold text-paper-300 transition-colors hover:text-paper-100"
                      title="Izgara görünümüne dön"
                    >
                      <LayoutGrid size={13} />
                      <span>Izgara</span>
                    </button>
                    {focusedVideo.trackRef.participant.isLocal && stopBtn(false)}
                    {focusedVideo.isScreen && !focusedVideo.trackRef.participant.isLocal && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          unwatch();
                        }}
                        className="rounded-md border border-night-700 bg-night-950/85 px-2 py-1 text-xs font-semibold text-paper-300 transition-colors hover:text-paper-100"
                        title={t('stream.leaveStream')}
                      >
                        {t('stream.leaveStreamBtn')}
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
                          title={shareMuted ? t('stream.unmute') : t('stream.mute')}
                          aria-label={shareMuted ? t('stream.unmute') : t('stream.mute')}
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
                          aria-label={t('stream.volLabel')}
                        />
                      </div>
                    )}
                  </div>
                }
              />
            ) : (
              focusPerson && (
                <SpeakingTile
                  key={focusedKey + '-ph'}
                  participant={focusPerson}
                  active
                  onClick={releaseSpot}
                  title={t('stream.enlargeExit')}
                  className="flex min-h-0 min-w-0 flex-1 cursor-pointer items-center justify-center overflow-hidden rounded-md border bg-night-850"
                >
                  <Avatar userId={focusId!} label={nickFor(focusId!)} size={96} srcOverride={null} />
                  <NamePlate participant={focusPerson} identity={focusId!} isLocal={focusPerson.isLocal} isScreen={false} isFocus />
                  <MuteBadge participant={focusPerson} isScreen={false} />
                </SpeakingTile>
              )
            )}
          </div>
          {/* Discord Go Live düzeni: herkes yayının altında yan yana yatay şeritte */}
          <div className="flex h-28 shrink-0 gap-2 overflow-x-auto">
            {participants.map(slotFor)}
          </div>
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
        <div className="flex min-h-0 flex-1 items-center justify-center gap-3 p-4">
          {participants.map((p) => {
            const cam = camByIdentity.get(p.identity);
            const focused = spotlight === `cam:${p.identity}`;
            // çerçeve görüntüyü sarsın — flex-1 dolu kutu değil, yayın
            // oranında (bilinmiyorsa 16:9) sahneye sığan pencere
            const aspect = cam ? (trackAspect(cam) ?? 16 / 9) : 16 / 9;
            return (
              <SpeakingTile
                key={slotKey(p.identity)}
                participant={p}
                active={focused}
                onClick={() => toggleSpotlight('cam', p.identity)}
                title={focused ? t('stream.enlargeExit') : t('stream.enlarge')}
                style={{ aspectRatio: `${aspect}` }}
                className={`relative h-full min-w-0 max-w-full w-auto cursor-pointer overflow-hidden rounded-md border bg-night-850 ${TILE_HIDE}`}
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
                <NamePlate participant={p} identity={p.identity} isLocal={p.isLocal} isScreen={false} isFocus={focused} />
                <MuteBadge participant={p} isScreen={false} />
                {shareByIdentity.has(p.identity) && liveBadgeBtn(p.identity)}
              </SpeakingTile>
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