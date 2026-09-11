import type { DisplayMessage } from '../state/chatStore';
import { useChatStore } from '../state/chatStore';
import { formatTime, nickColor, sameDay } from '../lib/format';
import { amSender } from '../state/chatStore';
import { Postmark } from './Brand';

export default function MessageRow({
  m,
  prev,
}: {
  m: DisplayMessage;
  prev: DisplayMessage | null;
}) {
  const sealAt = useChatStore((s) => s.sealAt[m.id]);
  const grouped =
    prev !== null && prev.senderId === m.senderId && m.sentAt - prev.sentAt < 5 * 60_000 && sameDay(prev.sentAt, m.sentAt);
  const color = nickColor(m.nick);
  // fresh seal: the postmark thunked on when this message arrived (own messages)
  const fresh = !!sealAt && Date.now() - sealAt < 5_000;
  const own = amSender(m);

  return (
    <div className={`group flex gap-3 px-4 ${grouped ? 'py-0.5' : 'pt-3 pb-0.5'}`}>
      <div className="w-9 shrink-0">
        {!grouped && (
          <div
            className="flex h-9 w-9 items-center justify-center rounded-sm border border-brass-700/40 bg-night-800 font-display text-base font-bold"
            style={{ color }}
            aria-hidden
          >
            {m.nick[0]?.toLocaleUpperCase('tr-TR')}
          </div>
        )}
      </div>
      <div className="min-w-0 flex-1">
        {!grouped && (
          <div className="flex items-baseline gap-2">
            <span className="text-sm font-semibold" style={{ color }}>
              {m.nick}
            </span>
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
          <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-paper-100">{m.body}</p>
        )}
      </div>
    </div>
  );
}
