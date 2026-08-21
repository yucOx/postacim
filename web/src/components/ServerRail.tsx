import { useState } from 'react';
import { api } from '../api/client';
import { useAppStore } from '../state/appStore';
import { useDmChatStore } from '../state/dmChatStore';
import { unreadCount, useUnreadStore } from '../state/unreadStore';
import Modal from './Modal';
import { parseInviteLink } from '../crypto/invite';

export default function ServerRail() {
  const communities = useAppStore((s) => s.communities);
  const activeId = useAppStore((s) => s.activeCommunityId);
  const selectCommunity = useAppStore((s) => s.selectCommunity);
  const createCommunity = useAppStore((s) => s.createCommunity);
  const view = useAppStore((s) => s.view);
  const showDmHome = useAppStore((s) => s.showDmHome);
  const dms = useAppStore((s) => s.dms);
  const dmMessages = useDmChatStore((s) => s.messages);
  useUnreadStore((s) => s.readMap);
  const dmUnread = dms.reduce((n, d) => n + unreadCount(d.id, dmMessages[d.id]), 0);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);
  const [inviteLink, setInviteLink] = useState('');
  const [applyName, setApplyName] = useState('');
  const [applyMsg, setApplyMsg] = useState<string | null>(null);

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
      <button
        onClick={showDmHome}
        title="özel mesajlar / arkadaşlar"
        className={`relative flex h-11 w-11 items-center justify-center rounded-full text-lg transition-all ${
          view === 'dm'
            ? 'rounded-2xl bg-indigo-600 text-white'
            : 'bg-neutral-800 text-neutral-300 hover:rounded-2xl hover:bg-neutral-700'
        }`}
      >
        🕊️
        {dmUnread > 0 && view !== 'dm' && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[9px] font-bold text-white">
            {dmUnread > 99 ? '99+' : dmUnread}
          </span>
        )}
      </button>
      <div className="h-px w-8 bg-neutral-800" />
      {communities.map((c) => (
        <button
          key={c.id}
          onClick={() => selectCommunity(c.id)}
          title={c.name}
          className={`flex h-11 w-11 items-center justify-center rounded-full text-sm font-bold transition-all ${
            c.id === activeId && view === 'community'
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
      <button
        onClick={() => setJoining(true)}
        title="davet linkiyle katıl"
        className="flex h-11 w-11 items-center justify-center rounded-full bg-neutral-800 text-lg text-neutral-400 transition-all hover:rounded-2xl hover:bg-indigo-600 hover:text-white"
      >
        ↗
      </button>

      {joining && (
        <Modal title="Katıl" onClose={() => setJoining(false)}>
          <div className="flex flex-col gap-3">
            <input
              autoFocus
              value={inviteLink}
              onChange={(e) => setInviteLink(e.target.value)}
              placeholder="davet linki: https://…/#/davet/COD…"
              className="rounded-md border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm outline-none focus:border-neutral-500"
            />
            <button
              onClick={() => {
                if (!parseInviteLink(inviteLink)) {
                  setError('geçerli bir davet linki değil');
                  return;
                }
                // reuse the link's own fragment verbatim (ephemeral key encoding preserved)
                const idx = inviteLink.indexOf('#/davet/');
                setJoining(false);
                setInviteLink('');
                location.hash = inviteLink.slice(idx);
              }}
              disabled={!inviteLink.trim()}
              className="rounded-md bg-indigo-600 py-2 text-sm font-medium hover:bg-indigo-500 disabled:opacity-50"
            >
              davetle katıl
            </button>
            <div className="h-px bg-neutral-800" />
            <input
              value={applyName}
              onChange={(e) => setApplyName(e.target.value)}
              placeholder="veya topluluk adı ile başvur"
              maxLength={64}
              className="rounded-md border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm outline-none focus:border-neutral-500"
            />
            {applyMsg && <p className="text-sm text-emerald-400">{applyMsg}</p>}
            <button
              onClick={async () => {
                setError(null);
                setApplyMsg(null);
                try {
                  const com = await api<{ id: string }>(`/communities/by-name/${encodeURIComponent(applyName.trim())}`);
                  await api(`/communities/${com.id}/join-requests`, { method: 'POST' });
                  setApplyMsg('başvurun gönderildi — onay bekleniyor');
                  setApplyName('');
                } catch (err) {
                  setError(err instanceof Error ? err.message : 'hata');
                }
              }}
              disabled={!applyName.trim()}
              className="rounded-md bg-neutral-700 py-2 text-sm font-medium hover:bg-neutral-600 disabled:opacity-50"
            >
              başvur
            </button>
            {error && <p className="text-sm text-red-400">{error}</p>}
          </div>
        </Modal>
      )}

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
