import { useState } from 'react';
import { useAppStore } from '../state/appStore';
import Modal from './Modal';

export default function ChannelSidebar() {
  const community = useAppStore((s) => s.communities.find((c) => c.id === s.activeCommunityId));
  const activeChannelId = useAppStore((s) => s.activeChannelId);
  const selectChannel = useAppStore((s) => s.selectChannel);
  const createChannel = useAppStore((s) => s.createChannel);
  const [modalType, setModalType] = useState<'text' | 'voice' | null>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!community) {
    return <div className="w-60 shrink-0 border-r border-neutral-800/60 bg-neutral-900/40" />;
  }

  const isOwner = community.role === 'owner';
  const textChannels = community.channels.filter((c) => c.type === 'text');
  const voiceChannels = community.channels.filter((c) => c.type === 'voice');

  const submit = async (): Promise<void> => {
    if (!modalType) return;
    setBusy(true);
    setError(null);
    try {
      await createChannel(community.id, name.trim(), modalType);
      setModalType(null);
      setName('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'hata');
    } finally {
      setBusy(false);
    }
  };

  const row = (prefix: string, id: string, chName: string): React.ReactNode => (
    <button
      key={id}
      onClick={() => selectChannel(id)}
      className={`flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-sm ${
        id === activeChannelId ? 'bg-neutral-700/60 text-white' : 'text-neutral-400 hover:bg-neutral-800/60 hover:text-neutral-200'
      }`}
    >
      <span className="text-neutral-500">{prefix}</span>
      <span className="truncate">{chName}</span>
    </button>
  );

  return (
    <div className="flex w-60 shrink-0 flex-col border-r border-neutral-800/60 bg-neutral-900/40">
      <div className="border-b border-neutral-800/60 px-4 py-3 font-semibold">{community.name}</div>
      <div className="flex-1 overflow-y-auto px-2 py-2">
        <div className="mb-1 flex items-center justify-between px-2 text-[11px] font-semibold tracking-wide text-neutral-500">
          YAZI ODALARI
          {isOwner && (
            <button onClick={() => setModalType('text')} className="hover:text-neutral-200" title="yazı odası ekle">
              +
            </button>
          )}
        </div>
        <div className="mb-4 flex flex-col gap-0.5">{textChannels.map((c) => row('#', c.id, c.name))}</div>

        <div className="mb-1 flex items-center justify-between px-2 text-[11px] font-semibold tracking-wide text-neutral-500">
          SES ODALARI
          {isOwner && (
            <button onClick={() => setModalType('voice')} className="hover:text-neutral-200" title="ses odası ekle">
              +
            </button>
          )}
        </div>
        <div className="flex flex-col gap-0.5">{voiceChannels.map((c) => row('🔊', c.id, c.name))}</div>
      </div>

      {modalType && (
        <Modal
          title={modalType === 'text' ? 'Yeni yazı odası' : 'Yeni ses odası'}
          onClose={() => setModalType(null)}
        >
          <div className="flex flex-col gap-3">
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => name.trim() && e.key === 'Enter' && void submit()}
              placeholder="oda adı"
              maxLength={64}
              className="rounded-md border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm outline-none focus:border-neutral-500"
            />
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
