import { useEffect, useMemo, useRef, useState } from 'react';
import { useAppStore } from '../state/appStore';
import { useChatStore, type DisplayMessage, amSender } from '../state/chatStore';
import { useHiddenStore, NO_HIDDEN } from '../state/hiddenStore';
import { useUnreadStore } from '../state/unreadStore';
import { formatDay, sameDay } from '../lib/format';
import { wsSend } from '../ws/socket';
import { AlertTriangle, Lock, ShieldCheck } from 'lucide-react';
import MessageRow from './MessageRow';
import TypingLine from './TypingLine';
import ReplyBar from './ReplyBar';
import { deleteForEveryone, DeletedRow, HoverActions } from './MsgDelete';
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
  const toggleReaction = useChatStore((s) => s.toggleReaction);
  const [rekeying, setRekeying] = useState(false);
  // reply target while composing — snippet lives here, cleared on send/cancel
  const [reply, setReply] = useState<{ id: number; nick: string; body: string | null } | null>(null);
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

  // "benim için sil" — locally hidden rows never render
  const hiddenIds = useHiddenStore((s) => s.hidden[channelId] ?? NO_HIDDEN);
  const hideForMe = useHiddenStore((s) => s.hideForMe);
  const visible = useMemo(
    () => messages.filter((m) => !hiddenIds.includes(m.id)),
    [messages, hiddenIds],
  );

  // keep pinned to bottom while the user is at the bottom; preserve position otherwise
  useEffect(() => {
    if (stickToBottom.current) bottomRef.current?.scrollIntoView();
  }, [visible.length]);

  // unread divider anchor: the read marker frozen at entry — messages that
  // arrive while you're looking land above/below it, the line never moves
  const [entryRead, setEntryRead] = useState(() => useUnreadStore.getState().readMap[channelId] ?? 0);
  useEffect(() => {
    setEntryRead(useUnreadStore.getState().readMap[channelId] ?? 0);
  }, [channelId]);
  const dividerId = useMemo(
    () => visible.find((m) => m.id > entryRead)?.id ?? null,
    [visible, entryRead],
  );

  const onScroll = (): void => {
    const el = scrollRef.current;
    if (!el) return;
    stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* rota plakası — channel header */}
      <div className="flex items-center gap-3 border-b border-night-700 bg-night-900/40 px-4 py-2.5">
        <span className="font-display text-lg font-semibold uppercase tracking-[0.08em] text-paper-50">
          {channelName}
        </span>
        <span className="sealed-band">
          <ShieldCheck size={11} />
          uçtan uca mühürlü
        </span>
      </div>
      {needsRekey && (
        <div className="flex flex-wrap items-center gap-2 border-b border-lamp-600/40 bg-lamp-100/70 px-4 py-2 text-xs text-lamp-300">
          <AlertTriangle size={14} className="shrink-0 text-lamp-500" />
          <span>Bir üye çıkarıldı — eski anahtar risk altında, yazışma kilitli.</span>
          {isStaff && communityId && (
            <button
              onClick={() => {
                setRekeying(true);
                void rekeyAffected(communityId, [channelId])
                  .catch(() => {})
                  .finally(() => setRekeying(false));
              }}
              disabled={rekeying}
              className="btn-ghost !border-lamp-600/70 !py-0.5 !text-xs !text-lamp-300"
            >
              <Lock size={11} />
              {rekeying ? 'yenileniyor…' : 'anahtarı yenile'}
            </button>
          )}
        </div>
      )}
      <div ref={scrollRef} onScroll={onScroll} className="flex-1 overflow-y-auto py-2">
        {hasMore && (
          <div className="flex justify-center py-2">
            <button onClick={() => void loadOlder(channelId)} className="btn-ghost !py-1 !text-xs">
              daha eski mesajlar
            </button>
          </div>
        )}
        {visible.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-paper-500">
            <p className="text-sm">henüz yük yok — ilk mühürlü zarfı sen bırak</p>
          </div>
        )}
        {visible.map((m, i) => {
          const prev = visible[i - 1] ?? null;
          const newDay = !prev || !sameDay(prev.sentAt, m.sentAt);
          return (
            <div key={m.id}>
              {newDay && (
                <div className="my-3 flex items-center gap-3 px-4">
                  <div className="perf flex-1" aria-hidden />
                  <span className="font-display text-[11px] font-semibold uppercase tracking-[0.18em] text-paper-500">
                    {formatDay(m.sentAt)}
                  </span>
                  <div className="perf flex-1" aria-hidden />
                </div>
              )}
              {m.id === dividerId && (
                <div className="my-1 flex items-center gap-2 px-4">
                  <div className="h-px flex-1 bg-brass-500" aria-hidden />
                  <span className="plate !text-[10px] !tracking-[0.14em] text-brass-400">YENİ</span>
                  <div className="h-px flex-1 bg-brass-500" aria-hidden />
                </div>
              )}
              {m.deleted ? (
                <DeletedRow nick={m.nick} sentAt={m.sentAt} />
              ) : (
                <div className="group relative">
                  <MessageRow
                    m={m}
                    prev={prev}
                    replyBody={m.replyTo ? (visible.find((x) => x.id === m.replyTo!.id)?.body ?? null) : undefined}
                    onToggleReaction={(emoji, mine) =>
                      void toggleReaction(channelId, m.id, emoji, mine).catch(() => {})
                    }
                    canDeleteAll={amSender(m) || isStaff}
                    onReply={() => setReply({ id: m.id, nick: m.nick, body: m.body })}
                    onReact={(emoji) =>
                      void toggleReaction(channelId, m.id, emoji, !!m.reactions.find((r) => r.emoji === emoji)?.me).catch(
                        () => {},
                      )
                    }
                    onDeleteForMe={() => hideForMe(channelId, m.id)}
                    onDeleteAll={() => void deleteForEveryone(channelId, m.id).catch(() => {})}
                  />
                  <HoverActions
                    canDeleteAll={amSender(m) || isStaff}
                    onReply={() => setReply({ id: m.id, nick: m.nick, body: m.body })}
                    onReact={(emoji) => void toggleReaction(channelId, m.id, emoji, !!m.reactions.find((r) => r.emoji === emoji)?.me).catch(() => {})}
                    onDeleteAll={() => void deleteForEveryone(channelId, m.id).catch(() => {})}
                    onDeleteForMe={() => hideForMe(channelId, m.id)}
                  />
                </div>
              )}
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>
      {reply && <ReplyBar nick={reply.nick} body={reply.body} onCancel={() => setReply(null)} />}
      <TypingLine channelId={channelId} />
      <Composer
        send={(body) => {
          const target = reply;
          setReply(null);
          return send(channelId, body, target?.id);
        }}
        sending={sending}
        disabled={needsRekey}
        onTyping={() => wsSend({ type: 'typing', channel_id: channelId })}
        placeholder={
          needsRekey
            ? 'kanal yeniden anahtarlanana kadar kilitli…'
            : reply
              ? `${reply.nick} kişisine yanıt yaz…  (Enter: gönder)`
              : 'şifreli mesaj yaz…  (Enter: gönder, Shift+Enter: satır)'
        }
      />
    </div>
  );
}
