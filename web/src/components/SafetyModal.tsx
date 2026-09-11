import { useEffect, useState } from 'react';
import { useAuthStore } from '../state/authStore';
import { b64 } from '../crypto/bytes';
import { safetyNumber } from '../lib/safety';
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
  const publicKey = useAuthStore((s) => s.publicKey);
  const [digits, setDigits] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!publicKey) {
      setError('anahtarın yüklenmedi');
      return;
    }
    let alive = true;
    void (async () => {
      try {
        const res = await fetch(`/api/users/${peerId}/pubkey`, { credentials: 'same-origin' });
        if (!res.ok) throw new Error('pubkey alınamadı');
        const { public_key } = (await res.json()) as { public_key: string };
        const n = await safetyNumber(b64(publicKey), public_key);
        if (alive) setDigits(n);
      } catch {
        if (alive) setError('güvenlik numarası alınamadı');
      }
    })();
    return () => {
      alive = false;
    };
  }, [peerId, publicKey]);

  return (
    <Modal title="Güvenlik numarası" onClose={onClose}>
      <div className="flex w-80 flex-col gap-3">
        <p className="text-[11px] text-paper-500">{peerNick} ile güvenlik numaran</p>
        {digits ? (
          <div className="rounded border border-brass-700/40 bg-night-950/70 px-3 py-3 text-center font-mono text-xl font-semibold tracking-[0.12em] text-lamp-300">
            {digits}
          </div>
        ) : error ? (
          <p className="text-sm text-stamp-400">{error}</p>
        ) : (
          <p className="text-sm text-paper-500">hesaplanıyor…</p>
        )}
        <p className="text-[11px] text-paper-500">
          bu 30 hane iki tarafın kimlik anahtarlarından üretilir — karşı tarafla başka bir kanaldan
          (yüz yüze, sesli) karşılaştır; eşleşmiyorsa sunucu anahtar değiştirmiş demektir, o DM'e
          güvenme
        </p>
        <span className="sealed-band self-start">uçtan uca · x25519</span>
      </div>
    </Modal>
  );
}
