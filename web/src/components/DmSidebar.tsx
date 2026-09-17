import { Users } from 'lucide-react';
import { useAppStore } from '../state/appStore';
import { useDmChatStore } from '../state/dmChatStore';
import { unreadCount, useUnreadStore } from '../state/unreadStore';
import Avatar from './Avatar';
import { useT } from '../i18n/I18nProvider';

// persistent DM list — Discord-style left column, so the chat picker never
// disappears while a conversation is open
export default function DmSidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { t } = useT();
  const dms = useAppStore((s) => s.dms);
  const gdms = useAppStore((s) => s.gdms);
  const activeDmId = useAppStore((s) => s.activeDmId);
  const openDmChat = useAppStore((s) => s.openDmChat);
  const showDmHome = useAppStore((s) => s.showDmHome);
  const dmMessages = useDmChatStore((s) => s.messages);
  useUnreadStore((s) => s.readMap); // re-render when markers change

  const unhideDmInStorage = (id: string): void => {
    try {
      const raw = JSON.parse(localStorage.getItem('pgv_dm_rail_hidden') ?? '[]') as string[];
      if (Array.isArray(raw) && raw.includes(id)) {
        localStorage.setItem('pgv_dm_rail_hidden', JSON.stringify(raw.filter((x) => x !== id)));
      }
    } catch {
      // ignore
    }
  };

  const byRecent = (a: { last_message_at: number | null }, b: { last_message_at: number | null }): number =>
    (b.last_message_at ?? 0) - (a.last_message_at ?? 0);

  const row = (id: string, label: string, visual: React.ReactNode): React.ReactNode => {
    const unread = unreadCount(id, dmMessages[id]);
    const active = id === activeDmId;
    return (
      <button
        key={id}
        onClick={() => {
          unhideDmInStorage(id);
          openDmChat(id);
          onNavigate?.();
        }}
        className={`flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-sm transition-colors ${
          active ? 'bg-night-700 text-paper-50' : 'text-paper-500 hover:bg-night-800/70 hover:text-paper-100'
        }`}
      >
        <span className="shrink-0" aria-hidden>
          {visual}
        </span>
        <span className={`flex-1 truncate ${unread > 0 && !active ? 'font-semibold text-paper-100' : ''}`}>
          {label}
        </span>
        {unread > 0 && !active && (
          <span
            className="flex h-4 min-w-4 items-center justify-center rounded-full bg-lamp-500 px-1 font-display text-[9px] font-bold text-night-950"
            aria-label={t('nav.unread', { n: unread })}
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
        <span className="plate !text-sm !tracking-[0.18em] text-paper-100">{t('nav.letters')}</span>
      </div>
      <div className="flex-1 overflow-y-auto px-2 py-2">
        <div className="plate mb-1 px-2">{t('nav.groups')}</div>
        <div className="mb-4 flex flex-col gap-0.5">
          {[...gdms].sort(byRecent).map((g) => row(g.id, g.name, <Users size={16} />))}
          {gdms.length === 0 && <p className="px-2 py-1 text-xs text-paper-500">{t('nav.noGroups')}</p>}
        </div>
        <div className="plate mb-1 px-2">DM</div>
        <div className="flex flex-col gap-0.5">
          {[...dms].sort(byRecent).map((d) => row(d.id, d.peer.nick, <Avatar userId={d.peer.id} label={d.peer.nick} size={22} />))}
          {dms.length === 0 && <p className="px-2 py-1 text-xs text-paper-500">{t('nav.noDms')}</p>}
        </div>
      </div>
      <button
        onClick={() => {
          showDmHome();
          onNavigate?.();
        }}
        className="border-t border-night-700 px-3 py-2.5 text-left text-sm text-paper-500 transition-colors hover:bg-night-800/70 hover:text-paper-100"
      >
        {t('nav.newChat')}
      </button>
    </div>
  );
}