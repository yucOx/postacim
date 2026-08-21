import type { DisplayMessage } from '../state/chatStore';
import { formatTime, nickColor, sameDay } from '../lib/format';

export default function MessageRow({
  m,
  prev,
}: {
  m: DisplayMessage;
  prev: DisplayMessage | null;
}) {
  const grouped = prev !== null && prev.senderId === m.senderId && m.sentAt - prev.sentAt < 5 * 60_000 && sameDay(prev.sentAt, m.sentAt);

  return (
    <div className={`flex gap-3 px-4 ${grouped ? 'py-0.5' : 'pt-3 pb-0.5'}`}>
      <div className="w-9 shrink-0">
        {!grouped && (
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-neutral-800 text-sm font-bold">
            <span className={nickColor(m.nick)}>{m.nick[0]?.toUpperCase()}</span>
          </div>
        )}
      </div>
      <div className="min-w-0 flex-1">
        {!grouped && (
          <div className="flex items-baseline gap-2">
            <span className={`text-sm font-semibold ${nickColor(m.nick)}`}>{m.nick}</span>
            <span className="text-[11px] text-neutral-500">{formatTime(m.sentAt)}</span>
          </div>
        )}
        {m.body === null ? (
          <p className="text-sm italic text-neutral-600">🔒 bu mesaj çözülemedi</p>
        ) : (
          <p className="whitespace-pre-wrap break-words text-sm text-neutral-200">{m.body}</p>
        )}
      </div>
    </div>
  );
}
