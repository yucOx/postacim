import { useState } from 'react';
import type { KeyboardEvent } from 'react';
import { useChatStore } from '../state/chatStore';

export default function Composer({ channelId }: { channelId: string }) {
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const sending = useChatStore((s) => s.sending);
  const send = useChatStore((s) => s.send);

  const submit = async (): Promise<void> => {
    const body = text.trim();
    if (!body || sending) return;
    setError(null);
    try {
      setText('');
      await send(channelId, body);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'gönderilemedi');
      setText(body);
    }
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void submit();
    }
  };

  return (
    <div className="px-4 pb-4">
      {error && <p className="mb-1 text-xs text-red-400">{error}</p>}
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKey}
        rows={1}
        placeholder="Şifreli mesaj yaz… (Enter: gönder, Shift+Enter: satır)"
        className="max-h-40 w-full resize-none rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-2.5 text-sm text-neutral-200 outline-none placeholder:text-neutral-500 focus:border-neutral-500"
      />
    </div>
  );
}
