import { useMemo, useState } from 'react';
import { ArrowUpRight, Plus } from 'lucide-react';
import { api } from '../api/client';
import { useAppStore } from '../state/appStore';
import { useDmChatStore } from '../state/dmChatStore';
import { useVoiceStore } from '../state/voiceStore';
import { unreadCount, useUnreadStore } from '../state/unreadStore';
import Modal from './Modal';
import { PigeonMark } from './Brand';
import Avatar from './Avatar';
import { parseInviteLink } from '../crypto/invite';
import { useT } from '../i18n/I18nProvider';

// server rail order — client-side only, the server never learns it
const ORDER_KEY = 'pgv_com_order';
const loadOrder = (): string[] => {
  try {
    const v = JSON.parse(localStorage.getItem(ORDER_KEY) ?? '[]') as unknown;
    return Array.isArray(v) ? (v as string[]) : [];
  } catch {
    return [];
  }
};

export default function ServerRail({ onNavigate }: { onNavigate?: () => void }) {
  const { t } = useT();
  const communities = useAppStore((s) => s.communities);
  const activeId = useAppStore((s) => s.activeCommunityId);
  const selectCommunity = useAppStore((s) => s.selectCommunity);
  const createCommunity = useAppStore((s) => s.createCommunity);
  const view = useAppStore((s) => s.view);
  const showDmHome = useAppStore((s) => s.showDmHome);
  const activeDmId = useAppStore((s) => s.activeDmId);
  const openDmChat = useAppStore((s) => s.openDmChat);
  const dms = useAppStore((s) => s.dms);
  const dmMessages = useDmChatStore((s) => s.messages);
  useUnreadStore((s) => s.readMap);
  const dmUnread = dms.reduce((n, d) => n + unreadCount(d.id, dmMessages[d.id]), 0);

  const messagedDms = useMemo(() => {
    return dms
      .filter((d) => d.last_message_at !== null || (dmMessages[d.id] && dmMessages[d.id].length > 0))
      .sort((a, b) => (b.last_message_at ?? 0) - (a.last_message_at ?? 0));
  }, [dms, dmMessages]);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);
  const [inviteLink, setInviteLink] = useState('');
  const [applyName, setApplyName] = useState('');
  const [applyMsg, setApplyMsg] = useState<string | null>(null);
  // sürükle-bırak sıralama — bilinmeyenler (yeni katılan) en sona düşer
  const [order, setOrder] = useState<string[]>(loadOrder);
  const [dragId, setDragId] = useState<string | null>(null);
  const sorted = useMemo(() => {
    const idx = (id: string): number => {
      const i = order.indexOf(id);
      return i === -1 ? Number.MAX_SAFE_INTEGER : i;
    };
    return [...communities].sort((a, b) => idx(a.id) - idx(b.id));
  }, [communities, order]);

  const persistOrder = (next: string[]): void => {
    setOrder(next);
    try {
      localStorage.setItem(ORDER_KEY, JSON.stringify(next));
    } catch {
      // private mode — session-only
    }
  };

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
        title={t('nav.dmHome')}
        className={tag(view === 'dm' && !activeDmId)}
      >
        <PigeonMark size={21} />
        {dmUnread > 0 && view !== 'dm' && (
          <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full border-2 border-night-900 bg-lamp-500 px-0.5 font-display text-[9px] font-bold text-night-950">
            {dmUnread > 99 ? '99+' : dmUnread}
          </span>
        )}
      </button>

      {/* Önceden mesajlaşılmış kişiler (Discord tarzı sol ray ikonları) */}
      {messagedDms.map((d) => {
        const active = view === 'dm' && activeDmId === d.id;
        const unread = unreadCount(d.id, dmMessages[d.id]);
        return (
          <button
            key={d.id}
            onClick={() => {
              if (useVoiceStore.getState().isDmCall && !useVoiceStore.getState().pip) {
                useVoiceStore.getState().setPip(true);
              }
              openDmChat(d.id);
              onNavigate?.();
            }}
            title={d.peer.nick}
            className={`group relative flex h-11 w-11 items-center justify-center transition-all ${
              active
                ? 'rounded-2xl ring-2 ring-lamp-500 bg-night-800'
                : 'rounded-full border border-brass-700/50 bg-night-800 hover:rounded-2xl hover:border-brass-500'
            }`}
          >
            <Avatar userId={d.peer.id} label={d.peer.nick} size={38} />
            {unread > 0 && !active && (
              <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full border-2 border-night-900 bg-lamp-500 px-0.5 font-display text-[9px] font-bold text-night-950">
                {unread > 99 ? '99+' : unread}
              </span>
            )}
            {/* Discord tarzı sol aktif beyaz çentik */}
            {active && (
              <span className="absolute -left-3 top-1/2 h-8 w-1.5 -translate-y-1/2 rounded-r-full bg-paper-50" />
            )}
          </button>
        );
      })}

      <div className="perf w-8" aria-hidden />
      {sorted.map((c) => {
        const active = c.id === activeId && view === 'community';
        return (
          <button
            key={c.id}
            onClick={() => {
              if (useVoiceStore.getState().isDmCall && !useVoiceStore.getState().pip) {
                useVoiceStore.getState().setPip(true);
              }
              selectCommunity(c.id);
              onNavigate?.();
            }}
            title={c.name}
            draggable
            onDragStart={(e) => {
              setDragId(c.id);
              e.dataTransfer.effectAllowed = 'move';
            }}
            onDragEnd={() => setDragId(null)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const from = dragId;
              setDragId(null);
              if (!from || from === c.id) return;
              const ids = sorted.map((s) => s.id);
              const fromI = ids.indexOf(from);
              const toI = ids.indexOf(c.id);
              if (fromI < 0 || toI < 0) return;
              ids.splice(toI, 0, ids.splice(fromI, 1)[0]!);
              persistOrder(ids);
            }}
            className={tag(active) + (dragId === c.id ? ' opacity-40' : '')}
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
      <button onClick={() => setCreating(true)} title={t('nav.createCommunity')} className={tag(false) + ' text-lamp-500'}>
        <Plus size={19} />
      </button>
      <button onClick={() => setJoining(true)} title={t('nav.joinWithInvite')} className={tag(false)}>
        <ArrowUpRight size={18} />
      </button>

      {joining && (
        <Modal title={t('nav.joinSubmit')} onClose={() => setJoining(false)}>
          <div className="flex flex-col gap-3">
            <input
              autoFocus
              value={inviteLink}
              onChange={(e) => setInviteLink(e.target.value)}
              placeholder={t('nav.invitePlaceholder')}
              className="input"
            />
            <button
              onClick={() => {
                if (!parseInviteLink(inviteLink)) {
                  setError(t('nav.invalidInvite'));
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
              {t('nav.joinSubmit')}
            </button>
            <div className="my-1 flex items-center gap-3">
              <div className="perf flex-1" aria-hidden />
              <span className="plate">{t('nav.or')}</span>
              <div className="perf flex-1" aria-hidden />
            </div>
            <input
              value={applyName}
              onChange={(e) => setApplyName(e.target.value)}
              placeholder={t('nav.applyPlaceholder')}
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
                  setApplyMsg(t('nav.applySent'));
                  setApplyName('');
                } catch (err) {
                  setError(err instanceof Error ? err.message : 'hata');
                }
              }}
              disabled={!applyName.trim()}
              className="btn-ghost"
            >
              {t('nav.applySubmit')}
            </button>
            {error && <p className="text-sm text-stamp-400">{error}</p>}
          </div>
        </Modal>
      )}

      {creating && (
        <Modal title={t('nav.newCommunity')} onClose={() => setCreating(false)}>
          <div className="flex flex-col gap-3">
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => name.trim() && e.key === 'Enter' && void submit()}
              placeholder={t('nav.newCommunityPlaceholder')}
              maxLength={64}
              className="input"
            />
            <p className="text-xs text-paper-500">
              {t('nav.newCommunityHint')}
            </p>
            {error && <p className="text-sm text-stamp-400">{error}</p>}
            <button onClick={() => void submit()} disabled={busy || !name.trim()} className="btn-lamp">
              {busy ? t('nav.creating') : t('nav.create')}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
