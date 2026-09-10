import { Mic, MicOff, MonitorUp, PhoneOff, PictureInPicture2, Video, VideoOff } from 'lucide-react';
import { useLocalParticipant } from '@livekit/components-react';
import { useVoiceStore } from '../state/voiceStore';

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
  const toggleMic = useVoiceStore((s) => s.toggleMic);
  const toggleCam = useVoiceStore((s) => s.toggleCam);
  const toggleScreen = useVoiceStore((s) => s.toggleScreen);
  const local = useLocalParticipant();

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
        onClick={() => void toggleScreen()}
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
    </div>
  );
}
