import { useEffect, useState } from 'react';
import { ChevronUp, Maximize, Mic, MicOff, Minimize, MonitorUp, PhoneOff, PictureInPicture2, Signal, Video, VideoOff, Volume2, VolumeX } from 'lucide-react';
import { useLocalParticipant } from '@livekit/components-react';
import { useVoiceStore, type CallQuality, type ShareOpts } from '../state/voiceStore';
import DeviceMenu from './DeviceMenu';
import Modal from './Modal';
import { useT } from '../i18n/I18nProvider';

// diyalogdaki çözünürlük satırları; kalite ayarına göre ön seçilir.
// 1440p bilinçli yok — tek yayıncı bile SFU'yu doldurur (kaynak limiti:
// küçük VPS); kaliteli yayın için tavan 1080p30.
// (etiketler sabit: 360p/480p… — sayısal, dile bağlı değil)
const RES_ROWS: { h: number; w: number; label: string }[] = [
  { h: 360, w: 640, label: '360p' },
  { h: 480, w: 854, label: '480p' },
  { h: 720, w: 1280, label: '720p' },
  { h: 1080, w: 1920, label: '1080p' },
];
const FPS_ROWS: Array<ShareOpts['fps']> = [15, 30, 60];
// kaynak ipucu — tarayıcının seçim ekranında o kategoriye ön seçilir
// (etiketler useT ile çevrilir, aşağıda)
const SURFACE_KEYS: ShareOpts['surface'][] = ['monitor', 'window', 'browser'];
const QUALITY_TO_RES: Record<CallQuality, number> = { hizli: 360, dengeli: 720, yuksek: 1080 };
// Linux'ta tarayıcılar getDisplayMedia'da ekran/pencere yüzeyleri için audio
// track ÜRETMEZ (yalnız sekme + "sekme sesini de paylaş" kutusu işaretliyken)
// — ses istenmişse kullanıcıyı önceden uyar, başladıktan sonra sessiz kalmasın
const UA_PLATFORM =
  (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ??
  navigator.platform;
const IS_LINUX = /linux/i.test(UA_PLATFORM) && !/android/i.test(navigator.userAgent);

/** Shared call control bar — DM calls and community voice rooms differ only
 *  in their end action and whether minimize-to-PiP exists. */
export default function CallControls({
  variant,
  onEnd,
  endLabel,
  onMinimize,
}: {
  variant: 'call' | 'room';
  onEnd: () => void;
  endLabel: string;
  onMinimize?: () => void;
}) {
  const micOn = useVoiceStore((s) => s.micOn);
  const camOn = useVoiceStore((s) => s.camOn);
  const screenOn = useVoiceStore((s) => s.screenOn);
  const quality = useVoiceStore((s) => s.quality);
  const toggleMic = useVoiceStore((s) => s.toggleMic);
  const toggleCam = useVoiceStore((s) => s.toggleCam);
  const startScreen = useVoiceStore((s) => s.startScreen);
  const toggleScreen = useVoiceStore((s) => s.toggleScreen);
  const volume = useVoiceStore((s) => s.volume);
  const deafened = useVoiceStore((s) => s.deafened);
  const setVolume = useVoiceStore((s) => s.setVolume);
  const toggleDeafen = useVoiceStore((s) => s.toggleDeafen);
  const local = useLocalParticipant();
  const { t } = useT();

  // Discord benzeri gecikme göstergesi: LiveKit signal RTT'si (pongResp'ten,
  // sunucu ~10 sn'de bir günceller). <80 iyi, <200 orta, üzeri kötü.
  const room = useVoiceStore((s) => s.room);
  const [ping, setPing] = useState<number | null>(null);
  useEffect(() => {
    if (!room) return;
    const id = setInterval(() => {
      const rtt = room.engine?.client?.rtt ?? 0;
      setPing(rtt > 0 ? Math.round(rtt) : null);
    }, 2000);
    return () => clearInterval(id);
  }, [room]);

  const [isFullscreen, setIsFullscreen] = useState(Boolean(document.fullscreenElement));
  useEffect(() => {
    const onFsChange = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await document.documentElement.requestFullscreen();
      }
    } catch {
      // fullscreen denied or unsupported
    }
  };

  // ekran paylaşımı öncesi detaylı yayın diyaloğu (Discord Go Live akışı):
  // kaynak ipucu + çözünürlük + fps + ses, sonra tarayıcıdan kaynak seçimi
  const [screenPrompt, setScreenPrompt] = useState(false);
  const [showVolumeSlider, setShowVolumeSlider] = useState(false);
  const [deviceMenu, setDeviceMenu] = useState<'mic' | 'cam' | null>(null);
  const [resH, setResH] = useState(() => QUALITY_TO_RES[quality]);
  const [fps, setFps] = useState<ShareOpts['fps']>(30); // 15 fps akıcılık için düşük kalıyor — varsayılan 30
  const [shareAudio, setShareAudio] = useState(true);
  const [surface, setSurface] = useState<ShareOpts['surface']>('monitor');

  const round = (on: boolean, danger = false): string =>
    `flex h-11 w-11 items-center justify-center rounded-full border transition-colors ${
      danger
        ? 'border-stamp-500/70 bg-stamp-100 text-stamp-400 hover:bg-stamp-500 hover:text-white'
        : on
          ? 'border-brass-600/60 bg-night-700 text-paper-50 hover:border-brass-500'
          : 'border-stamp-500/70 bg-stamp-500 text-white hover:bg-stamp-400'
    }`;

  return (
    <div className="flex shrink-0 items-center justify-center gap-2.5 border-t border-night-700 bg-night-900/80 px-4 py-2">
      <div className="relative flex items-center">
        <button
          onClick={() => void toggleMic()}
          className={`${round(micOn)} !rounded-r-none`}
          title={micOn ? t('call.micOn') : t('call.micOff')}
          aria-label={micOn ? t('call.micOn') : t('call.micOff')}
          aria-pressed={micOn}
        >
          {micOn ? <Mic size={18} /> : <MicOff size={18} />}
        </button>
        <button
          type="button"
          onClick={() => setDeviceMenu((m) => (m === 'mic' ? null : 'mic'))}
          className={`${round(micOn)} !-ml-px !w-7 !rounded-l-none`}
          title={t('devices.mic')}
          aria-label={t('devices.mic')}
          aria-haspopup="menu"
          aria-expanded={deviceMenu === 'mic'}
        >
          <ChevronUp size={13} />
        </button>
        {deviceMenu === 'mic' && <DeviceMenu onClose={() => setDeviceMenu(null)} />}
      </div>
      <div className="relative flex items-center">
        <button
          onClick={() => void toggleCam()}
          className={`${round(camOn)} !rounded-r-none`}
          title={camOn ? t('call.camOn') : t('call.camOff')}
          aria-label={camOn ? t('call.camOn') : t('call.camOff')}
          aria-pressed={camOn}
        >
          {camOn ? <Video size={18} /> : <VideoOff size={18} />}
        </button>
        <button
          type="button"
          onClick={() => setDeviceMenu((m) => (m === 'cam' ? null : 'cam'))}
          className={`${round(camOn)} !-ml-px !w-7 !rounded-l-none`}
          title={t('devices.cam')}
          aria-label={t('devices.cam')}
          aria-haspopup="menu"
          aria-expanded={deviceMenu === 'cam'}
        >
          <ChevronUp size={13} />
        </button>
        {deviceMenu === 'cam' && <DeviceMenu onClose={() => setDeviceMenu(null)} />}
      </div>
      <button
        onClick={() => (screenOn ? void toggleScreen() : setScreenPrompt(true))}
        className={round(screenOn)}
        title={screenOn ? t('call.shareStop') : t('call.shareStart')}
        aria-label={t('call.shareStart')}
        aria-pressed={screenOn}
      >
        <MonitorUp size={18} />
      </button>
      <div
        className="relative flex items-center"
        onMouseEnter={() => setShowVolumeSlider(true)}
        onMouseLeave={() => setShowVolumeSlider(false)}
      >
        <button
          type="button"
          onClick={toggleDeafen}
          className={round(!deafened, deafened)}
          title={deafened ? t('stream.unmute') : t('stream.mute')}
          aria-label={deafened ? t('stream.unmute') : t('stream.mute')}
          aria-pressed={!deafened}
        >
          {deafened || volume === 0 ? <VolumeX size={18} /> : <Volume2 size={18} />}
        </button>
        {showVolumeSlider && (
          <div className="absolute bottom-full left-1/2 mb-2 -translate-x-1/2 rounded-md border border-night-700 bg-night-950/95 px-3 py-2 shadow-lg flex items-center gap-2 z-20">
            <input
              type="range"
              min={0}
              max={100}
              value={deafened ? 0 : Math.round(volume * 100)}
              onChange={(e) => setVolume(Number(e.target.value) / 100)}
              className="w-24 accent-lamp-500 cursor-pointer"
              aria-label={t('stream.volLabel')}
            />
            <span className="font-mono text-[10px] text-paper-300 w-7 text-right">
              {deafened ? '0%' : `${Math.round(volume * 100)}%`}
            </span>
          </div>
        )}
      </div>
      <button
        type="button"
        onClick={() => void toggleFullscreen()}
        className={round(true)}
        title={isFullscreen ? 'Tam ekrandan çık' : 'Tam ekran'}
        aria-label={isFullscreen ? 'Tam ekrandan çık' : 'Tam ekran'}
      >
        {isFullscreen ? <Minimize size={18} /> : <Maximize size={18} />}
      </button>
      {variant === 'call' && onMinimize && (
        <button onClick={onMinimize} className={round(true)} title={t('call.pipTitle')} aria-label={t('call.pipTitle')}>
          <PictureInPicture2 size={17} />
        </button>
      )}
      <span className="sealed-band mx-1 hidden sm:inline-flex">
        {local.isMicrophoneEnabled ? 'uçtan uca · sframe' : t('call.micOff')}
      </span>
      {ping !== null && (
        <span
          className={`hidden items-center gap-1 font-mono text-[11px] sm:flex ${
            ping < 80 ? 'text-emerald-400' : ping < 200 ? 'text-lamp-400' : 'text-stamp-400'
          }`}
          title="sunucu gecikmesi"
          aria-label={`gecikme ${ping} milisaniye`}
        >
          <Signal size={13} aria-hidden />
          {ping} ms
        </span>
      )}
      <button onClick={onEnd} className="btn-stamp ml-1 !rounded-full" title={endLabel}>
        <PhoneOff size={16} />
        {endLabel}
      </button>

      {screenPrompt && (
        <Modal title={t('call.screenPromptTitle')} onClose={() => setScreenPrompt(false)}>
          <div className="flex flex-col gap-3">
            <p className="text-xs text-paper-500">
              {t('call.screenPromptHint')}
            </p>
            <div className="flex flex-col gap-1">
              <span className="font-display text-[10px] font-semibold uppercase tracking-[0.18em] text-paper-500">{t('call.sourceHint')}</span>
              <div className="flex gap-1.5">
                {SURFACE_KEYS.map((key) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setSurface(key)}
                    className={`flex-1 rounded border px-2 py-1.5 text-xs transition-colors ${
                      surface === key
                        ? 'border-lamp-500/70 bg-lamp-100/60 text-lamp-300'
                        : 'border-night-700 bg-night-800 text-paper-300 hover:border-brass-600'
                    }`}
                    aria-pressed={surface === key}
                  >
                    {t(`call.${key === 'monitor' ? 'monitor' : key === 'window' ? 'window' : 'browser'}` as const)}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <span className="font-display text-[10px] font-semibold uppercase tracking-[0.18em] text-paper-500">{t('call.resolution')}</span>
              <div className="flex gap-1.5">
                {RES_ROWS.map((r) => (
                  <button
                    key={r.h}
                    type="button"
                    onClick={() => setResH(r.h)}
                    className={`flex-1 rounded border px-1.5 py-1.5 font-mono text-[11px] transition-colors ${
                      resH === r.h
                        ? 'border-lamp-500/70 bg-lamp-100/60 text-lamp-300'
                        : 'border-night-700 bg-night-800 text-paper-300 hover:border-brass-600'
                    }`}
                    aria-pressed={resH === r.h}
                  >
                    {r.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <span className="font-display text-[10px] font-semibold uppercase tracking-[0.18em] text-paper-500">{t('call.fps')}</span>
              <div className="flex gap-1.5">
                {FPS_ROWS.map((f) => (
                  <button
                    key={f}
                    type="button"
                    onClick={() => setFps(f)}
                    className={`flex-1 rounded border px-1.5 py-1.5 font-mono text-[11px] transition-colors ${
                      fps === f
                        ? 'border-lamp-500/70 bg-lamp-100/60 text-lamp-300'
                        : 'border-night-700 bg-night-800 text-paper-300 hover:border-brass-600'
                    }`}
                    aria-pressed={fps === f}
                  >
                    {f} fps
                  </button>
                ))}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setShareAudio((v) => !v)}
              className={`flex items-center justify-between rounded border px-2.5 py-2 text-sm transition-colors ${
                shareAudio
                  ? 'border-lamp-500/70 bg-lamp-100/60 text-lamp-300'
                  : 'border-night-700 bg-night-800 text-paper-300 hover:border-brass-600'
              }`}
              aria-pressed={shareAudio}
            >
              <span className="font-semibold">{t('call.audio')}</span>
              <span className="font-mono text-[10px] text-paper-500">
                {shareAudio ? t('call.audioOn') : t('call.audioOff')}
              </span>
            </button>
            {shareAudio && surface === 'window' && (
              <p className="text-[11px] leading-snug text-stamp-400">{t('call.audioWindowHint')}</p>
            )}
            {shareAudio && IS_LINUX && surface === 'monitor' && (
              <p className="text-[11px] leading-snug text-stamp-400">{t('call.audioLinuxHint')}</p>
            )}
            <div className="flex gap-2">
              <button onClick={() => setScreenPrompt(false)} className="btn-ghost flex-1">
                {t('call.cancel')}
              </button>
              <button
                onClick={() => {
                  setScreenPrompt(false);
                  void startScreen({ w: RES_ROWS.find((r) => r.h === resH)!.w, h: resH, fps, audio: shareAudio, surface });
                }}
                className="btn-lamp flex-1"
              >
                {t('call.goLive')}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
