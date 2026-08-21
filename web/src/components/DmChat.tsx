import { useEffect, useRef } from 'react';
import { useAppStore } from '../state/appStore';
import { useDmChatStore } from '../state/dmChatStore';
import { useVoiceStore } from '../state/voiceStore';
import { formatDay, sameDay } from '../lib/format';
import MessageRow from './MessageRow';
import Composer from './Composer';

export default function DmChat({ dmId }: { dmId: string }) {
  const dm = useAppStore((s) => s.dms.find((d) => d.id === dmId));
  const messages = useDmChatStore((s) => s.messages[dmId] ?? []);
  const hasMore = useDmChatStore((s) => s.hasMore[dmId] ?? false);
  const loadHistory = useDmChatStore((s) => s.loadHistory);
  const loadOlder = useDmChatStore((s) => s.loadOlder);
  const sending = useDmChatStore((s) => s.sending);
  const send = useDmChatStore((s) => s.send);
  const startDmCall = useVoiceStore((s) => s.startDmCall);
  const callChannelId = useVoiceStore((s) => s.callState?.channelId ?? null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);

  useEffect(() => {
    void loadHistory(dmId);
  }, [dmId, loadHistory]);

  useEffect(() => {
    if (stickToBottom.current) bottomRef.current?.scrollIntoView();
  }, [messages.length]);

  const onScroll = (): void => {
    const el = scrollRef.current;
    if (!el) return;
    stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
  };

  if (!dm) {
    return <div className="flex flex-1 items-center justify-center text-sm text-neutral-600">DM bulunamadı</div>;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b border-neutral-800/60 px-4 py-2 text-sm font-semibold text-neutral-300">
        <span>@ {dm.peer.nick}</span>
        <span className="text-[11px] font-normal text-emerald-500/80">uçtan uca şifreli</span>
        <button
          onClick={() => void startDmCall(dmId).catch(() => {})}
          disabled={callChannelId !== null}
          className="ml-auto rounded-full border border-neutral-700 px-3 py-1 text-xs text-neutral-300 hover:bg-neutral-800 disabled:opacity-40"
          title="şifreli sesli/görüntülü ara"
        >
          📞 ara
        </button>
      </div>
      <div ref={scrollRef} onScroll={onScroll} className="flex-1 overflow-y-auto py-2">
        {hasMore && (
          <div className="flex justify-center py-2">
            <button
              onClick={() => void loadOlder(dmId)}
              className="rounded border border-neutral-700 px-3 py-1 text-xs text-neutral-400 hover:bg-neutral-800"
            >
              daha eski mesajlar
            </button>
          </div>
        )}
        {messages.length === 0 && (
          <div className="flex h-full items-center justify-center text-sm text-neutral-600">
            {dm.peer.nick} ile ilk şifreli mesajı sen yaz
          </div>
        )}
        {messages.map((m, i) => {
          const prev = messages[i - 1] ?? null;
          const newDay = !prev || !sameDay(prev.sentAt, m.sentAt);
          return (
            <div key={m.id}>
              {newDay && (
                <div className="my-2 flex items-center gap-3 px-4">
                  <div className="h-px flex-1 bg-neutral-800" />
                  <span className="text-[11px] text-neutral-500">{formatDay(m.sentAt)}</span>
                  <div className="h-px flex-1 bg-neutral-800" />
                </div>
              )}
              <MessageRow m={m} prev={prev} />
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>
      <Composer
        send={(body) => send(dmId, body)}
        sending={sending}
        placeholder={`@${dm.peer.nick} — şifreli mesaj… (Enter: gönder)`}
      />
    </div>
  );
}
