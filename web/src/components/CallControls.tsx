import { useState } from 'react';
import { Mic, MicOff, MonitorUp, PhoneOff, PictureInPicture2, Video, VideoOff } from 'lucide-react';
import { useLocalParticipant } from '@livekit/components-react';
import { useVoiceStore, type CallQuality } from '../state/voiceStore';
import Modal from './Modal';

const QUALITY_ROWS: { key: CallQuality; label: string; hint: string }[] = [
  { key: 'hizli', label: 'hızlı', hint: '360p — yavaş hat' },
  { key: 'dengeli', label: 'dengeli', hint: '720p' },
  { key: 'yuksek', label: 'yüksek', hint: '1080p' },
];

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
  const setQuality = useVoiceStore((s) => s.setQuality);
  const toggleMic = useVoiceStore((s) => s.toggleMic);
  const toggleCam = useVoiceStore((s) => s.toggleCam);
  const toggleScreen = useVoiceStore((s) => s.toggleScreen);
  const local = useLocalParticipant();
  // ekran paylaşımı öncesi sor: kalite seçimi + onay (Discord yayın akışı)
  const [screenPrompt, setScreenPrompt] = useState(false);

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
              paylaşım kalitesi — ne paylaşacağın sonraki adımda tarayıcıdan seçilir
            </p>
            <div className="flex flex-col gap-1.5">
              {QUALITY_ROWS.map((q) => (
                <button
                  key={q.key}
                  type="button"
                  onClick={() => setQuality(q.key)}
                  className={`flex items-center justify-between rounded border px-2.5 py-2 text-sm transition-colors ${
                    quality === q.key
                      ? 'border-lamp-500/70 bg-lamp-100/60 text-lamp-300'
                      : 'border-night-700 bg-night-800 text-paper-300 hover:border-brass-600'
                  }`}
                  aria-pressed={quality === q.key}
                >
                  <span className="font-semibold">{q.label}</span>
                  <span className="font-mono text-[10px] text-paper-500">{q.hint}</span>
                </button>
              ))}
            </div>
            <div className="flex gap-2">
              <button onClick={() => setScreenPrompt(false)} className="btn-ghost flex-1">
                vazgeç
              </button>
              <button
                onClick={() => {
                  setScreenPrompt(false);
                  void toggleScreen();
                }}
                className="btn-lamp flex-1"
              >
                paylaşımı başlat
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
