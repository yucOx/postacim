import { useState } from 'react';
import { Hash, Lock, MoreVertical, Plus, Settings, Volume2 } from 'lucide-react';
import { useAppStore } from '../state/appStore';
import { useChatStore } from '../state/chatStore';
import { unreadCount, useUnreadStore } from '../state/unreadStore';
import { useVoiceStore } from '../state/voiceStore';
import Modal from './Modal';
import ConfirmDialog from './ConfirmDialog';
import CommunitySettings from './CommunitySettings';

export default function ChannelSidebar({ onNavigate }: { onNavigate?: () => void }) {
  const community = useAppStore((s) => s.communities.find((c) => c.id === s.activeCommunityId));
  const activeChannelId = useAppStore((s) => s.activeChannelId);
  const selectChannel = useAppStore((s) => s.selectChannel);
  const createChannel = useAppStore((s) => s.createChannel);
  const voicePresence = useVoiceStore((s) => s.presence);
  const joinedVoice = useVoiceStore((s) => s.joinedChannelId);
  const chatMessages = useChatStore((s) => s.messages);
  useUnreadStore((s) => s.readMap); // re-render when markers change
  const [settings, setSettings] = useState(false);
  const [menu, setMenu] = useState(false);
  const [confirm, setConfirm] = useState<'leave' | 'delete' | null>(null);
  const leaveCommunity = useAppStore((s) => s.leaveCommunity);
  const deleteCommunity = useAppStore((s) => s.deleteCommunity);
  const [modalType, setModalType] = useState<'text' | 'voice' | null>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!community) {
    return <div className="w-60 shrink-0 border-r border-night-700 bg-night-900/50" />;
  }

  const isOwner = community.role === 'owner';
  const isStaff = isOwner || community.role === 'admin';
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
      onNavigate?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'hata');
    } finally {
      setBusy(false);
    }
  };

  const pick = (id: string): void => {
    selectChannel(id);
    onNavigate?.();
  };

  const row = (id: string, chName: string): React.ReactNode => {
    const unread = unreadCount(id, chatMessages[id]);
    const locked = community.channels.find((ch) => ch.id === id)?.needs_rekey;
    const active = id === activeChannelId;
    return (
      <button
        key={id}
        onClick={() => pick(id)}
        className={`flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-sm transition-colors ${
          active ? 'bg-night-700 text-paper-50' : 'text-paper-500 hover:bg-night-800/70 hover:text-paper-100'
        }`}
      >
        <Hash size={13} className="shrink-0 text-brass-600" aria-hidden />
        <span className={`flex-1 truncate ${unread > 0 && !active ? 'font-semibold text-paper-100' : ''}`}>
          {chName}
        </span>
        {locked && <Lock size={12} className="shrink-0 text-lamp-500" aria-label="anahtar yenilenmeli" />}
        {unread > 0 && !active && (
          <span
            className="flex h-4 min-w-4 items-center justify-center rounded-full bg-lamp-500 px-1 font-display text-[9px] font-bold text-night-950"
            aria-label={`${unread} okunmadı`}
          >
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>
    );
  };

  return (
    <div className="flex w-60 shrink-0 flex-col border-r border-night-700 bg-night-900/50">
      <div className="flex items-center justify-between border-b border-night-700 px-3 py-3">
        <span className="truncate font-display text-base font-semibold uppercase tracking-[0.12em] text-paper-100">
          {community.name}
        </span>
        <button
          onClick={() => setMenu(true)}
          className="relative ml-2 shrink-0 rounded p-1 text-paper-500 transition-colors hover:bg-night-800 hover:text-paper-100"
          title="topluluk menüsü"
          aria-label="topluluk menüsü"
        >
          <MoreVertical size={15} />
          {(community.pending_join_requests ?? 0) > 0 && (
            <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full border-2 border-night-900 bg-lamp-500 px-0.5 font-display text-[9px] font-bold text-night-950">
              {community.pending_join_requests}
            </span>
          )}
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-2 py-2">
        <div className="plate mb-1 flex items-center justify-between px-2">
          YAZI ODALARI
          {isOwner && (
            <button
              onClick={() => setModalType('text')}
              className="rounded p-0.5 text-paper-500 transition-colors hover:text-paper-100"
              title="yazı odası ekle"
              aria-label="yazı odası ekle"
            >
              <Plus size={13} />
            </button>
          )}
        </div>
        <div className="mb-4 flex flex-col gap-0.5">{textChannels.map((c) => row(c.id, c.name))}</div>

        <div className="plate mb-1 flex items-center justify-between px-2">
          SES ODALARI
          {isOwner && (
            <button
              onClick={() => setModalType('voice')}
              className="rounded p-0.5 text-paper-500 transition-colors hover:text-paper-100"
              title="ses odası ekle"
              aria-label="ses odası ekle"
            >
              <Plus size={13} />
            </button>
          )}
        </div>
        <div className="flex flex-col gap-0.5">
          {voiceChannels.map((c) => {
            const present = voicePresence[c.id] ?? [];
            const active = c.id === activeChannelId;
            return (
              <div key={c.id}>
                <button
                  onClick={() => {
                    pick(c.id);
                    if (joinedVoice !== c.id) void useVoiceStore.getState().join(c.id).catch(() => {});
                  }}
                  className={`flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-sm transition-colors ${
                    active ? 'bg-night-700 text-paper-50' : 'text-paper-500 hover:bg-night-800/70 hover:text-paper-100'
                  }`}
                >
                  <Volume2 size={13} className="shrink-0 text-brass-600" aria-hidden />
                  <span className="flex-1 truncate">{c.name}</span>
                  {c.needs_rekey && <Lock size={12} className="shrink-0 text-lamp-500" aria-label="anahtar yenilenmeli" />}
                  {present.length > 0 && (
                    <span className="font-display text-[10px] font-semibold text-lamp-400">{present.length}</span>
                  )}
                </button>
                {present.length > 0 && (
                  <div className="ml-7 flex flex-col py-0.5">
                    {present.map((p) => (
                      <span
                        key={p.user_id}
                        className={`flex items-center gap-1.5 py-0.5 text-xs ${
                          joinedVoice === c.id ? 'text-lamp-400' : 'text-paper-500'
                        }`}
                      >
                        <span className="inline-block h-1 w-1 rounded-full bg-current" aria-hidden />
                        {p.nick}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {settings && <CommunitySettings communityId={community.id} onClose={() => setSettings(false)} />}

      {menu && (
        <Modal title={community.name} onClose={() => setMenu(false)}>
          <div className="flex flex-col gap-2">
            {isStaff && (
              <button
                onClick={() => {
                  setMenu(false);
                  setSettings(true);
                }}
                className="btn-ghost"
              >
                <Settings size={14} />
                ayarlar
              </button>
            )}
            {isOwner ? (
              <button onClick={() => setConfirm('delete')} className="btn-stamp">
                topluluğu sil
              </button>
            ) : (
              <button onClick={() => setConfirm('leave')} className="btn-stamp">
                topluluktan ayrıl
              </button>
            )}
          </div>
        </Modal>
      )}

      {confirm === 'leave' && (
        <ConfirmDialog
          title="Topluluktan ayrıl"
          message={`'${community.name}' topluluğundan ayrılmak istediğine emin misin? Kalan yöneticiler kanal anahtarlarını yenileyene kadar odalar kilitli kalır.`}
          danger
          confirmLabel="ayrıl"
          onConfirm={() => {
            setConfirm(null);
            void leaveCommunity(community.id).catch(() => {});
          }}
          onCancel={() => setConfirm(null)}
        />
      )}
      {confirm === 'delete' && (
        <ConfirmDialog
          title="Topluluğu sil"
          message={`'${community.name}' topluluğu, tüm odaları ve mesajlarıyla birlikte kalıcı olarak silinecek. Bu geri alınamaz.`}
          danger
          confirmLabel="sil"
          onConfirm={() => {
            setConfirm(null);
            void deleteCommunity(community.id).catch(() => {});
          }}
          onCancel={() => setConfirm(null)}
        />
      )}

      {modalType && (
        <Modal title={modalType === 'text' ? 'Yeni yazı odası' : 'Yeni ses odası'} onClose={() => setModalType(null)}>
          <div className="flex flex-col gap-3">
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => name.trim() && e.key === 'Enter' && void submit()}
              placeholder="oda adı"
              maxLength={64}
              className="input"
            />
            {error && <p className="text-sm text-stamp-400">{error}</p>}
            <button onClick={() => void submit()} disabled={busy || !name.trim()} className="btn-lamp">
              {busy ? 'oluşturuluyor…' : 'oluştur'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
