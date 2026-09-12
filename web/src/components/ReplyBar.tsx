import { CornerDownRight, X } from 'lucide-react';

/** above the composer while replying — snippet of the target message */
export default function ReplyBar({
  nick,
  body,
  onCancel,
}: {
  nick: string;
  body: string | null;
  onCancel: () => void;
}): React.ReactNode {
  return (
    <div className="mx-4 mb-1 flex items-center gap-2 rounded border border-brass-600/50 bg-night-800 px-2.5 py-1.5">
      <CornerDownRight size={13} className="shrink-0 text-brass-500" aria-hidden />
      <span className="min-w-0 flex-1 truncate text-xs text-paper-300">
        <span className="font-semibold text-paper-50">{nick}</span>
        {body ? ` — ${body.slice(0, 90)}` : ' — silinmiş mesaj'}
      </span>
      <button
        onClick={onCancel}
        className="rounded p-0.5 text-paper-500 transition-colors hover:text-paper-100"
        title="yanıtı bırak"
        aria-label="yanıtı bırak"
      >
        <X size={13} />
      </button>
    </div>
  );
}