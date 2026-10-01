import { useEffect, useRef } from 'react';
import { Mic, MicOff, Video, VideoOff, Volume2, VolumeX } from 'lucide-react';
import { useT } from '../i18n/I18nProvider';
import { useVoiceStore } from '../state/voiceStore';

/** Discord tarzı sağ tık menüsü — katılımcı kutusunda açılır.
 *  Yayın sesi aç/kapat + seviye (ekran paylaşımı olanlarda), kişi başına
 *  mikrofon susturma + seviye. Hepsi YEREL — karşı tarafın yayınını
 *  veya mikrofonunu değiştirmez, sadece bizim ne duyduğumuzu. */
export default function ParticipantMenu({
  x,
  y,
  identity,
  nick,
  hasShare,
  isSelf,
  onClose,
}: {
  x: number;
  y: number;
  identity: string;
  nick: string;
  hasShare: boolean;
  isSelf: boolean;
  onClose: () => void;
}): React.ReactNode {
  const { t } = useT();
  const volume = useVoiceStore((s) => s.volume);
  const userVolumes = useVoiceStore((s) => s.userVolumes);
  const userMuted = useVoiceStore((s) => s.userMuted);
  const setUserVolume = useVoiceStore((s) => s.setUserVolume);
  const toggleUserMuted = useVoiceStore((s) => s.toggleUserMuted);
  const shareMuted = useVoiceStore((s) => s.shareMuted);
  const shareVolume = useVoiceStore((s) => s.shareVolume);
  const toggleShareMuted = useVoiceStore((s) => s.toggleShareMuted);
  const setShareVolume = useVoiceStore((s) => s.setShareVolume);
  const micOn = useVoiceStore((s) => s.micOn);
  const camOn = useVoiceStore((s) => s.camOn);
  const toggleMic = useVoiceStore((s) => s.toggleMic);
  const toggleCam = useVoiceStore((s) => s.toggleCam);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDoc = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const level = userVolumes[identity] ?? volume;
  const muted = !!userMuted[identity];

  return (
    <div
      ref={ref}
      role="menu"
      aria-label={nick}
      className="animate-seal-in fixed z-50 w-60 rounded-md border border-night-700 bg-night-900 p-1 shadow-[0_10px_30px_-10px_rgba(0,0,0,0.8)]"
      style={{
        left: Math.max(8, Math.min(x, (window.innerWidth ?? 0) - 248)),
        top: Math.max(8, Math.min(y, (window.innerHeight ?? 0) - (hasShare ? 300 : isSelf ? 220 : 140))),
      }}
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="truncate px-2 py-1.5 text-xs text-paper-500">{nick}</div>

      {hasShare && (
        <>
          <div className="my-1 h-px bg-night-700" aria-hidden />
          <button
            type="button"
            onClick={toggleShareMuted}
            className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm text-paper-100 transition-colors hover:bg-night-800"
          >
            {shareMuted || shareVolume === 0 ? (
              <VolumeX size={13} className="text-stamp-400" />
            ) : (
              <Volume2 size={13} className="text-lamp-500" />
            )}
            <span className="flex-1">{shareMuted ? t('ctx.shareUnmute') : t('ctx.shareMute')}</span>
          </button>
          <div className="flex items-center gap-2 px-2 py-1">
            <Volume2 size={12} className="shrink-0 text-paper-500" aria-hidden />
            <input
              type="range"
              min={0}
              max={100}
              value={shareMuted ? 0 : Math.round(shareVolume * 100)}
              onChange={(e) => setShareVolume(Number(e.target.value) / 100)}
              className="flex-1 accent-lamp-500"
              aria-label={t('ctx.shareVolume')}
            />
          </div>
          <div className="my-1 h-px bg-night-700" aria-hidden />
        </>
      )}

      <button
        type="button"
        onClick={() => toggleUserMuted(identity)}
        className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm text-paper-100 transition-colors hover:bg-night-800"
      >
        {muted ? <MicOff size={13} className="text-stamp-400" /> : <Mic size={13} className="text-lamp-500" />}
        <span className="flex-1">{muted ? t('ctx.userUnmute') : t('ctx.userMute')}</span>
      </button>
      <div className="flex items-center gap-2 px-2 py-1">
        <Volume2 size={12} className="shrink-0 text-paper-500" aria-hidden />
        <input
          type="range"
          min={0}
          max={100}
          value={muted ? 0 : Math.round(level * 100)}
          onChange={(e) => setUserVolume(identity, Number(e.target.value) / 100)}
          className="flex-1 accent-lamp-500"
          aria-label={t('ctx.userVolume')}
        />
      </div>
      {isSelf && (
        <>
          <div className="my-1 h-px bg-night-700" aria-hidden />
          <button
            type="button"
            onClick={() => void toggleMic()}
            className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm text-paper-100 transition-colors hover:bg-night-800"
          >
            {micOn ? <Mic size={13} className="text-lamp-500" /> : <MicOff size={13} className="text-stamp-400" />}
            <span className="flex-1">{micOn ? t('call.micOn') : t('call.micOff')}</span>
          </button>
          <button
            type="button"
            onClick={() => void toggleCam()}
            className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm text-paper-100 transition-colors hover:bg-night-800"
          >
            {camOn ? <Video size={13} className="text-lamp-500" /> : <VideoOff size={13} className="text-stamp-400" />}
            <span className="flex-1">{camOn ? t('call.camOn') : t('call.camOff')}</span>
          </button>
        </>
      )}
    </div>
  );
}
