import { useState } from 'react';
import { Fingerprint } from 'lucide-react';
import { useAuthStore } from '../state/authStore';
import { declineDeviceOffer } from '../crypto/devicekey';
import Modal from './Modal';

// "bu cihazda hatırla" teklifi — bir kez sorulur (Shell kontrol eder).
// Kurulursa F5 sonrası şifre yerine passkey dokunuşuyla geri dönülür.
// Desteklenmeyen cihazda bu modal hiç mount edilmez.
export default function DeviceLockModal({ onClose }: { onClose: () => void }) {
  const enrollDeviceUnlock = useAuthStore((s) => s.enrollDeviceUnlock);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const enroll = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await enrollDeviceUnlock();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'kurulamadı');
    } finally {
      setBusy(false);
    }
  };

  const decline = (): void => {
    declineDeviceOffer();
    onClose();
  };

  return (
    <Modal title="Cihaz kilidi" onClose={decline}>
      <div className="flex w-72 flex-col gap-3">
        <div className="flex items-center gap-2.5 rounded-md border border-lamp-600/50 bg-lamp-100/60 p-3 text-sm text-lamp-300">
          <Fingerprint size={18} className="shrink-0" />
          <p>
            bu cihazda bir passkey üretirsek, sayfa yenilendiğinde şifre yerine
            <b className="text-paper-100"> parmak izin / PIN'in ile</b> anında geri dönersin.
          </p>
        </div>
        <p className="text-[11px] text-paper-500">
          anahtarın passkey donanımından türetilir — sayfadaki hiçbir kod (biz de
          dahil) onu okuyamaz. passkey silinirse şifrenle ya da kurtarma ifadenle
          her zaman girebilirsin; bu yalnızca hızlı geri dönüş.
        </p>
        {error && (
          <p className="rounded-md border border-stamp-500/60 bg-stamp-100 px-3 py-2 text-sm text-stamp-400">{error}</p>
        )}
        <button onClick={() => void enroll()} disabled={busy} className="btn-lamp">
          {busy ? 'kuruluyor…' : 'bu cihazda hatırla'}
        </button>
        <button
          onClick={decline}
          disabled={busy}
          className="w-full text-center text-xs text-paper-500 transition-colors hover:text-paper-300"
        >
          şimdi değil
        </button>
      </div>
    </Modal>
  );
}