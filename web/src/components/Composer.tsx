import { useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { SendHorizontal } from 'lucide-react';

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
  const areaRef = useRef<HTMLTextAreaElement>(null);

  const resize = (): void => {
    const el = areaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  };

  const submit = async (): Promise<void> => {
    const body = text.trim();
    if (!body || sending || disabled) return;
    setError(null);
    try {
      setText('');
      requestAnimationFrame(resize);
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
      {error && <p className="mb-1 text-xs text-stamp-400">{error}</p>}
      <div className="flex items-end gap-2">
        <textarea
          ref={areaRef}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            resize();
          }}
          onKeyDown={onKey}
          rows={1}
          placeholder={placeholder}
          disabled={disabled}
          aria-label="mesaj yaz"
          className="input max-h-40 flex-1 resize-none py-2.5 leading-relaxed"
        />
        <button
          onClick={() => void submit()}
          disabled={disabled || sending || !text.trim()}
          aria-label="gönder"
          title="gönder"
          className="btn-lamp !h-10 !w-10 shrink-0 !p-0"
        >
          <SendHorizontal size={17} />
        </button>
      </div>
    </div>
  );
}
