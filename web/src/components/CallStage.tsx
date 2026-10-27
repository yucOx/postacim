import { useEffect, useRef, useState } from 'react';
import { ParticipantTile, useParticipants, useTracks, AudioTrack, useIsMuted } from '@livekit/components-react';
import { Track } from 'livekit-client';
import type { Participant } from 'livekit-client';
import type { TrackReference } from '@livekit/components-react';
import { MicOff, ShieldCheck, Volume2, VolumeX } from 'lucide-react';
import { nickFor } from '../lib/nick';
import { useT } from '../i18n/I18nProvider';
import { useVoiceStore } from '../state/voiceStore';
import { useAuthStore } from '../state/authStore';
import { useSafeIsSpeaking } from '../lib/speaking';
import Avatar from './Avatar';
import ParticipantMenu from './ParticipantMenu';

/** Remote mic audio — invisible <audio> elements. Without this nothing in the
 *  app attaches RemoteAudioTracks (stage tiles are video-only), so peers would
 *  publish fine but nobody would hear them. Local mic is never attached (echo). */
function RemoteAudio(): React.ReactNode {
  const tracks = useTracks([Track.Source.Microphone], { onlySubscribed: true });
  const volume = useVoiceStore((s) => s.volume);
  const deafened = useVoiceStore((s) => s.deafened);
  // kişi bazlı kısma/susturma (sağ tık menüsünden ayarlanır); kayıt yoksa
  // ana seviye uygulanır
  const userVolumes = useVoiceStore((s) => s.userVolumes);
  const userMuted = useVoiceStore((s) => s.userMuted);
  return (
    <>
      {tracks
        .filter((t) => !t.participant.isLocal)
        .map((t) => {
          const id = t.participant.identity;
          const level = userVolumes[id] ?? volume;
          const muted = deafened || !!userMuted[id];
          return (
            <AudioTrack
              key={id}
              trackRef={t}
              volume={muted ? 0 : level}
              muted={muted}
              className="hidden"
            />
          );
        })}
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

  // teşhis: yayın sesinin gelip gelmediğini konsola doğrudur (gelen mesaj
  // yoksa sorun gönderimde, kayıt varsa alıcı tarafta)
  useEffect(() => {
    console.debug(
      '[share-audio] track sayısı:',
      tracks.length,
      '| izlenen:',
      activeIds,
      '| muted:',
      muted,
      '| ses:',
      deafened || muted ? 0 : masterVol * volume,
    );
  }, [tracks, activeIds, muted, deafened, masterVol, volume]);

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

function NamePlate({
  participant,
  identity,
  isLocal,
  isScreen,
  isFocus,
  silentStream,
}: {
  participant?: Participant;
  identity: string;
  isLocal: boolean;
  isScreen: boolean;
  isFocus?: boolean;
  /** yayın ses track'i yok — izleyici sessiz yayını bozuk sesle
   *  karıştırmasın (yayıncıya zaten toast gidiyor) */
  silentStream?: boolean;
}): React.ReactNode {
  const { t } = useT();
  // medya gönderen atfı: Ed25519 imzalı duyuru doğrulanmış mı (kötü sunucunun
  // hayalet identity'si imzalıyamaz → rozet çıkmaz)
  const attested = useVoiceStore((s) => !!s.attested[identity]);
  return (
    <span className="pointer-events-none absolute bottom-2 left-2 z-10 flex max-w-[calc(100%-3rem)] items-center gap-1.5 rounded-sm border border-brass-700/60 bg-night-950/85 px-2 py-0.5">
      <span className="truncate font-display text-xs font-semibold uppercase tracking-[0.1em] text-paper-50">
        {nickFor(identity)}
        {isLocal && ` (${t('call.nameSelf')})`}
      </span>
      {attested && !isLocal && (
        <span className="flex shrink-0 text-emerald-400" title={t('call.verifiedSender')}>
          <ShieldCheck size={11} aria-hidden />
        </span>
      )}
      {isScreen && <span className="shrink-0 font-mono text-[9px] text-lamp-400">{t('call.nameScreen')}</span>}
      {isFocus && <span className="shrink-0 font-mono text-[9px] text-lamp-400">{t('call.nameFocus')}</span>}
      {silentStream && (
        <span
          className="flex shrink-0 items-center gap-0.5 font-mono text-[9px] text-stamp-400"
          title={t('stream.silentHint')}
        >
          <VolumeX size={10} /> {t('stream.silent')}
        </span>
      )}
    </span>
  );
}

// livekit's ParticipantTile renders its own (unstyled) nameplate + mute badges
// which overlap ours — hide them wherever we draw our own plate
const TILE_HIDE =
  ' [&_.lk-participant-name]:hidden [&_.lk-track-muted-indicator-microphone]:hidden [&_.lk-track-muted-indicator-camera]:hidden';

// kamerayı kapatan katılımcının döşemesi bu oranda "video kutusu" çizer —
// webcam'ler ezici çoğunlukla 16:9 (trackAspect'in bilinmeyen-oran
// fallback'i de 16/9): kapalı-kamera kutusu açık-kamera görüntüsüyle
// aynı boyutta durur
const AVATAR_ASPECT = 16 / 9;

/** object-contain video'nun gerçekte kapladığı dikdörtgen — SpeakingTile
 *  [container-type:size] olduğu için cq birimleri tile boyutunu verir;
 *  letterbox matematiği birebir hesaplanır (contain = min(100cqw, 100cqh·r)
 *  × min(100cqh, 100cqw/r)). İsim/mikrofon plakası ve tıklama hedefi KAMERA
 *  GÖRÜNTÜSÜNÜN üstünde durur (Discord), alttaki karanlık bantta değil.
 *  onClick verilirse tıklama YALNIZ bu kutuda çalışır — karanlık letterbox
 *  bantları tıklamayı yutar (odak değişmez), imleç de yalnız görüntüde
 *  pointer olur. */
function VideoFit({
  aspect,
  children,
  onClick,
}: {
  aspect: number | null;
  children?: React.ReactNode;
  onClick?: () => void;
}): React.ReactNode {
  const r = aspect && aspect > 0 ? aspect : 16 / 9;
  return (
    <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
      <div
        onClick={onClick}
        className={`relative ${onClick ? 'pointer-events-auto cursor-pointer' : 'pointer-events-none'}`}
        style={{
          width: `min(100cqw, calc(100cqh * ${r}))`,
          height: `min(100cqh, calc(100cqw / ${r}))`,
        }}
      >
        {children}
      </div>
    </div>
  );
}

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
  /** video/avatarun gerçek en-boy oranı — ring TAM OLARAK görüntünün
   *  çevresine çizilir (letterbox karanlık bantlarına değil, Discord gibi).
   *  Verilmezse ring tile'ın tümüne çizilir (geriye dönük uyumluluk). */
  aspect?: number | null;
  className?: string;
  children?: React.ReactNode;
  onClick?: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
  title?: string;
  style?: React.CSSProperties;
}

function SpeakingTile({
  participant,
  isScreen = false,
  active = false,
  aspect,
  className = '',
  children,
  onClick,
  onContextMenu,
  title,
  style,
}: SpeakingTileProps): React.ReactNode {
  const isSpeaking = useSafeIsSpeaking(participant);
  // kart çerçevesi yok (Discord: video doğrudan koyu zeminde durur); konuşma
  // ve odak geri bildirimi yalnız ince bir ring olarak çizilir — VideoFit
  // matematiğiyle görüntünün dikdörtgenine oturur. ring-inset şart: dışa çizilen
  // ring video tile kenarına değince overflow-hidden tarafından kırpılıyordu
  const ring = !isScreen && isSpeaking
    ? 'rounded-md ring-inset ring-2 ring-emerald-500 shadow-[0_0_12px_rgba(16,185,129,0.45)]'
    : active
      ? 'rounded-md ring-inset ring-1 ring-lamp-500/50'
      : '';
  const r = aspect && aspect > 0 ? aspect : 16 / 9;
  return (
    <div
      onClick={onClick}
      onContextMenu={onContextMenu}
      title={title}
      style={style}
      className={`[container-type:size] transition-all duration-150 ${aspect === undefined ? ring : ''} ${className}`}
    >
      {children}
      {ring &&
        (aspect === undefined ? null : (
          // ring yalnız görüntünün çevresinde — tıklamaları geçirir
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
            <div
              className={ring}
              style={{
                width: `min(100cqw, calc(100cqh * ${r}))`,
                height: `min(100cqh, calc(100cqw / ${r}))`,
              }}
            />
          </div>
        ))}
    </div>
  );
}

interface TileProps {
  trackRef: TrackReference;
  isScreen?: boolean;
  isFocus?: boolean;
  /** uzak yayın ses track'i yok — plakada "sessiz yayın" rozeti */
  silent?: boolean;
  /** absolute overlay inside the tile (e.g. the sharer's stop button) */
  overlay?: React.ReactNode;
  onContextMenu?: (e: React.MouseEvent) => void;
  /** video görüntüsüne tıklama (Discord: kamera → grid, yayın → yan yana) */
  onVideoClick?: () => void;
}

/** Odak modunun büyük döşemesi — yalnız KAMERA GÖRÜNTÜSÜ tıklanabilir
 *  (VideoFit kutusu); karanlık letterbox alanına tıklamak hiçbir şey yapmaz. */
function VideoTile({ trackRef, isScreen = false, isFocus = false, silent = false, overlay, onContextMenu, onVideoClick }: TileProps): React.ReactNode {
  const aspect = trackAspect(trackRef);
  return (
    <SpeakingTile
      participant={trackRef.participant}
      isScreen={isScreen}
      aspect={aspect}
      onContextMenu={onContextMenu}
      className="relative min-h-0 min-w-0 flex-1 overflow-hidden rounded-md [&_video]:object-contain"
    >
      <div className={`h-full w-full ${TILE_HIDE}`}>
        <ParticipantTile trackRef={trackRef} className="h-full w-full [&_video]:h-full [&_video]:w-full" />
      </div>
      <VideoFit aspect={aspect} onClick={onVideoClick}>
        <NamePlate
          participant={trackRef.participant}
          identity={trackRef.participant.identity}
          isLocal={trackRef.participant.isLocal}
          isScreen={isScreen}
          isFocus={isFocus}
          silentStream={silent}
        />
        <MuteBadge participant={trackRef.participant} isScreen={isScreen} />
      </VideoFit>
      {overlay}
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
export default function CallStage({
  emptyLabel,
  dockH = 0,
}: {
  emptyLabel?: string;
  /** altta mutlak duran kontrol panelinin yüksekliği (px) — video alanı
   *  onun altına girmesin diye alt boşluk bırakılır */
  dockH?: number;
}): React.ReactNode {
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
  // hangi yayınlarda SES track'i var? Yayıncının tarayıcısı getDisplayMedia'dan
  // audio alamadıysa (pencere her yerde; Linux'ta ekran da) ScreenShareAudio
  // publication'ı hiç oluşmaz — izleyici "sessiz yayın" rozetiyle ayırt eder
  const shareAudioRefs = useTracks([Track.Source.ScreenShareAudio], { onlySubscribed: false });
  const shareAudioIds = new Set(
    shareAudioRefs.filter((r) => r.publication).map((r) => r.participant.identity),
  );
  const streamSilent = (identity: string): boolean => !shareAudioIds.has(identity);
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
  const spotId = spotlight?.split(':')[1] ?? null;

  // Discord tarzı sağ tık: kutuya sağ tık → kişi/yayın ses menüsü
  const [ctxTarget, setCtxTarget] = useState<{ x: number; y: number; identity: string; nick: string; hasShare: boolean; isSelf: boolean } | null>(null);
  const openCtx = (identity: string, nick: string, hasShare: boolean) => (e: React.MouseEvent): void => {
    e.preventDefault();
    e.stopPropagation();
    setCtxTarget({
      x: e.clientX,
      y: e.clientY,
      identity,
      nick,
      hasShare,
      isSelf: identity === useAuthStore.getState().user?.id,
    });
  };

  const toggleScreen = useVoiceStore((s) => s.toggleScreen);
  // paylaşım görünümü yerleşimi: odak (büyük + sağ şerit) / yan yana eşit bölmeler
  const [shareLayout, setShareLayout] = useState<'focus' | 'side'>('focus');
  // izleyici yayın sesi: 0-1 + sessize alma (ekran paylaşımı sesi)
  // yayın sesi seviyesi/kesme store'da — sağ tık menüsü ve sahne kontrolü
  // aynı değeri paylaşsın (iki ayrı gerçek olmasın)
  const shareVolume = useVoiceStore((s) => s.shareVolume);
  const setShareVolume = useVoiceStore((s) => s.setShareVolume);
  const shareMuted = useVoiceStore((s) => s.shareMuted);
  const toggleShareMuted = useVoiceStore((s) => s.toggleShareMuted);

  const toggleSpotlight = (kind: 'screen' | 'cam', identity: string): void => {
    const key = `${kind}:${identity}`;
    if (spotlight === key) {
      suppressAutoFocus.current = true;
      setSpotlight(null);
      return;
    }
    // büyütme anındaki yerleşimi mühürle — küçültünce buraya dön (bayat
    // eski 'side' tercihi istemsizce yan yana düzen açmasın)
    returnLayout.current = shareLayout;
    setSpotlight(key);
  };

  // odağa geçmeden önceki yayın yerleşimi — odaklı kamerayı küçültünce
  // geldiğin yerleşime dön (side'dan büyüttüysen side'a düş)
  const returnLayout = useRef<'focus' | 'side'>('focus');
  // kullanıcı odaktan açıkça ÇIKTI: kendi yayını canlı olsa bile oto-odak
  // (kendi yayınını büyütme) bir sonraki paylaşım başlayana kadar kapalı —
  // yoksa odaktan çıkmak tek tıkla olmuyordu (çıkınca kendi yayını büyüyordu)
  const suppressAutoFocus = useRef(false);
  const spotCam = (identity: string): void => {
    returnLayout.current = shareLayout;
    setSpotlight(`cam:${identity}`);
  };
  // tek tıkta tam çıkış — izlenen yayına geri ZIPLAMA yok; çıkış = çıkış.
  // Yayın canlı kalırsa canlı rozetinden tekrar izlenir
  const releaseSpot = (): void => {
    suppressAutoFocus.current = true;
    setSpotlight(null);
    setShareLayout(returnLayout.current);
  };

  // bir yayını izlemeye başla (canlı döşemesi / şerit / side bölmesi) — çıkışta
  // hep düz kamera düzenine dönmek için yerleşimi odak'a sabitleriz
  const watchScreen = (identity: string): void => {
    returnLayout.current = 'focus';
    setSpotlight(`screen:${identity}`);
    setShareLayout('focus');
  };
  // izlemeyi bırak: spotlight'ı bırak + kamera düzenine dön — returnLayout'a
  // güvenme, eski 'side' tercihi yayını tekrar büyük gösterebilir
  const unwatch = (): void => {
    suppressAutoFocus.current = true;
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
  // YAYIN SESİ yalnız İZLENEN yayına bağlanır. Yorum "yalnız izlenen
  // yayının sahibi bağlanır" diyordu ama activeIds tüm uzak yayınları
  // listeliyordu: iki kişi aynı anda yayın yapınca ikisinin sesi de
  // (birbirine karışarak) duyuluyordu. İzlenen yayın yoksa sessiz.
  const watchedScreenId = spotlight?.startsWith('screen:') ? spotlight.split(':')[1] : null;
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
            title={streamSilent(identity) ? `${t('stream.badgeTitle')} — ${t('stream.silent')}` : t('stream.badgeTitle')}
          >
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-stamp-500" aria-hidden />
            {t('stream.badgeWatch')}
            {streamSilent(identity) && <VolumeX size={10} aria-label={t('stream.silent')} />}
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

  // prompt açıkken peer paylaşımı durdurursa havada kalmasın
  useEffect(() => {
    if (joinPrompt && !shareByIdentity.has(joinPrompt)) setJoinPrompt(null);
  }, [joinPrompt, shareByIdentity]);

  // KENDİ yayınım başlayınca büyük alanı yayın alsın — bayat spotlight (mesela
  // kamerası kapalı birine tıklayıp büyütülmüş odak) yayını şeritte küçülterek
  // gizlemesin. Başkasının yayını otomatik alınmaz: "canlı" döşemesi olarak
  // görünür, izleyici tıklayınca izler (Discord Watch Stream mantığı).
  // Paylaşım (yeniden) başlarken oto-odak baskısı da sıfırlanır — kullanıcının
  // önceki "odaktan çık" kararı yeni yayını büyütmemeli
  const ownScreenCount = screens.filter((t) => t.participant.isLocal).length;
  const prevOwnScreens = useRef(0);
  useEffect(() => {
    if (ownScreenCount > prevOwnScreens.current) {
      suppressAutoFocus.current = false;
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
      setSpotlight(null);
      setShareLayout('focus');
    }
  }, [screens, spotlight]);

  // Discord tarzı sağ tık menüsü (her düzende ortak)
  const ctxMenu = ctxTarget && (
    <ParticipantMenu
      x={ctxTarget.x}
      y={ctxTarget.y}
      identity={ctxTarget.identity}
      nick={ctxTarget.nick}
      hasShare={ctxTarget.hasShare}
      isSelf={ctxTarget.isSelf}
      onClose={() => setCtxTarget(null)}
    />
  );

  if (participants.length === 0) {
    return (
      <>
        {ctxMenu}
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
        aspect={aspect}
        onContextMenu={openCtx(p.identity, nickFor(p.identity), shareByIdentity.has(p.identity))}
        title={focused ? t('stream.enlargeExit') : t('stream.enlarge')}
        className={`relative min-h-0 min-w-0 flex-1 overflow-hidden rounded-md ${TILE_HIDE}`}
      >
        <ParticipantTile
          trackRef={cam}
          className="h-full w-full [&_video]:h-full [&_video]:w-full [&_video]:object-contain"
        />
        <VideoFit aspect={aspect} onClick={() => toggleSpotlight('cam', p.identity)}>
          <NamePlate participant={p} identity={p.identity} isLocal={p.isLocal} isScreen={false} isFocus={focused} />
          <MuteBadge participant={p} isScreen={false} />
        </VideoFit>
        {shareByIdentity.has(p.identity) && liveBadgeBtn(p.identity)}
      </SpeakingTile>
    ) : (
      <SpeakingTile
        key={slotKey(p.identity)}
        participant={p}
        active={focused}
        aspect={AVATAR_ASPECT}
        onContextMenu={openCtx(p.identity, nickFor(p.identity), shareByIdentity.has(p.identity))}
        title={focused ? t('stream.enlargeExit') : t('stream.enlarge')}
        className="relative flex min-h-0 min-w-0 flex-1 items-center justify-center overflow-hidden rounded-md"
      >
        <VideoFit aspect={AVATAR_ASPECT} onClick={() => toggleSpotlight('cam', p.identity)}>
          <div className="flex h-full w-full items-center justify-center rounded-md bg-night-850">
            <Avatar userId={p.identity} label={nickFor(p.identity)} size={56} srcOverride={null} />
          </div>
          <NamePlate participant={p} identity={p.identity} isLocal={p.isLocal} isScreen={false} isFocus={focused} />
          <MuteBadge participant={p} isScreen={false} />
        </VideoFit>
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
  // dayatılmaz, canlı döşemesi olarak izlemesi için bekler (Discord akışı).
  // Kullanıcı odaktan açıkça çıktıysa (suppressAutoFocus) kendi yayını bile
  // yeniden büyütülmez — yoksa çıkış tek tıkla olmaz
  const autoFocusVideo =
    spotlight || suppressAutoFocus.current
      ? null
      : (allVideos.find((v) => v.isScreen && v.trackRef.participant.isLocal) ?? null);
  const focusedKey = spotlight ?? (autoFocusVideo?.key ?? null);
  const focusedVideo = focusedKey ? (allVideos.find((v) => v.key === focusedKey) ?? null) : null;
  const focusId = focusedKey?.split(':')[1] ?? null;
  const focusPerson = focusId ? participants.find((p) => p.identity === focusId) ?? null : null;

  // yan yana mod: ekran paylaşımı + tüm akışlar/avatarlar eşit bölmeler
  if (screens.length > 0 && shareLayout === 'side') {
    const paneFor = (v: { key: string; trackRef: TrackReference; isScreen: boolean; identity: string }): React.ReactNode => {
      const own = v.trackRef.participant.isLocal && v.isScreen;
      const silent = v.isScreen && !v.trackRef.participant.isLocal && streamSilent(v.identity);
      return (
        <SpeakingTile
          key={v.key}
          participant={v.trackRef.participant}
          isScreen={v.isScreen}
          active={spotlight === v.key}
          aspect={trackAspect(v.trackRef)}
          onContextMenu={openCtx(v.identity, nickFor(v.identity), v.isScreen)}
          title={v.isScreen ? t('stream.enlargeStream') : t('stream.enlarge')}
          className={`relative min-h-0 min-w-0 flex-1 overflow-hidden rounded-md ${TILE_HIDE}`}
        >
          <ParticipantTile
            trackRef={v.trackRef}
            className="h-full w-full [&_video]:h-full [&_video]:w-full [&_video]:object-contain"
          />
          <VideoFit
            aspect={trackAspect(v.trackRef)}
            onClick={() => (v.isScreen ? watchScreen(v.identity) : focusFromSide(v.identity))}
          >
            <NamePlate
              participant={v.trackRef.participant}
              identity={v.identity}
              isLocal={v.trackRef.participant.isLocal}
              isScreen={v.isScreen}
              silentStream={silent}
            />
            <MuteBadge participant={v.trackRef.participant} isScreen={v.isScreen} />
          </VideoFit>
          {own && stopBtn(true)}
        </SpeakingTile>
      );
    };
    const videoIds = new Set(allVideos.map((v) => v.identity));
    return (
      <>
        {ctxMenu}
        <RemoteAudio />
        <ShareAudio
          volume={shareVolume}
          muted={shareMuted}
          activeIds={watchedScreenId ? [watchedScreenId] : []}
        />
        <div className="flex min-h-0 flex-1 gap-2 p-1.5" style={{ paddingBottom: dockH + 6 }}>
          {allVideos.map(paneFor)}
          {participants
            .filter((p) => !videoIds.has(p.identity))
            .map((p) => (
              <SpeakingTile
                key={slotKey(p.identity)}
                participant={p}
                aspect={AVATAR_ASPECT}
                onContextMenu={openCtx(p.identity, nickFor(p.identity), shareByIdentity.has(p.identity))}
                title={t('stream.enlarge')}
                className="relative flex min-h-0 min-w-0 flex-1 items-center justify-center overflow-hidden rounded-md"
              >
                <VideoFit aspect={AVATAR_ASPECT} onClick={() => focusFromSide(p.identity)}>
                  <div className="flex h-full w-full items-center justify-center rounded-md bg-night-850">
                    <Avatar userId={p.identity} label={nickFor(p.identity)} size={72} srcOverride={null} />
                  </div>
                  <NamePlate participant={p} identity={p.identity} isLocal={p.isLocal} isScreen={false} />
                  <MuteBadge participant={p} isScreen={false} />
                </VideoFit>
              </SpeakingTile>
            ))}
        </div>
      </>
    );
  }

  // odak modu (Discord): odak/yayın büyük + ALT yatay şeritte TÜM katılımcılar
  // yan yana (akışı olanın tile'ı, olmayanın avatarı) — kimse kaybolmaz.
  // Discord gibi tıklama her kişi sayısında odak moduna sokar; odak yokken
  // 1-2 kişi aşağıdaki eşit grid dalında kalır.
  if (focusedKey && (focusedVideo || focusPerson)) {
    const slotFor = (p: Participant): React.ReactNode => {
      // Şeritte hangi videolar gösterilir:
      //  - focused bir SCREEN ise, o kişinin kendi screen'i atlanır (büyük
      //    alanda zaten var — şeritte tekrarlanmasın). Kamerası kalır.
      //  - focused bir CAM ise, o kişinin kamerası da ŞERİTTE GÖRÜNÜR
      //    (büyük alan + şerit aynı anda; LiveKit tek track'ten 2 video
      //    elementi besler, Adaptive Stream aynı katmanı paylaşır).
      // Kendi yayınım AUTO-odaklıyken (spotlight null, autoFocusVideo) de
      // focusedIsScreen doğru olmalı — yoksa şerit büyük alandaki yayını
      // tekrar eder ve iki 'paylaşımı durdur' butonu görünür.
      const focusedIsScreen = focusedKey?.startsWith('screen:') ?? false;
      const pVideos = allVideos.filter(
        (v) => v.identity === p.identity && !(focusedIsScreen && v.key === focusedKey),
      );
      if (pVideos.length > 0) {
        return pVideos.map((v) => {
          const own = v.trackRef.participant.isLocal && v.isScreen;
          const silent = v.isScreen && !v.trackRef.participant.isLocal && streamSilent(v.identity);
          const aspect = trackAspect(v.trackRef);
          return (
            <SpeakingTile
              key={v.key}
              participant={v.trackRef.participant}
              isScreen={v.isScreen}
              active={spotlight === v.key}
              aspect={aspect}
              onContextMenu={openCtx(v.identity, nickFor(v.identity), v.isScreen)}
              title={t('stream.enlarge')}
              className={`relative h-full min-h-0 min-w-0 overflow-hidden rounded-md ${TILE_HIDE}`}
              style={{ aspectRatio: aspect ?? 16 / 9 }}
            >
              <ParticipantTile
                trackRef={v.trackRef}
                className="h-full w-full [&_video]:h-full [&_video]:w-full [&_video]:object-contain"
              />
              <VideoFit aspect={aspect} onClick={() => (v.isScreen ? watchScreen(v.identity) : spotCam(v.identity))}>
                <NamePlate
                  participant={v.trackRef.participant}
                  identity={v.identity}
                  isLocal={v.trackRef.participant.isLocal}
                  isScreen={v.isScreen}
                  silentStream={silent}
                />
                <MuteBadge participant={v.trackRef.participant} isScreen={v.isScreen} />
              </VideoFit>
              {own && stopBtn(true)}
            </SpeakingTile>
          );
        });
      }
      return (
        <SpeakingTile
          key={slotKey(p.identity) + '-slot'}
          participant={p}
          aspect={AVATAR_ASPECT}
          onClick={p.identity === focusId ? undefined : () => spotCam(p.identity)}
          onContextMenu={openCtx(p.identity, nickFor(p.identity), shareByIdentity.has(p.identity))}
          title={p.identity === focusId ? undefined : t('stream.enlarge')}
          className={`relative h-full min-h-0 min-w-0 overflow-hidden rounded-md ${
            p.identity === focusId ? '' : 'cursor-pointer'
          }`}
          style={{ aspectRatio: AVATAR_ASPECT }}
        >
          <div className="flex h-full w-full items-center justify-center bg-night-850">
            <Avatar userId={p.identity} label={nickFor(p.identity)} size={44} srcOverride={null} />
          </div>
          <NamePlate participant={p} identity={p.identity} isLocal={p.isLocal} isScreen={false} />
          <MuteBadge participant={p} isScreen={false} />
        </SpeakingTile>
      );
    };
    return (
      <>
        {ctxMenu}
        <RemoteAudio />
        <ShareAudio
          volume={shareVolume}
          muted={shareMuted}
          // odak kamerada olsa bile YAYIN sesi duyulur (Discord): ses kaynağı
          // ayrı bir track, hangi kutuya baktığımızla ilgisi yok. Yalnız
          // İZLENEN yayının sahibi bağlanır.
          activeIds={watchedScreenId ? [watchedScreenId] : []}
        />
        <div className="flex min-h-0 flex-1 flex-col gap-2 p-1.5" style={{ paddingBottom: dockH + 6 }}>
          <div className="flex min-h-0 min-w-0 flex-1">
            {focusedVideo ? (
              <VideoTile
                key={focusedVideo.key}
                trackRef={focusedVideo.trackRef}
                isScreen={focusedVideo.isScreen}
                isFocus={!!spotlight}
                silent={focusedVideo.isScreen && !focusedVideo.trackRef.participant.isLocal && streamSilent(focusedVideo.identity)}
                onVideoClick={() => {
                  if (focusedVideo.isScreen) setShareLayout((l) => (l === 'side' ? 'focus' : 'side'));
                  else releaseSpot();
                }}
                onContextMenu={openCtx(
                  focusedVideo.identity,
                  nickFor(focusedVideo.identity),
                  focusedVideo.isScreen,
                )}
                overlay={
                  <div className="absolute left-2 top-2 z-10 flex items-center gap-1.5">
                    {focusedVideo.isScreen && focusedVideo.trackRef.participant.isLocal && stopBtn(false)}
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
                            toggleShareMuted();
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
                            if (shareMuted) toggleShareMuted();
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
                  aspect={AVATAR_ASPECT}
                  onContextMenu={openCtx(focusId!, nickFor(focusId!), shareByIdentity.has(focusId!))}
                  title={t('stream.enlargeExit')}
                  className="relative flex min-h-0 min-w-0 flex-1 items-center justify-center overflow-hidden rounded-md"
                >
                  <VideoFit aspect={AVATAR_ASPECT} onClick={releaseSpot}>
                    <div className="flex h-full w-full items-center justify-center rounded-md bg-night-850">
                      <Avatar userId={focusId!} label={nickFor(focusId!)} size={96} srcOverride={null} />
                    </div>
                    <NamePlate participant={focusPerson} identity={focusId!} isLocal={focusPerson.isLocal} isScreen={false} isFocus />
                    <MuteBadge participant={focusPerson} isScreen={false} />
                  </VideoFit>
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
        {ctxMenu}
        <RemoteAudio />
        {/* Dış çerçeve tüm alanı kaplar (koyu). 1-2 video YAN YANA eşit
            kutular halinde alanı DOLDURUR (flex-1, ortak yükseklik);
            video object-contain ile kendi oranında kalır, kırpılmaz.
            Ortada minik kalmalar diye items-stretch + w-full. */}
        <div className="flex min-h-0 w-full flex-1 items-stretch justify-center gap-3 p-1.5" style={{ paddingBottom: dockH + 6 }}>
          {participants.map((p) => {
            const cam = camByIdentity.get(p.identity);
            const focused = spotlight === `cam:${p.identity}`;
            const aspect = cam ? trackAspect(cam) : AVATAR_ASPECT;
            // Kutu alanı DOLDURUR (flex-1 + h-full, ortak yükseklik, 1:1
            // paylaşım). Video object-contain: kendi oranında, kırpılmaz.
            // Kameranın oranı kutuya göre farklıysa koyu bant kalır —
            // iki video arasında biri büyük biri küçük olmaz.
            return (
              <SpeakingTile
                key={slotKey(p.identity)}
                participant={p}
                active={focused}
                aspect={aspect}
                onContextMenu={openCtx(p.identity, nickFor(p.identity), shareByIdentity.has(p.identity))}
                title={focused ? t('stream.enlargeExit') : t('stream.enlarge')}
                className={`relative min-h-0 min-w-0 flex-1 overflow-hidden rounded-md ${TILE_HIDE}`}
              >
                {cam ? (
                  <>
                    <ParticipantTile
                      trackRef={cam}
                      className="h-full w-full [&_video]:h-full [&_video]:w-full [&_video]:object-contain"
                    />
                    <VideoFit aspect={aspect} onClick={() => toggleSpotlight('cam', p.identity)}>
                      <NamePlate participant={p} identity={p.identity} isLocal={p.isLocal} isScreen={false} isFocus={focused} />
                      <MuteBadge participant={p} isScreen={false} />
                    </VideoFit>
                  </>
                ) : (
                  <VideoFit aspect={AVATAR_ASPECT} onClick={() => toggleSpotlight('cam', p.identity)}>
                    <div className="flex h-full w-full items-center justify-center rounded-md bg-night-850">
                      <Avatar userId={p.identity} label={nickFor(p.identity)} size={104} srcOverride={null} />
                    </div>
                    <NamePlate participant={p} identity={p.identity} isLocal={p.isLocal} isScreen={false} isFocus={focused} />
                    <MuteBadge participant={p} isScreen={false} />
                  </VideoFit>
                )}
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
      {ctxMenu}
      <RemoteAudio />
      <div
        className="grid flex-1 auto-rows-fr content-center gap-3 overflow-y-auto p-1.5"
        style={{
          gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
          paddingBottom: dockH + 6,
        }}
      >
        {participants.map((p) => stripTile(p))}
      </div>
    </>
  );
}