import { useEffect, useState, type ReactNode } from 'react';
import { useAuthStore } from '../state/authStore';
import { unb64 } from '../crypto/bytes';
import { fingerprintPair, shortFingerprint } from '../crypto/fingerprint';
import { ensurePinned, pinKey, type PinStatus } from '../lib/keypins';
import Modal from './Modal';

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
        {copied ? 'kopyalandı' : 'kopyala'}
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
    <Modal title="Parmak izi" onClose={onClose}>
      <div className="flex w-80 flex-col gap-3">
        <p className="text-[11px] text-paper-500">{peerNick} ile kimlik parmak izi</p>

        {status === 'loading' && <p className="text-sm text-paper-500">hesaplanıyor…</p>}
        {status === 'error' && <p className="text-sm text-stamp-400">anahtar alınamadı</p>}

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
              Bu kişinin anahtarı değişti. Bu, hesap ele geçirme olabilir.
            </p>
            <p className="mt-1 text-[11px] text-paper-500">
              yeni anahtarı başka bir kanaldan (yüz yüze, sesli) doğrulamadan iletişime güvenme.
            </p>
            <div className="mt-2 flex gap-2">
              <button
                onClick={trust}
                className="btn-ghost hover:!border-stamp-500/70 hover:!text-stamp-400"
              >
                yine de güven
              </button>
              <button onClick={onClose} className="btn-lamp">
                kapat
              </button>
            </div>
          </div>
        )}

        {status === 'same' && full && (
          <p className="text-[11px] text-paper-500">
            bu 40 hane iki tarafın kimlik anahtarlarından üretilir — karşı tarafınkiyle aynı mı diye
            başka bir kanaldan karşılaştır; anahtar depoda ilk görüldüğü gibi sabit.
          </p>
        )}
        <span className="sealed-band self-start">uçtan uca · x25519</span>
      </div>
    </Modal>
  );
}
