import { useEffect, useRef, useState } from 'react';
import { useAppStore } from '../state/appStore';
import { useChatStore, type DisplayMessage } from '../state/chatStore';
import { useUnreadStore } from '../state/unreadStore';
import { formatDay, sameDay } from '../lib/format';
import MessageRow from './MessageRow';
import Composer from './Composer';

// stable ref: `?? []` in a zustand selector recreates it each call and loops React 19 (#185)
const NO_MESSAGES: DisplayMessage[] = [];

export default function ChatView({ channelId, channelName }: { channelId: string; channelName: string }) {
  const messages = useChatStore((s) => s.messages[channelId] ?? NO_MESSAGES);
  const hasMore = useChatStore((s) => s.hasMore[channelId] ?? false);
  const loadHistory = useChatStore((s) => s.loadHistory);
  const loadOlder = useChatStore((s) => s.loadOlder);
  const sending = useChatStore((s) => s.sending);
  const send = useChatStore((s) => s.send);
  const communityId = useAppStore((s) => s.activeCommunityId);
  const needsRekey = useAppStore(
    (s) =>
      !!s.communities
        .find((c) => c.id === s.activeCommunityId)
        ?.channels.find((ch) => ch.id === channelId)?.needs_rekey,
  );
  const isStaff =
    useAppStore((s) => s.communities.find((c) => c.id === s.activeCommunityId)?.role) !== 'member';
  const rekeyAffected = useAppStore((s) => s.rekeyAffected);
  const [rekeying, setRekeying] = useState(false);
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
      {needsRekey && (
        <div className="flex items-center gap-2 border-b border-amber-900/40 bg-amber-950/40 px-4 py-2 text-xs text-amber-300">
          <span>⚠️ Bir üye çıkarıldı — eski anahtar risk altında, yazışma kilitli.</span>
          {isStaff && communityId && (
            <button
              onClick={() => {
                setRekeying(true);
                void rekeyAffected(communityId, [channelId])
                  .catch(() => {})
                  .finally(() => setRekeying(false));
              }}
              disabled={rekeying}
              className="rounded-full bg-amber-600/80 px-3 py-0.5 font-medium text-white hover:bg-amber-500 disabled:opacity-50"
            >
              {rekeying ? 'yenileniyor…' : 'anahtarı yenile'}
            </button>
          )}
        </div>
      )}
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
        disabled={needsRekey}
        placeholder={needsRekey ? 'kanal yeniden anahtarlanana kadar kilitli…' : 'Şifreli mesaj yaz… (Enter: gönder, Shift+Enter: satır)'}
      />
    </div>
  );
}
