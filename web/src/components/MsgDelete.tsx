import { useState } from 'react';
import { EyeOff, Reply, Smile, Trash2 } from 'lucide-react';
import { api } from '../api/client';
import { formatTime } from '../lib/format';
import { QUICK_EMOJIS } from '../lib/reactions';

// dm_/gdm_ channel ids pick their own endpoint + AAD scope; community channels are 'ch'
const scopeOf = (channelId: string): 'ch' | 'dm' | 'gdm' =>
  channelId.startsWith('gdm_') ? 'gdm' : channelId.startsWith('dm_') ? 'dm' : 'ch';

/** delete for everyone — the server tombstones the row and pushes message:deleted */
export async function deleteForEveryone(channelId: string, messageId: number): Promise<void> {
  await api(`/messages/${scopeOf(channelId)}/${channelId}/${messageId}`, { method: 'DELETE' });
}

/** muted placeholder rendered in place of a tombstoned message */
export function DeletedRow({ nick, sentAt }: { nick: string; sentAt: number }) {
  return (
    <div className="flex gap-3 px-4 pt-3 pb-0.5">
      <div className="w-9 shrink-0">
        <div
          className="flex h-9 w-9 items-center justify-center rounded-sm border border-night-700/40 bg-night-900 font-display text-base font-bold text-paper-500"
          aria-hidden
        >
          {nick[0]?.toLocaleUpperCase('tr-TR')}
        </div>
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="text-sm font-semibold text-paper-500">{nick}</span>
          <span className="font-mono text-[10px] text-paper-500">{formatTime(sentAt)}</span>
        </div>
        <p className="text-sm italic text-paper-500">bu mesaj silindi</p>
      </div>
    </div>
  );
}

/** hover affordance on a live message row: reply, quick reaction chips, delete
 *  for everyone (when allowed) and the always-available local "delete for me" */
export function HoverActions({
  canDeleteAll,
  onReply,
  onReact,
  onDeleteAll,
  onDeleteForMe,
}: {
  canDeleteAll: boolean;
  onReply: () => void;
  onReact: (emoji: string) => void;
  onDeleteAll: () => void;
  onDeleteForMe: () => void;
}) {
  const [picking, setPicking] = useState(false);
  const cls =
    'rounded border border-night-700 bg-night-900 p-1 text-paper-500 transition-colors hover:border-stamp-500/70 hover:text-stamp-400';
  return (
    <div className="absolute right-4 top-1 z-10 hidden items-center gap-1 group-hover:flex">
      <button type="button" onClick={onReply} title="yanıtla" aria-label="yanıtla" className={cls}>
        <Reply size={12} />
      </button>
      <button
        type="button"
        onClick={() => setPicking((v) => !v)}
        title="tepki ver"
        aria-label="tepki ver"
        aria-expanded={picking}
        className={cls}
      >
        <Smile size={12} />
      </button>
      {canDeleteAll && (
        <button type="button" onClick={onDeleteAll} title="herkes için sil" aria-label="herkes için sil" className={cls}>
          <Trash2 size={12} />
        </button>
      )}
      <button type="button" onClick={onDeleteForMe} title="benim için sil" aria-label="benim için sil" className={cls}>
        <EyeOff size={12} />
      </button>
      {picking && (
        <div className="absolute right-0 top-full z-20 mt-1 flex gap-0.5 rounded-md border border-night-700 bg-night-900 p-1 shadow-[0_10px_30px_-10px_rgba(0,0,0,0.8)]">
          {QUICK_EMOJIS.map((emoji) => (
            <button
              key={emoji}
              type="button"
              onClick={() => {
                setPicking(false);
                onReact(emoji);
              }}
              className="rounded p-0.5 text-sm transition-transform hover:scale-125"
              aria-label={`tepki: ${emoji}`}
            >
              {emoji}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
