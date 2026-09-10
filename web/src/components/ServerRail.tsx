import { useState } from 'react';
import { ArrowUpRight, Plus } from 'lucide-react';
import { api } from '../api/client';
import { useAppStore } from '../state/appStore';
import { useDmChatStore } from '../state/dmChatStore';
import { unreadCount, useUnreadStore } from '../state/unreadStore';
import Modal from './Modal';
import { PigeonMark } from './Brand';
import { parseInviteLink } from '../crypto/invite';

export default function ServerRail({ onNavigate }: { onNavigate?: () => void }) {
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
      onNavigate?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'hata');
    } finally {
      setBusy(false);
    }
  };

  // posta çuvalı etiketi — bag tag with its punched eyelet
  const tag = (active: boolean): string =>
    `relative flex h-11 w-11 items-center justify-center transition-all ${
      active
        ? 'rounded-lg bg-lamp-500 text-night-950'
        : 'rounded-full border border-brass-700/50 bg-night-800 text-paper-300 hover:rounded-lg hover:border-brass-500 hover:bg-night-700'
    }`;

  return (
    <div className="flex w-16 shrink-0 flex-col items-center gap-2 border-r border-night-700 bg-night-900 py-3">
      <button
        onClick={() => {
          showDmHome();
          onNavigate?.();
        }}
        title="özel mesajlar / arkadaşlar"
        className={tag(view === 'dm')}
      >
        <PigeonMark size={21} />
        {dmUnread > 0 && view !== 'dm' && (
          <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full border-2 border-night-900 bg-lamp-500 px-0.5 font-display text-[9px] font-bold text-night-950">
            {dmUnread > 99 ? '99+' : dmUnread}
          </span>
        )}
      </button>
      <div className="perf w-8" aria-hidden />
      {communities.map((c) => {
        const active = c.id === activeId && view === 'community';
        return (
          <button
            key={c.id}
            onClick={() => {
              selectCommunity(c.id);
              onNavigate?.();
            }}
            title={c.name}
            className={tag(active)}
          >
            {/* eyelet — the hole the tag hangs from */}
            {!active && (
              <span
                className="absolute left-1/2 top-1 h-1.5 w-1.5 -translate-x-1/2 rounded-full bg-night-950"
                aria-hidden
              />
            )}
            <span className="mt-1.5 font-display text-sm font-bold uppercase tracking-wide">
              {c.name.slice(0, 2).toLocaleUpperCase('tr-TR')}
            </span>
          </button>
        );
      })}
      <button onClick={() => setCreating(true)} title="topluluk oluştur" className={tag(false) + ' text-lamp-500'}>
        <Plus size={19} />
      </button>
      <button onClick={() => setJoining(true)} title="davet linkiyle katıl" className={tag(false)}>
        <ArrowUpRight size={18} />
      </button>

      {joining && (
        <Modal title="Davetle katıl" onClose={() => setJoining(false)}>
          <div className="flex flex-col gap-3">
            <input
              autoFocus
              value={inviteLink}
              onChange={(e) => setInviteLink(e.target.value)}
              placeholder="davet linki: https://…/#/davet/COD…"
              className="input"
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
              className="btn-lamp"
            >
              davetle katıl
            </button>
            <div className="my-1 flex items-center gap-3">
              <div className="perf flex-1" aria-hidden />
              <span className="plate">VEYA</span>
              <div className="perf flex-1" aria-hidden />
            </div>
            <input
              value={applyName}
              onChange={(e) => setApplyName(e.target.value)}
              placeholder="topluluk adı ile başvur"
              maxLength={64}
              className="input"
            />
            {applyMsg && <p className="text-sm text-lamp-300">{applyMsg}</p>}
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
              className="btn-ghost"
            >
              başvur
            </button>
            {error && <p className="text-sm text-stamp-400">{error}</p>}
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
              className="input"
            />
            <p className="text-xs text-paper-500">
              `genel` yazı odası + `Genel Ses` sesli oda otomatik oluşturulur.
            </p>
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
