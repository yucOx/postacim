import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import { Check, SendHorizontal, Timer } from 'lucide-react';
import { useT } from '../i18n/I18nProvider';
import type { MessageKey } from '../i18n/store';
import { TTL_OPTIONS } from '../lib/ttl';
import { TTL_OFF, useTtlStore } from '../state/ttlStore';

export default function Composer({
  send,
  sending,
  placeholder,
  disabled = false,
  onTyping,
  channelId,
}: {
  send: (body: string) => Promise<void>;
  sending: boolean;
  placeholder: string;
  disabled?: boolean;
  /** fired (throttled) while the user types — typing indicator relay */
  onTyping?: () => void;
  /** kanal/DM id — verilirse kaybolan-mesaj TTL seçici gösterilir */
  channelId?: string;
}) {
  const { t } = useT();
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const lastTyping = useRef(0);

  // TTL seçici: kanal/DM başına hatırlanır (ttlStore + localStorage)
  const [ttlOpen, setTtlOpen] = useState(false);
  const ttlRef = useRef<HTMLDivElement>(null);
  const ttl = useTtlStore((s) => (channelId ? (s.ttl[channelId] ?? TTL_OFF) : TTL_OFF));
  const setTtl = useTtlStore((s) => s.setTtl);

  // picker must survive the pointer leaving it — outside click or Escape closes
  useEffect(() => {
    if (!ttlOpen) return;
    const onDown = (e: PointerEvent): void => {
      if (!ttlRef.current?.contains(e.target as Node)) setTtlOpen(false);
    };
    const onKey = (e: globalThis.KeyboardEvent): void => {
      if (e.key === 'Escape') setTtlOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [ttlOpen]);

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
      setError(err instanceof Error ? err.message : t('composer.sendError'));
      setText(body);
    }
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void submit();
    }
  };

  const ttlOption = (seconds: number, key: MessageKey): ReactNode => (
    <button
      key={key}
      type="button"
      onClick={() => {
        if (channelId) setTtl(channelId, seconds);
        setTtlOpen(false);
      }}
      className={`flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-sm transition-colors hover:bg-night-800 ${
        ttl === seconds ? 'text-lamp-400' : 'text-paper-300'
      }`}
    >
      {t(key)}
      {ttl === seconds && <Check size={12} aria-hidden />}
    </button>
  );

  return (
    <div className="px-4 pb-4">
      {error && <p className="mb-1 text-xs text-stamp-400">{error}</p>}
      <div className="flex items-end gap-2">
        {channelId && (
          <div ref={ttlRef} className="relative shrink-0">
            <button
              type="button"
              onClick={() => setTtlOpen((v) => !v)}
              disabled={disabled}
              title={t('ttl.menu')}
              aria-label={t('ttl.menu')}
              aria-expanded={ttlOpen}
              className={`rounded border p-2 transition-colors ${
                ttl > TTL_OFF
                  ? 'border-brass-500/70 bg-night-800 text-lamp-400'
                  : 'border-night-700 bg-night-900 text-paper-500 hover:border-stamp-500/70 hover:text-stamp-400'
              }`}
            >
              <Timer size={15} />
            </button>
            {ttlOpen && (
              <div className="animate-seal-in absolute bottom-full left-0 z-20 mb-1 w-36 rounded-md border border-night-700 bg-night-900 p-1 shadow-[0_10px_30px_-10px_rgba(0,0,0,0.8)]">
                {ttlOption(TTL_OFF, 'ttl.off')}
                {TTL_OPTIONS.map((o) => ttlOption(o.seconds, o.key))}
              </div>
            )}
          </div>
        )}
        <textarea
          ref={areaRef}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            resize();
            if (onTyping && e.target.value.trim() && Date.now() - lastTyping.current > 2500) {
              lastTyping.current = Date.now();
              onTyping();
            }
          }}
          onKeyDown={onKey}
          rows={1}
          placeholder={placeholder}
          disabled={disabled}
          aria-label={t('composer.ariaWrite')}
          className="input max-h-40 flex-1 resize-none py-2.5 leading-relaxed"
        />
        <button
          onClick={() => void submit()}
          disabled={disabled || sending || !text.trim()}
          aria-label={t('composer.send')}
          title={t('composer.sendTitle')}
          className="btn-lamp !h-10 !w-10 shrink-0 !p-0"
        >
          <SendHorizontal size={17} />
        </button>
      </div>
    </div>
  );
}