import { useState } from 'react';
import type { KeyboardEvent } from 'react';

export default function Composer({
  send,
  sending,
  placeholder,
  disabled = false,
}: {
  send: (body: string) => Promise<void>;
  sending: boolean;
  placeholder: string;
  disabled?: boolean;
}) {
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);

  const submit = async (): Promise<void> => {
    const body = text.trim();
    if (!body || sending || disabled) return;
    setError(null);
    try {
      setText('');
      await send(body);
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
        placeholder={placeholder}
        disabled={disabled}
        className="max-h-40 w-full resize-none rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-2.5 text-sm text-neutral-200 outline-none placeholder:text-neutral-500 focus:border-neutral-500 disabled:opacity-50"
      />
    </div>
  );
}
