import { User, Users } from 'lucide-react';
import { useAppStore } from '../state/appStore';
import { useDmChatStore } from '../state/dmChatStore';
import { unreadCount, useUnreadStore } from '../state/unreadStore';

// persistent DM list — Discord-style left column, so the chat picker never
// disappears while a conversation is open
export default function DmSidebar({ onNavigate }: { onNavigate?: () => void }) {
  const dms = useAppStore((s) => s.dms);
  const gdms = useAppStore((s) => s.gdms);
  const activeDmId = useAppStore((s) => s.activeDmId);
  const openDmChat = useAppStore((s) => s.openDmChat);
  const showDmHome = useAppStore((s) => s.showDmHome);
  const dmMessages = useDmChatStore((s) => s.messages);
  useUnreadStore((s) => s.readMap); // re-render when markers change

  const byRecent = (a: { last_message_at: number | null }, b: { last_message_at: number | null }): number =>
    (b.last_message_at ?? 0) - (a.last_message_at ?? 0);

  const row = (id: string, label: string, icon: React.ReactNode): React.ReactNode => {
    const unread = unreadCount(id, dmMessages[id]);
    const active = id === activeDmId;
    return (
      <button
        key={id}
        onClick={() => {
          openDmChat(id);
          onNavigate?.();
        }}
        className={`flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-sm transition-colors ${
          active ? 'bg-night-700 text-paper-50' : 'text-paper-500 hover:bg-night-800/70 hover:text-paper-100'
        }`}
      >
        <span className="shrink-0 text-brass-600" aria-hidden>
          {icon}
        </span>
        <span className={`flex-1 truncate ${unread > 0 && !active ? 'font-semibold text-paper-100' : ''}`}>
          {label}
        </span>
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
        <span className="plate !text-sm !tracking-[0.18em] text-paper-100">MEKTUPLAR</span>
      </div>
      <div className="flex-1 overflow-y-auto px-2 py-2">
        <div className="plate mb-1 px-2">GRUPLAR</div>
        <div className="mb-4 flex flex-col gap-0.5">
          {[...gdms].sort(byRecent).map((g) => row(g.id, g.name, <Users size={13} />))}
          {gdms.length === 0 && <p className="px-2 py-1 text-xs text-paper-500">grup yok</p>}
        </div>
        <div className="plate mb-1 px-2">DM</div>
        <div className="flex flex-col gap-0.5">
          {[...dms].sort(byRecent).map((d) => row(d.id, d.peer.nick, <User size={13} />))}
          {dms.length === 0 && <p className="px-2 py-1 text-xs text-paper-500">arkadaşından başla</p>}
        </div>
      </div>
      <button
        onClick={() => {
          showDmHome();
          onNavigate?.();
        }}
        className="border-t border-night-700 px-3 py-2.5 text-left text-sm text-paper-500 transition-colors hover:bg-night-800/70 hover:text-paper-100"
      >
        yeni sohbet / arkadaş ekle
      </button>
    </div>
  );
}