import { useEffect, useState } from 'react';
import { useAuthStore } from '../state/authStore';
import { b64 } from '../crypto/bytes';
import { safetyNumber } from '../lib/safety';
import { useT } from '../i18n/I18nProvider';
import Modal from './Modal';

export default function SafetyModal({
  peerId,
  peerNick,
  onClose,
}: {
  peerId: string;
  peerNick: string;
  onClose: () => void;
}): React.ReactNode {
  const { t } = useT();
  const publicKey = useAuthStore((s) => s.publicKey);
  const [digits, setDigits] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!publicKey) {
      setError(t('safety.noKey'));
      return;
    }
    let alive = true;
    void (async () => {
      try {
        const res = await fetch(`/api/users/${peerId}/pubkey`, { credentials: 'same-origin' });
        if (!res.ok) throw new Error(t('safety.pubkeyFail'));
        const { public_key } = (await res.json()) as { public_key: string };
        const n = await safetyNumber(b64(publicKey), public_key);
        if (alive) setDigits(n);
      } catch {
        if (alive) setError(t('safety.computeFail'));
      }
    })();
    return () => {
      alive = false;
    };
  }, [peerId, publicKey, t]);

  return (
    <Modal title={t('safety.title')} onClose={onClose}>
      <div className="flex w-80 flex-col gap-3">
        <p className="text-[11px] text-paper-500">{t('safety.intro', { nick: peerNick })}</p>
        {digits ? (
          <div className="rounded border border-brass-700/40 bg-night-950/70 px-3 py-3 text-center font-mono text-xl font-semibold tracking-[0.12em] text-lamp-300">
            {digits}
          </div>
        ) : error ? (
          <p className="text-sm text-stamp-400">{error}</p>
        ) : (
          <p className="text-sm text-paper-500">{t('safety.loading')}</p>
        )}
        <p className="text-[11px] text-paper-500">
          {t('safety.hint')}
        </p>
        <span className="sealed-band self-start">{t('safety.sealedBand')}</span>
      </div>
    </Modal>
  );
}
