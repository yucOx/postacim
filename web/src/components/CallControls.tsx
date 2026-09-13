import { useState } from 'react';
import { Mic, MicOff, MonitorUp, PhoneOff, PictureInPicture2, Video, VideoOff } from 'lucide-react';
import { useLocalParticipant } from '@livekit/components-react';
import { useVoiceStore, type CallQuality, type ShareOpts } from '../state/voiceStore';
import Modal from './Modal';

// diyalogdaki çözünürlük satırları; kalite ayarına göre ön seçilir
const RES_ROWS: { h: number; w: number; label: string }[] = [
  { h: 360, w: 640, label: '360p' },
  { h: 480, w: 854, label: '480p' },
  { h: 720, w: 1280, label: '720p' },
  { h: 1080, w: 1920, label: '1080p' },
  { h: 1440, w: 2560, label: '1440p' },
];
const FPS_ROWS: Array<ShareOpts['fps']> = [15, 30, 60];
// kaynak ipucu — tarayıcının seçim ekranında o kategoriye ön seçilir
const SURFACE_ROWS: { key: ShareOpts['surface']; label: string }[] = [
  { key: 'monitor', label: 'tüm ekran' },
  { key: 'window', label: 'pencere' },
  { key: 'browser', label: 'sekme' },
];
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
      <button onClick={() => void toggleMic()} className={round(micOn)} title={micOn ? 'mikrofonu kapat' : 'mikrofonu aç'} aria-label={micOn ? 'mikrofonu kapat' : 'mikrofonu aç'} aria-pressed={micOn}>
        {micOn ? <Mic size={18} /> : <MicOff size={18} />}
      </button>
      <button onClick={() => void toggleCam()} className={round(camOn)} title={camOn ? 'kamerayı kapat' : 'kamerayı aç'} aria-label={camOn ? 'kamerayı kapat' : 'kamerayı aç'} aria-pressed={camOn}>
        {camOn ? <Video size={18} /> : <VideoOff size={18} />}
      </button>
      <button
        onClick={() => (screenOn ? void toggleScreen() : setScreenPrompt(true))}
        className={round(screenOn)}
        title={screenOn ? 'ekran paylaşımını durdur' : 'ekran paylaş'}
        aria-label="ekran paylaş"
        aria-pressed={screenOn}
      >
        <MonitorUp size={18} />
      </button>
      {variant === 'call' && onMinimize && (
        <button onClick={onMinimize} className={round(true)} title="küçült — sohbete dön" aria-label="aramayı küçült">
          <PictureInPicture2 size={17} />
        </button>
      )}
      <span className="sealed-band mx-1 hidden sm:inline-flex">
        {local.isMicrophoneEnabled ? 'uçtan uca · sframe' : 'mikrofon kapalı'}
      </span>
      <button onClick={onEnd} className="btn-stamp ml-1 !rounded-full" title={endLabel}>
        <PhoneOff size={16} />
        {endLabel}
      </button>

      {screenPrompt && (
        <Modal title="Ekran paylaşımı" onClose={() => setScreenPrompt(false)}>
          <div className="flex flex-col gap-3">
            <p className="text-xs text-paper-500">
              ne paylaşacağın sonraki adımda tarayıcının seçim ekranında sorulur
            </p>
            <div className="flex flex-col gap-1">
              <span className="font-display text-[10px] font-semibold uppercase tracking-[0.18em] text-paper-500">kaynak</span>
              <div className="flex gap-1.5">
                {SURFACE_ROWS.map((s) => (
                  <button
                    key={s.key}
                    type="button"
                    onClick={() => setSurface(s.key)}
                    className={`flex-1 rounded border px-2 py-1.5 text-xs transition-colors ${
                      surface === s.key
                        ? 'border-lamp-500/70 bg-lamp-100/60 text-lamp-300'
                        : 'border-night-700 bg-night-800 text-paper-300 hover:border-brass-600'
                    }`}
                    aria-pressed={surface === s.key}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <span className="font-display text-[10px] font-semibold uppercase tracking-[0.18em] text-paper-500">çözünürlük</span>
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
              <span className="font-display text-[10px] font-semibold uppercase tracking-[0.18em] text-paper-500">kare hızı</span>
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
              <span className="font-semibold">ses</span>
              <span className="font-mono text-[10px] text-paper-500">
                {shareAudio ? 'sekme/sistem sesi yayında' : 'sessiz yayın'}
              </span>
            </button>
            <div className="flex gap-2">
              <button onClick={() => setScreenPrompt(false)} className="btn-ghost flex-1">
                vazgeç
              </button>
              <button
                onClick={() => {
                  setScreenPrompt(false);
                  void startScreen({ w: RES_ROWS.find((r) => r.h === resH)!.w, h: resH, fps, audio: shareAudio, surface });
                }}
                className="btn-lamp flex-1"
              >
                yayını başlat
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
