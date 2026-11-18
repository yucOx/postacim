import { Phone, X } from 'lucide-react';
import { useVoiceStore } from '../state/voiceStore';
import { useT } from '../i18n/I18nProvider';
import { toast } from './Toast';
import { PigeonMark } from './Brand';

// zil sesi voiceStore.wire'daki startRing() ile çalınır (ayarlarla kapatılabilir).
// Buradaki ikinci WebAudio döngüsü kaldırıldı: her gelen aramada iki farklı
// ritim üst üste biniyordu ve çağrı sesleri kapalıyken bile çalıyordu.

export default function IncomingCall(): React.ReactNode {
  const { t } = useT();
  const callState = useVoiceStore((s) => s.callState);
  const acceptIncoming = useVoiceStore((s) => s.acceptIncoming);
  const declineIncoming = useVoiceStore((s) => s.declineIncoming);

  if (!callState || callState.phase !== 'incoming') return null;

  return (
    <div data-incoming-call className="fixed inset-0 z-[60] flex items-start justify-center bg-night-950/50 px-4 pt-20">
      <div className="animate-seal-in w-80 rounded-lg border border-brass-600/80 bg-night-900 p-6 text-center shadow-[0_24px_70px_-12px_rgba(0,0,0,0.9)]">
        <div className="relative mx-auto flex h-16 w-16 items-center justify-center">
          <span className="absolute inset-0 animate-ping rounded-full border border-lamp-600/50" aria-hidden />
          <span className="text-lamp-500">
            <PigeonMark size={30} />
          </span>
        </div>
        <p className="plate mt-4">{t('incoming.incomingTitle')}</p>
        <p className="mt-1 font-display text-xl font-semibold uppercase tracking-[0.08em] text-paper-50">
          {callState.fromNick}
        </p>
        <p className="mt-0.5 text-xs text-paper-500">{t('incoming.subtitle')}</p>
        <div className="mt-5 flex justify-center gap-4">
          <button
            onClick={() => void declineIncoming().catch(() => {})}
            className="flex h-12 w-12 items-center justify-center rounded-full border border-stamp-500/70 bg-stamp-100 text-stamp-400 transition-colors hover:bg-stamp-500 hover:text-white"
            title={t('incoming.decline')}
            aria-label={t('incoming.declineAria')}
          >
            <X size={19} />
          </button>
          <button
            onClick={() =>
              // hata yutulmasın: kabul başarısızsa zil durur, ekranda ipucu yok
              // — kullanıcıya toast ile haber ver
              void acceptIncoming().catch(() => toast.error(t('incoming.acceptFailed')))
            }
            className="flex h-12 w-12 items-center justify-center rounded-full bg-lamp-500 text-night-950 transition-colors hover:bg-lamp-400"
            title={t('incoming.accept')}
            aria-label={t('incoming.acceptAria')}
          >
            <Phone size={19} />
          </button>
        </div>
      </div>
    </div>
  );
}
