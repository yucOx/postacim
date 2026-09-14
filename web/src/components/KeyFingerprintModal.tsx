import { useEffect, useState, type ReactNode } from 'react';
import { useAuthStore } from '../state/authStore';
import { unb64 } from '../crypto/bytes';
import { fingerprintPair, shortFingerprint } from '../crypto/fingerprint';
import { ensurePinned, pinKey, type PinStatus } from '../lib/keypins';
import Modal from './Modal';
import { useT } from '../i18n/I18nProvider';

/** fingerprint value block + copy button */
function CopyBlock({
  copyText,
  className = '',
  children,
}: {
  copyText: string;
  className?: string;
  children: ReactNode;
}): ReactNode {
  const { t } = useT();
  const [copied, setCopied] = useState(false);
  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(copyText);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard blocked (non-secure context) — the value stays selectable
    }
  };
  return (
    <div className="flex flex-col gap-1">
      <div
        className={`rounded border border-brass-700/40 bg-night-950/70 px-3 py-2 font-mono font-semibold text-lamp-300 ${className}`}
      >
        {children}
      </div>
      <button onClick={() => void copy()} className="btn-ghost self-end !py-0.5 !text-xs">
        {copied ? t('fingerprint.copied') : t('fingerprint.copy')}
      </button>
    </div>
  );
}

export default function KeyFingerprintModal({
  peerId,
  peerNick,
  peerPublicKeyB64,
  onTrust,
  onClose,
}: {
  peerId: string;
  peerNick: string;
  /** key already known client-side (friend / gdm / bootstrap); absent → pubkey endpoint */
  peerPublicKeyB64?: string;
  /** fired after "yine de güven" re-pins, so lists can drop their red flag */
  onTrust?: () => void;
  onClose: () => void;
}): ReactNode {
  const { t } = useT();
  const myPublicKey = useAuthStore((s) => s.publicKey);
  const [status, setStatus] = useState<PinStatus | 'loading' | 'error'>('loading');
  const [peerKeyB64, setPeerKeyB64] = useState<string | null>(null);
  const [short, setShort] = useState<string | null>(null);
  const [full, setFull] = useState<string | null>(null);

  useEffect(() => {
    if (!myPublicKey) {
      setStatus('error');
      return;
    }
    let alive = true;
    void (async () => {
      try {
        let key = peerPublicKeyB64;
        if (!key) {
          const res = await fetch(`/api/users/${peerId}/pubkey`, { credentials: 'same-origin' });
          if (!res.ok) throw new Error('pubkey alınamadı');
          ({ public_key: key } = (await res.json()) as { public_key: string });
        }
        // TOFU: first sighting is stored silently; a change keeps the old pin
        const pinStatus = ensurePinned(peerId, key);
        const peerBytes = unb64(key);
        const [s, f] = await Promise.all([
          Promise.resolve(shortFingerprint(peerBytes)),
          fingerprintPair(myPublicKey, peerBytes),
        ]);
        if (!alive) return;
        setPeerKeyB64(key);
        setShort(s);
        setFull(f);
        setStatus(pinStatus);
      } catch {
        if (alive) setStatus('error');
      }
    })();
    return () => {
      alive = false;
    };
  }, [peerId, peerPublicKeyB64, myPublicKey]);

  const trust = (): void => {
    if (!peerKeyB64) return;
    pinKey(peerId, peerKeyB64); // overwrite only here, after explicit consent
    setStatus('same');
    onTrust?.();
  };

  return (
    <Modal title={t('fingerprint.title')} onClose={onClose}>
      <div className="flex w-80 flex-col gap-3">
        <p className="text-[11px] text-paper-500">{t('fingerprint.withPeer', { name: peerNick })}</p>

        {status === 'loading' && <p className="text-sm text-paper-500">{t('fingerprint.loading')}</p>}
        {status === 'error' && <p className="text-sm text-stamp-400">{t('fingerprint.keyError')}</p>}

        {short && (
          <CopyBlock copyText={short.replace(/ /g, '')} className="text-center text-lg tracking-[0.12em]">
            {short}
          </CopyBlock>
        )}
        {full && (
          <CopyBlock
            copyText={full.replace(/ /g, '')}
            className="flex flex-wrap justify-center gap-x-2 gap-y-0.5 text-sm tracking-[0.08em]"
          >
            {full.split(' ').map((g, i) => (
              <span key={i}>{g}</span>
            ))}
          </CopyBlock>
        )}

        {status === 'changed' && (
          <div className="rounded border border-stamp-500/70 bg-night-950/70 p-3">
            <p className="text-sm font-semibold text-stamp-400">
              {t('fingerprint.changed')}
            </p>
            <p className="mt-1 text-[11px] text-paper-500">
              {t('fingerprint.changedHint')}
            </p>
            <div className="mt-2 flex gap-2">
              <button
                onClick={trust}
                className="btn-ghost hover:!border-stamp-500/70 hover:!text-stamp-400"
              >
                {t('fingerprint.trustAnyway')}
              </button>
              <button onClick={onClose} className="btn-lamp">
                {t('fingerprint.close')}
              </button>
            </div>
          </div>
        )}

        {status === 'same' && full && (
          <p className="text-[11px] text-paper-500">
            {t('fingerprint.same')}
          </p>
        )}
        <span className="sealed-band self-start">{t('fingerprint.sealed')}</span>
      </div>
    </Modal>
  );
}
