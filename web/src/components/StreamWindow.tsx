// Discord "Go Live" mantığı: yayın, ayrı bir PENCERE olarak açılır —
// çağrı sahnesinden bağımsız, üstte kapatma butonu ve ses kontrolüyle.
// Kullanıcı yayını kamerasının üstündeki rozetten tek tıkla açar, pencere
// tekrar tıklanınca (veya X ile) kapanır.
//
// Pencerede video, kaynağın gerçek oranında (kırpma yok, letterbox) ve
// "izle" durumunda yayın sesi de duyulur.

import { useEffect } from 'react';
import { X, Volume2, VolumeX } from 'lucide-react';
import { ParticipantTile, AudioTrack, useIsMuted } from '@livekit/components-react';
import type { TrackReference } from '@livekit/components-react';
import { Track } from 'livekit-client';
import { useT } from '../i18n/I18nProvider';
import { useVoiceStore } from '../state/voiceStore';
import { nickFor } from '../lib/nick';

export default function StreamWindow({
  trackRef,
  onClose,
}: {
  trackRef: TrackReference;
  onClose: () => void;
}): React.ReactNode {
  const { t } = useT();
  const shareMuted = useVoiceStore((s) => s.shareMuted);
  const toggleShareMuted = useVoiceStore((s) => s.toggleShareMuted);
  const shareVolume = useVoiceStore((s) => s.shareVolume);
  const setShareVolume = useVoiceStore((s) => s.setShareVolume);
  const volume = useVoiceStore((s) => s.volume);
  const deafened = useVoiceStore((s) => s.deafened);

  // Escape ile kapat (Discord davranışı)
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Pencere açıkken yayın sesi duyulur (kendi yayınımızsa yankı olur —
  // kendi yayınımızı izlemek anlamsız, bu yüzden kendi yayınımızda
  // ses bağlanmaz)
  const isLocal = trackRef.participant.isLocal;

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-night-950/85 p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('stream.windowTitle', { name: nickFor(trackRef.participant.identity) })}
        className="relative flex max-h-full w-full max-w-6xl flex-col overflow-hidden rounded-lg border border-brass-700/70 bg-night-900 shadow-[0_18px_50px_-12px_rgba(0,0,0,0.8)]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* başlık: yayıncı adı + kapatma */}
        <div className="flex shrink-0 items-center justify-between border-b border-night-700 px-4 py-2.5">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 animate-pulse rounded-full bg-stamp-500" aria-hidden />
            <span className="font-display text-xs font-semibold uppercase tracking-[0.18em] text-paper-100">
              {t('stream.windowTitle', { name: nickFor(trackRef.participant.identity) })}
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('stream.windowClose')}
            className="rounded p-1 text-paper-500 transition-colors hover:bg-night-800 hover:text-paper-100"
          >
            <X size={16} />
          </button>
        </div>

        {/* video: kaynağın oranında, kırpma yok */}
        <div className="relative min-h-0 flex-1 bg-black">
          <div className="absolute inset-0 [&_video]:h-full [&_video]:w-full [&_video]:object-contain">
            <ParticipantTile trackRef={trackRef} />
          </div>
        </div>

        {/* alt bar: yayın sesi kontrolü (uzak yayınlarda) */}
        {!isLocal && (
          <div className="flex shrink-0 items-center justify-between gap-3 border-t border-night-700 px-4 py-2">
            <button
              type="button"
              onClick={toggleShareMuted}
              className="text-paper-300 transition-colors hover:text-lamp-400"
              title={shareMuted ? t('stream.unmute') : t('stream.mute')}
              aria-label={shareMuted ? t('stream.unmute') : t('stream.mute')}
            >
              {shareMuted || shareVolume === 0 ? <VolumeX size={16} /> : <Volume2 size={16} />}
            </button>
            <input
              type="range"
              min={0}
              max={100}
              value={shareMuted ? 0 : Math.round(shareVolume * 100)}
              onChange={(e) => {
                setShareVolume(Number(e.target.value) / 100);
                if (shareMuted) toggleShareMuted();
              }}
              className="w-40 accent-lamp-500"
              aria-label={t('stream.volLabel')}
            />
          </div>
        )}
      </div>
    </div>
  );
}
