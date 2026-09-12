import { useState } from 'react';
import type { DisplayMessage } from '../state/chatStore';
import { useChatStore } from '../state/chatStore';
import { formatTime, nickColor, sameDay } from '../lib/format';
import { amSender } from '../state/chatStore';
import { useAuthStore } from '../state/authStore';
import { CornerDownRight } from 'lucide-react';
import Avatar from './Avatar';
import UserCard from './UserCard';
import { Postmark } from './Brand';

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

export default function MessageRow({
  m,
  prev,
  replyBody,
  onToggleReaction,
}: {
  m: DisplayMessage;
  prev: DisplayMessage | null;
  /** snippet of the replied-to message (same channel, same list) */
  replyBody?: string | null;
  /** undefined in contexts without reaction rights (none today) */
  onToggleReaction?: (emoji: string, mine: boolean) => void;
}) {
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

  return (
    <div className={`group flex gap-3 px-4 ${grouped ? 'py-0.5' : 'pt-3 pb-0.5'}`}>
      <div className="w-9 shrink-0">
        {!grouped && (
          <button
            onClick={() => setUserCard(true)}
            className="shrink-0 rounded-sm transition-transform hover:scale-105"
            title={`${m.nick} — üye kartı`}
            aria-label={`${m.nick} üye kartı`}
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
              {replyBody ? ` — ${replyBody.slice(0, 90)}` : ' — silinmiş mesaj'}
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
                title="bu vagondan mühürlenip gönderildi"
              >
                <Postmark />
              </span>
            )}
          </div>
        )}
        {m.body === null ? (
          <p className="flex items-center gap-1.5 text-sm italic text-paper-500">
            bu zarf açılamadı — anahtar bu epoch için sende değil
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
                title={r.me ? 'tepkini geri al' : 'tepki ver'}
                aria-pressed={r.me}
              >
                {r.emoji}
                <span className="font-mono text-[10px]">{r.count}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      {userCard && <UserCard userId={m.senderId} nick={m.nick} onClose={() => setUserCard(false)} />}
    </div>
  );
}
