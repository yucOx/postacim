import { useTypingStore, TYPING_TTL } from '../state/typingStore';

/** "nick yazıyor…" line above the composer — Discord-style presence. */
export default function TypingLine({ channelId }: { channelId: string }): React.ReactNode {
  const typers = useTypingStore((s) => s.byChannel[channelId]);
  const now = Date.now();
  const names = Object.values(typers ?? {})
    .filter((t) => now - t.at < TYPING_TTL)
    .map((t) => t.nick);
  if (names.length === 0) return null;
  return (
    <p className="px-4 pb-1 pt-1 text-xs text-lamp-400" aria-live="polite">
      {names.join(', ')} yazıyor…
    </p>
  );
}