import { useState } from 'react';
import { Mic, MicOff, MonitorUp, PhoneOff, PictureInPicture2, Video, VideoOff } from 'lucide-react';
import { useLocalParticipant } from '@livekit/components-react';
import { useVoiceStore, type CallQuality, type ShareOpts } from '../state/voiceStore';
import Modal from './Modal';
import { useT } from '../i18n/I18nProvider';

// diyalogdaki çözünürlük satırları; kalite ayarına göre ön seçilir
// (etiketler sabit: 360p/480p… — sayısal, dile bağlı değil)
const RES_ROWS: { h: number; w: number; label: string }[] = [
  { h: 360, w: 640, label: '360p' },
  { h: 480, w: 854, label: '480p' },
  { h: 720, w: 1280, label: '720p' },
  { h: 1080, w: 1920, label: '1080p' },
  { h: 1440, w: 2560, label: '1440p' },
];
const FPS_ROWS: Array<ShareOpts['fps']> = [15, 30, 60];
// kaynak ipucu — tarayıcının seçim ekranında o kategoriye ön seçilir
// (etiketler useT ile çevrilir, aşağıda)
const SURFACE_KEYS: ShareOpts['surface'][] = ['monitor', 'window', 'browser'];
const QUALITY_TO_RES: Record<CallQuality, number> = { hizli: 360, dengeli: 720, yuksek: 1080 };

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
  const local = useLocalParticipant();
  const { t } = useT();
  // ekran paylaşımı öncesi detaylı yayın diyaloğu (Discord Go Live akışı):
  // kaynak ipucu + çözünürlük + fps + ses, sonra tarayıcıdan kaynak seçimi
  const [screenPrompt, setScreenPrompt] = useState(false);
  const [resH, setResH] = useState(() => QUALITY_TO_RES[quality]);
  const [fps, setFps] = useState<ShareOpts['fps']>(15);
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
    <div className="flex items-center justify-center gap-2.5 border-t border-night-700 bg-night-900/80 px-4 py-3">
      <button onClick={() => void toggleMic()} className={round(micOn)} title={micOn ? t('call.micOn') : t('call.micOff')} aria-label={micOn ? t('call.micOn') : t('call.micOff')} aria-pressed={micOn}>
        {micOn ? <Mic size={18} /> : <MicOff size={18} />}
      </button>
      <button onClick={() => void toggleCam()} className={round(camOn)} title={camOn ? t('call.camOn') : t('call.camOff')} aria-label={camOn ? t('call.camOn') : t('call.camOff')} aria-pressed={camOn}>
        {camOn ? <Video size={18} /> : <VideoOff size={18} />}
      </button>
      <button
        onClick={() => (screenOn ? void toggleScreen() : setScreenPrompt(true))}
        className={round(screenOn)}
        title={screenOn ? t('call.shareStop') : t('call.shareStart')}
        aria-label={t('call.shareStart')}
        aria-pressed={screenOn}
      >
        <MonitorUp size={18} />
      </button>
      {variant === 'call' && onMinimize && (
        <button onClick={onMinimize} className={round(true)} title={t('call.pipTitle')} aria-label={t('call.pipTitle')}>
          <PictureInPicture2 size={17} />
        </button>
      )}
      <span className="sealed-band mx-1 hidden sm:inline-flex">
        {local.isMicrophoneEnabled ? 'uçtan uca · sframe' : t('call.micOff')}
      </span>
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
