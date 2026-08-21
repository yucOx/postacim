import { useState } from 'react';
import { useAppStore } from '../state/appStore';
import Modal from './Modal';

export default function ServerRail() {
  const communities = useAppStore((s) => s.communities);
  const activeId = useAppStore((s) => s.activeCommunityId);
  const selectCommunity = useAppStore((s) => s.selectCommunity);
  const createCommunity = useAppStore((s) => s.createCommunity);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await createCommunity(name.trim());
      setCreating(false);
      setName('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'hata');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex w-16 shrink-0 flex-col items-center gap-2 border-r border-neutral-800/60 bg-neutral-900/60 py-3">
      {communities.map((c) => (
        <button
          key={c.id}
          onClick={() => selectCommunity(c.id)}
          title={c.name}
          className={`flex h-11 w-11 items-center justify-center rounded-full text-sm font-bold transition-all ${
            c.id === activeId
              ? 'rounded-2xl bg-indigo-600 text-white'
              : 'bg-neutral-800 text-neutral-300 hover:rounded-2xl hover:bg-neutral-700'
          }`}
        >
          {c.name.slice(0, 2).toUpperCase()}
        </button>
      ))}
      <button
        onClick={() => setCreating(true)}
        title="topluluk oluştur"
        className="flex h-11 w-11 items-center justify-center rounded-full bg-neutral-800 text-xl text-emerald-400 transition-all hover:rounded-2xl hover:bg-emerald-600 hover:text-white"
      >
        +
      </button>

      {creating && (
        <Modal title="Yeni topluluk" onClose={() => setCreating(false)}>
          <div className="flex flex-col gap-3">
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => name.trim() && e.key === 'Enter' && void submit()}
              placeholder="topluluk adı"
              maxLength={64}
              className="rounded-md border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm outline-none focus:border-neutral-500"
            />
            <p className="text-xs text-neutral-500">
              `genel` yazı odası + `Genel Ses` sesli oda otomatik oluşturulur.
            </p>
            {error && <p className="text-sm text-red-400">{error}</p>}
            <button
              onClick={() => void submit()}
              disabled={busy || !name.trim()}
              className="rounded-md bg-indigo-600 py-2 text-sm font-medium hover:bg-indigo-500 disabled:opacity-50"
            >
              {busy ? 'oluşturuluyor…' : 'oluştur'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
