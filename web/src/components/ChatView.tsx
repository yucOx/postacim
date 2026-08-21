import { useEffect, useRef } from 'react';
import { useChatStore } from '../state/chatStore';
import { useUnreadStore } from '../state/unreadStore';
import { formatDay, sameDay } from '../lib/format';
import MessageRow from './MessageRow';
import Composer from './Composer';

export default function ChatView({ channelId, channelName }: { channelId: string; channelName: string }) {
  const messages = useChatStore((s) => s.messages[channelId] ?? []);
  const hasMore = useChatStore((s) => s.hasMore[channelId] ?? false);
  const loadHistory = useChatStore((s) => s.loadHistory);
  const loadOlder = useChatStore((s) => s.loadOlder);
  const sending = useChatStore((s) => s.sending);
  const send = useChatStore((s) => s.send);
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);

  useEffect(() => {
    void loadHistory(channelId);
  }, [channelId, loadHistory]);

  // active channel is read as messages arrive
  const markRead = useUnreadStore((s) => s.markRead);
  const lastId = messages.length ? messages[messages.length - 1]!.id : 0;
  useEffect(() => {
    if (lastId) markRead(channelId, lastId);
  }, [channelId, lastId, markRead]);

  // keep pinned to bottom while the user is at the bottom; preserve position otherwise
  useEffect(() => {
    if (stickToBottom.current) bottomRef.current?.scrollIntoView();
  }, [messages.length]);

  const onScroll = (): void => {
    const el = scrollRef.current;
    if (!el) return;
    stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className=" border-b border-neutral-800/60 px-4 py-2 text-sm font-semibold text-neutral-300">
        # {channelName}
        <span className="ml-2 text-[11px] font-normal text-emerald-500/80">uçtan uca şifreli</span>
      </div>
      <div ref={scrollRef} onScroll={onScroll} className="flex-1 overflow-y-auto py-2">
        {hasMore && (
          <div className="flex justify-center py-2">
            <button
              onClick={() => void loadOlder(channelId)}
              className="rounded border border-neutral-700 px-3 py-1 text-xs text-neutral-400 hover:bg-neutral-800"
            >
              daha eski mesajlar
            </button>
          </div>
        )}
        {messages.length === 0 && (
          <div className="flex h-full items-center justify-center text-sm text-neutral-600">
            henüz mesaj yok — ilk şifreli mesajı sen yaz
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
        send={(body) => send(channelId, body)}
        sending={sending}
        placeholder="Şifreli mesaj yaz… (Enter: gönder, Shift+Enter: satır)"
      />
    </div>
  );
}
