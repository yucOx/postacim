import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, Fingerprint, LogOut, Phone, UserPlus, Users, Video } from 'lucide-react';
import { useAppStore } from '../state/appStore';
import { useDmChatStore, type DmDisplayMessage } from '../state/dmChatStore';
import { amSender } from '../state/chatStore';
import { useAuthStore } from '../state/authStore';
import { useHiddenStore, NO_HIDDEN } from '../state/hiddenStore';
import { useUnreadStore } from '../state/unreadStore';
import { useVoiceStore } from '../state/voiceStore';
import { formatDay, sameDay } from '../lib/format';
import { wsSend } from '../ws/socket';
import ConfirmDialog from './ConfirmDialog';
import MessageRow from './MessageRow';
import TypingLine from './TypingLine';
import ReplyBar from './ReplyBar';
import { deleteForEveryone, DeletedRow, HoverActions } from './MsgDelete';
import Composer from './Composer';
import Modal from './Modal';
import SafetyModal from './SafetyModal';
import { isExpired, useExpiryTick } from '../lib/ttl';
import { ShieldCheck } from 'lucide-react';
import { useT } from '../i18n/I18nProvider';

// stable ref: `?? []` in a zustand selector recreates it each call and loops React 19 (#185)
const NO_MESSAGES: DmDisplayMessage[] = [];

function AddMemberModal({ gdmId, onClose }: { gdmId: string; onClose: () => void }) {
  const { t } = useT();
  const friends = useAppStore((s) => s.friends);
  const gdm = useAppStore((s) => s.gdms.find((g) => g.id === gdmId));
  const addGdmMember = useAppStore((s) => s.addGdmMember);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const candidates = friends.filter((f) => !gdm?.members.some((m) => m.id === f.id));

  return (
    <Modal title={t('addMember.title')} onClose={onClose}>
      <div className="flex w-72 flex-col gap-2">
        {candidates.length === 0 && <p className="text-sm text-paper-500">{t('addMember.empty')}</p>}
        {candidates.map((f) => (
          <button
            key={f.id}
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                await addGdmMember(gdmId, f.id);
                onClose();
              } catch (err) {
                setError(err instanceof Error ? err.message : t('addMember.errorFallback'));
              } finally {
                setBusy(false);
              }
            }}
            className="flex items-center justify-between rounded px-2 py-1.5 text-left text-sm text-paper-300 transition-colors hover:bg-night-800"
          >
            {f.nick}
            <span className="text-xs text-lamp-500">{t('addMember.add')}</span>
          </button>
        ))}
        {error && <p className="text-sm text-stamp-400">{error}</p>}
        <p className="text-[11px] text-paper-500">{t('addMember.rekeyHint')}</p>
      </div>
    </Modal>
  );
}

export default function DmChat({ dmId }: { dmId: string }) {
  const { t } = useT();
  const dm = useAppStore((s) => s.dms.find((d) => d.id === dmId));
  const gdm = useAppStore((s) => s.gdms.find((g) => g.id === dmId));
  const showDmHome = useAppStore((s) => s.showDmHome);
  const leaveGdm = useAppStore((s) => s.leaveGdm);
  const messages = useDmChatStore((s) => s.messages[dmId] ?? NO_MESSAGES);
  const hasMore = useDmChatStore((s) => s.hasMore[dmId] ?? false);
  const loadHistory = useDmChatStore((s) => s.loadHistory);
  const loadOlder = useDmChatStore((s) => s.loadOlder);
  const sending = useDmChatStore((s) => s.sending);
  const send = useDmChatStore((s) => s.send);
  const toggleReaction = useDmChatStore((s) => s.toggleReaction);
  // reply target while composing — snippet lives here, cleared on send/cancel
  const [reply, setReply] = useState<{ id: number; nick: string; body: string | null } | null>(null);
  const startDmCall = useVoiceStore((s) => s.startDmCall);
  const callPhase = useVoiceStore((s) => s.callState?.phase ?? null);
  const callChannelId = useVoiceStore((s) => s.callState?.channelId ?? null);
  // karşı taraf bu DM'nin arama odasında mı (Discord "aramada" bandı)
  const peerInCall = useVoiceStore((s) => s.dmPeerInCall[dmId] === true);
  // only lock the buttons while a call is actually live; "ended" or absent is
  // re-callable immediately, no 3s grace.
  const callLocked = callPhase === 'active' || callPhase === 'ringing' || callPhase === 'incoming';
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const [adding, setAdding] = useState(false);
  const [showLeave, setShowLeave] = useState(false);
  const [safety, setSafety] = useState(false);

  useEffect(() => {
    void loadHistory(dmId);
  }, [dmId, loadHistory]);

  // active DM is read as messages arrive
  const markRead = useUnreadStore((s) => s.markRead);
  const lastId = messages.length ? messages[messages.length - 1]!.id : 0;
  useEffect(() => {
    if (lastId) markRead(dmId, lastId);
  }, [dmId, lastId, markRead]);

  // "benim için sil" — locally hidden rows never render
  const hiddenIds = useHiddenStore((s) => s.hidden[dmId] ?? NO_HIDDEN);
  const hideForMe = useHiddenStore((s) => s.hideForMe);
  const visible = useMemo(
    () => messages.filter((m) => !hiddenIds.includes(m.id)),
    [messages, hiddenIds],
  );
  // kaybolan mesajlar: süresi dolan satırlar tombstone'a döner — 30 sn'lik
  // tick yalnız listede TTL'li mesaj varken kurulur
  const tickNow = useExpiryTick(visible.some((m) => m.expiresAt != null));

  useEffect(() => {
    if (stickToBottom.current) bottomRef.current?.scrollIntoView();
  }, [visible.length]);

  // unread divider anchor — read marker frozen at entry (like the community chat)
  const [entryRead, setEntryRead] = useState(() => useUnreadStore.getState().readMap[dmId] ?? 0);
  useEffect(() => {
    setEntryRead(useUnreadStore.getState().readMap[dmId] ?? 0);
  }, [dmId]);
  const dividerId = useMemo(() => visible.find((m) => m.id > entryRead)?.id ?? null, [visible, entryRead]);

  const onScroll = (): void => {
    const el = scrollRef.current;
    if (!el) return;
    stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
  };

  if (!dm && !gdm) {
    return <div className="flex flex-1 items-center justify-center text-sm text-paper-500">{t('dm.notFound')}</div>;
  }
  const title = dm ? dm.peer.nick : (gdm?.name ?? '');
  const sub = dm ? null : gdm!.members.map((m) => m.nick).join(', ');

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-w-0 shrink-0 items-center justify-between gap-1.5 border-b border-night-700 bg-night-900/40 px-3 py-2">
        <div className="flex min-w-0 items-center gap-1.5 overflow-hidden">
          <button
            onClick={showDmHome}
            className="shrink-0 rounded p-0.5 text-paper-500 transition-colors hover:text-paper-100"
            title={t('dm.back')}
            aria-label={t('dm.back')}
          >
            <ChevronLeft size={17} />
          </button>
          <span className="truncate font-display text-base font-semibold uppercase tracking-[0.06em] text-paper-50" title={sub ?? undefined}>
            {dm ? `@ ${title}` : <span className="inline-flex items-center gap-1.5"><Users size={15} className="shrink-0 text-brass-500" />{title}</span>}
          </span>
          <span className="sealed-band hidden sm:inline-flex shrink-0">
            <ShieldCheck size={11} />
            {t('dm.sealed')}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {gdm && (
            <>
              <button
                onClick={() => setAdding(true)}
                className="btn-ghost !px-2 !py-1 !text-xs"
                title={t('dm.addMember')}
              >
                <UserPlus size={13} />
                <span className="hidden xl:inline">{t('dm.addMemberLabel')}</span>
              </button>
              <button
                onClick={() => setShowLeave(true)}
                className="btn-ghost !px-2 !py-1 !text-xs hover:!border-stamp-500/70 hover:!text-stamp-400"
                title={t('dm.leaveTitle')}
              >
                <LogOut size={13} />
                <span className="hidden xl:inline">{t('dm.leave')}</span>
              </button>
            </>
          )}
          {dm && (
            <>
              {callChannelId !== dmId && (
                <>
                  <button
                    onClick={() => void startDmCall(dmId, false).catch(() => {})}
                    disabled={callLocked}
                    className="btn-ghost !px-2 !py-1 !text-xs"
                    title={callLocked && callChannelId === dmId ? t('dm.voiceCallActive') : t('dm.voiceCall')}
                  >
                    <Phone size={13} />
                    <span className="hidden 2xl:inline">ara</span>
                  </button>
                  <button
                    onClick={() => void startDmCall(dmId, true).catch(() => {})}
                    disabled={callLocked}
                    className="btn-ghost !px-2 !py-1 !text-xs"
                    title={callLocked && callChannelId === dmId ? t('dm.videoCallActive') : t('dm.videoCall')}
                  >
                    <Video size={13} />
                    <span className="hidden 2xl:inline">görüntülü</span>
                  </button>
                </>
              )}
              <button
                onClick={() => setSafety(true)}
                className="btn-ghost !px-2 !py-1 !text-xs"
                title={t('dm.safety')}
              >
                <Fingerprint size={13} />
                <span className="hidden xl:inline">{t('dm.safetyLabel')}</span>
              </button>
            </>
          )}
        </div>
      </div>
      {sub && <div className="truncate border-b border-night-700/60 px-4 py-1 text-[11px] text-paper-500">{sub}</div>}
      {dm && peerInCall && !callLocked && (
        // Discord green-ring: karşı taraf odada bekliyor — tek tuşla katıl
        <div className="flex items-center gap-2 border-b border-emerald-700/40 bg-emerald-500/10 px-4 py-1.5">
          <span className="relative flex h-2 w-2 shrink-0" aria-hidden>
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
          </span>
          <span className="min-w-0 flex-1 truncate text-xs font-semibold text-emerald-300">
            {t('dm.peerInCall', { nick: dm.peer.nick })}
          </span>
          <button
            onClick={() => void startDmCall(dmId, true).catch(() => {})}
            className="btn-lamp !py-1 !text-xs"
            title={t('dm.joinCall')}
          >
            <Phone size={12} className="inline" />
            <span className="ml-1">{t('dm.joinCall')}</span>
          </button>
        </div>
      )}
      <div ref={scrollRef} onScroll={onScroll} className="flex-1 overflow-y-auto py-2">
        {hasMore && (
          <div className="flex justify-center py-2">
            <button onClick={() => void loadOlder(dmId)} className="btn-ghost !py-1 !text-xs">
              {t('dm.loadOlder')}
            </button>
          </div>
        )}
        {visible.length === 0 && (
          <div className="flex h-full items-center justify-center text-sm text-paper-500">
            {dm ? t('dm.emptyDm', { name: dm.peer.nick }) : t('dm.emptyGdm')}
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
                  <span className="plate !text-[10px] !tracking-[0.14em] text-brass-400">{t('dm.newDivider')}</span>
                  <div className="h-px flex-1 bg-brass-500" aria-hidden />
                </div>
              )}
              {m.deleted || isExpired(m.expiresAt, tickNow) ? (
                <DeletedRow nick={m.nick} sentAt={m.sentAt} expired={!m.deleted} />
              ) : (
                <div className="group relative">
                  <MessageRow
                    m={m}
                    prev={prev}
                    replyBody={m.replyTo ? (visible.find((x) => x.id === m.replyTo!.id)?.body ?? null) : undefined}
                    onToggleReaction={(emoji, mine) => void toggleReaction(dmId, m.id, emoji, mine).catch(() => {})}
                    canDeleteAll={amSender(m) || (!dm && gdm?.creator_id === useAuthStore.getState().user?.id)}
                    onReply={() => setReply({ id: m.id, nick: m.nick, body: m.body })}
                    onReact={(emoji) =>
                      void toggleReaction(dmId, m.id, emoji, !!m.reactions.find((r) => r.emoji === emoji)?.me).catch(
                        () => {},
                      )
                    }
                    onDeleteForMe={() => hideForMe(dmId, m.id)}
                    onDeleteAll={() => void deleteForEveryone(dmId, m.id).catch(() => {})}
                  />
                  <HoverActions
                    // delete-for-everyone is the sender's call (dm + gdm same
                    // rule; gdm creator may also moderate)
                    canDeleteAll={amSender(m) || (!dm && gdm?.creator_id === useAuthStore.getState().user?.id)}
                    onReply={() => setReply({ id: m.id, nick: m.nick, body: m.body })}
                    onReact={(emoji) =>
                      void toggleReaction(dmId, m.id, emoji, !!m.reactions.find((r) => r.emoji === emoji)?.me).catch(
                        () => {},
                      )
                    }
                    onDeleteAll={() => void deleteForEveryone(dmId, m.id).catch(() => {})}
                    onDeleteForMe={() => hideForMe(dmId, m.id)}
                  />
                </div>
              )}
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>
      {reply && <ReplyBar nick={reply.nick} body={reply.body} onCancel={() => setReply(null)} />}
      <TypingLine channelId={dmId} />
      <Composer
        channelId={dmId}
        send={(body) => {
          const target = reply;
          setReply(null);
          return send(dmId, body, target?.id);
        }}
        sending={sending}
        onTyping={() => wsSend({ type: 'typing', channel_id: dmId })}
        placeholder={
          reply
            ? t('dm.placeholderReply', { name: reply.nick })
            : dm
              ? t('dm.placeholderDm', { name: dm.peer.nick })
              : t('dm.placeholderGdm', { name: gdm!.name })
        }
      />
      {adding && gdm && <AddMemberModal gdmId={gdm.id} onClose={() => setAdding(false)} />}
      {safety && dm && (
        <SafetyModal peerId={dm.peer.id} peerNick={dm.peer.nick} onClose={() => setSafety(false)} />
      )}
      {showLeave && gdm && (
        <ConfirmDialog
          title={t('leaveGdm.title')}
          message={t('leaveGdm.message', { name: gdm.name })}
          danger
          confirmLabel={t('leaveGdm.confirm')}
          onConfirm={() => {
            void leaveGdm(gdm.id)
              .then(() => showDmHome())
              .catch(() => {});
          }}
          onCancel={() => setShowLeave(false)}
        />
      )}
    </div>
  );
}
