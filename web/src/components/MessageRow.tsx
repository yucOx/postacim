import { useEffect, useRef, useState } from 'react';
import type { DisplayMessage } from '../state/chatStore';
import { useChatStore } from '../state/chatStore';
import { formatTime, nickColor, sameDay } from '../lib/format';
import { amSender } from '../state/chatStore';
import { useAuthStore } from '../state/authStore';
import { QUICK_EMOJIS } from '../lib/reactions';
import { CornerDownRight, Copy, EyeOff, Reply, Smile, Trash2 } from 'lucide-react';
import Avatar from './Avatar';
import UserCard from './UserCard';
import { Postmark } from './Brand';
import { useT } from '../i18n/I18nProvider';

// own-nick highlight: split on the nick (case-insensitive, regex-escaped) and
// wrap matches in a mention pill — plain text for everything else
function renderBodyWithMentions(body: string, nick: string): React.ReactNode[] {
  const escaped = nick.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return body.split(new RegExp(`(${escaped})`, 'gi')).map((part, i) =>
    part.toLowerCase() === nick.toLowerCase() ? (
      <span key={i} className="rounded-sm bg-lamp-500/25 px-0.5 font-semibold text-lamp-300">
        {part}
      </span>
    ) : (
      part
    ),
  );
}

interface Props {
  m: DisplayMessage;
  prev: DisplayMessage | null;
  /** snippet of the replied-to message (same channel, same list) */
  replyBody?: string | null;
  /** undefined in contexts without reaction rights (none today) */
  onToggleReaction?: (emoji: string, mine: boolean) => void;
  /** right-click menu actions — menu renders only when these are provided */
  onReply?: () => void;
  onReact?: (emoji: string) => void;
  canDeleteAll?: boolean;
  onDeleteForMe?: () => void;
  onDeleteAll?: () => void;
}

export default function MessageRow({ m, prev, replyBody, onToggleReaction, onReply, onReact, canDeleteAll, onDeleteForMe, onDeleteAll }: Props) {
  const { t } = useT();
  const sealAt = useChatStore((s) => s.sealAt[m.id]);
  const grouped =
    prev !== null && prev.senderId === m.senderId && m.sentAt - prev.sentAt < 5 * 60_000 && sameDay(prev.sentAt, m.sentAt);
  const color = nickColor(m.nick);
  // fresh seal: the postmark thunked on when this message arrived (own messages)
  const fresh = !!sealAt && Date.now() - sealAt < 5_000;
  const own = amSender(m);
  const myNick = useAuthStore((s) => s.user?.nick);
  const mentioned = !!myNick && m.body !== null && m.body.toLowerCase().includes(myNick.toLowerCase());
  const [userCard, setUserCard] = useState(false);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // sağ tık menüsü: dış tık, ESC, kaydırma ile kapanır — kullanım sırasında
  // imleç satırdan çıksa bile açık kalır
  useEffect(() => {
    if (!ctxMenu) return;
    const onDown = (e: PointerEvent): void => {
      if (!menuRef.current?.contains(e.target as Node)) setCtxMenu(null);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setCtxMenu(null);
    };
    const onScroll = (): void => setCtxMenu(null);
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    document.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('scroll', onScroll, true);
    };
  }, [ctxMenu]);

  // sağ tık: tarayıcı menüsü yerine mesaj menüsü — UserCard/modal içindeyse
  // karışmayalım (kendi native menüsü kalsın)
  const openMenu = (e: React.MouseEvent): void => {
    if ((e.target as HTMLElement).closest('[role="dialog"]')) return;
    e.preventDefault();
    setCtxMenu({ x: e.clientX, y: e.clientY });
  };

  const item = (label: string, icon: React.ReactNode, danger: boolean, fn: () => void): React.ReactNode => (
    <button
      type="button"
      onClick={() => {
        setCtxMenu(null);
        fn();
      }}
      className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm transition-colors ${
        danger ? 'text-stamp-400 hover:bg-stamp-500 hover:text-white' : 'text-paper-300 hover:bg-night-700 hover:text-paper-50'
      }`}
    >
      {icon}
      {label}
    </button>
  );

  const readable = !m.deleted && m.body !== null;

  return (
    <div className={`group flex gap-3 px-4 ${grouped ? 'py-0.5' : 'pt-3 pb-0.5'}`} onContextMenu={openMenu}>
      <div className="w-9 shrink-0">
        {!grouped && (
          <button
            onClick={() => setUserCard(true)}
            className="shrink-0 rounded-sm transition-transform hover:scale-105"
            title={t('message.userCardTitle', { name: m.nick })}
            aria-label={t('message.userCardAria', { name: m.nick })}
          >
            <Avatar userId={m.senderId} label={m.nick} size={36} />
          </button>
        )}
      </div>
      <div className="min-w-0 flex-1">
        {m.replyTo && (
          <div className="mb-0.5 flex items-center gap-1 text-xs text-paper-500">
            <CornerDownRight size={11} className="shrink-0 text-brass-500" aria-hidden />
            <span className="truncate">
              <span className="font-semibold" style={{ color: nickColor(m.replyTo.nick) }}>
                {m.replyTo.nick}
              </span>
              {replyBody ? t('message.replySnippet', { body: replyBody.slice(0, 90) }) : t('message.deletedSnippet')}
            </span>
          </div>
        )}
        {!grouped && (
          <div className="flex items-baseline gap-2">
            <button
              onClick={() => setUserCard(true)}
              className="text-sm font-semibold transition-opacity hover:opacity-80"
              style={{ color }}
            >
              {m.nick}
            </button>
            {/* client clock wins: the server-forged sent_at stays cosmetic-only */}
            <span className="font-mono text-[10px] text-paper-500">{formatTime(m.clientSentAt ?? m.sentAt)}</span>
            {own && (
              <span
                className={`text-brass-500 ${fresh ? 'animate-stamp' : ''}`}
                title={t('message.sealTitle')}
              >
                <Postmark />
              </span>
            )}
          </div>
        )}
        {m.body === null ? (
          <p className="flex items-center gap-1.5 text-sm italic text-paper-500">
            {t('message.undecryptable')}
          </p>
        ) : (
          <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-paper-100">
            {mentioned && myNick ? renderBodyWithMentions(m.body!, myNick) : m.body}
          </p>
        )}
        {m.reactions.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1">
            {m.reactions.map((r) => (
              <button
                key={r.emoji}
                onClick={() => onToggleReaction?.(r.emoji, r.me)}
                className={`flex items-center gap-1 rounded-full border px-1.5 py-px text-xs transition-colors ${
                  r.me
                    ? 'border-lamp-500/70 bg-lamp-100/60 text-lamp-300'
                    : 'border-night-600 bg-night-800 text-paper-300 hover:border-brass-600'
                }`}
                title={r.me ? t('message.reactUndo') : t('message.reactAdd')}
                aria-pressed={r.me}
              >
                {r.emoji}
                <span className="font-mono text-[10px]">{r.count}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      {ctxMenu && (
        <div
          ref={menuRef}
          className="animate-seal-in fixed z-50 w-52 rounded-md border border-night-700 bg-night-900 p-1 shadow-[0_10px_30px_-10px_rgba(0,0,0,0.8)]"
          style={{
            left: Math.min(ctxMenu.x, (window.innerWidth ?? 0) - 224),
            top: Math.min(ctxMenu.y, (window.innerHeight ?? 0) - 264),
          }}
          onClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.preventDefault()}
        >
          {onReply && item(t('message.ctxReply'), <Reply size={13} />, false, onReply)}
          {onReact && readable && (
            <div className="flex gap-0.5 rounded px-2 py-1">
              {QUICK_EMOJIS.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  onClick={() => {
                    setCtxMenu(null);
                    onReact(emoji);
                  }}
                  className="rounded p-0.5 text-sm transition-transform hover:scale-125"
                  aria-label={t('message.reactAria', { emoji })}
                >
                  {emoji}
                </button>
              ))}
            </div>
          )}
          {readable &&
            item(t('message.ctxCopy'), <Copy size={13} />, false, () => {
              try {
                void navigator.clipboard.writeText(m.body!);
              } catch {
                // http (localhost dışı) gibi güvenli olmayan bağlamda yok
              }
            })}
          <div className="my-1 h-px bg-night-700" aria-hidden />
          {onDeleteForMe && item(t('message.ctxDeleteForMe'), <EyeOff size={13} />, true, onDeleteForMe)}
          {canDeleteAll && onDeleteAll && item(t('message.ctxDeleteAll'), <Trash2 size={13} />, true, onDeleteAll)}
        </div>
      )}
      {userCard && <UserCard userId={m.senderId} nick={m.nick} onClose={() => setUserCard(false)} />}
    </div>
  );
}