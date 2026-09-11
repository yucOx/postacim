import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, Fingerprint, LogOut, Phone, UserPlus, Users, Video } from 'lucide-react';
import { useAppStore } from '../state/appStore';
import { useDmChatStore, type DmDisplayMessage } from '../state/dmChatStore';
import { amSender } from '../state/chatStore';
import { useHiddenStore, NO_HIDDEN } from '../state/hiddenStore';
import { useUnreadStore } from '../state/unreadStore';
import { useVoiceStore } from '../state/voiceStore';
import { formatDay, sameDay } from '../lib/format';
import ConfirmDialog from './ConfirmDialog';
import MessageRow from './MessageRow';
import { deleteForEveryone, DeletedRow, HoverActions } from './MsgDelete';
import Composer from './Composer';
import Modal from './Modal';
import SafetyModal from './SafetyModal';
import { ShieldCheck } from 'lucide-react';

// stable ref: `?? []` in a zustand selector recreates it each call and loops React 19 (#185)
const NO_MESSAGES: DmDisplayMessage[] = [];

function AddMemberModal({ gdmId, onClose }: { gdmId: string; onClose: () => void }) {
  const friends = useAppStore((s) => s.friends);
  const gdm = useAppStore((s) => s.gdms.find((g) => g.id === gdmId));
  const addGdmMember = useAppStore((s) => s.addGdmMember);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const candidates = friends.filter((f) => !gdm?.members.some((m) => m.id === f.id));

  return (
    <Modal title="Üye ekle" onClose={onClose}>
      <div className="flex w-72 flex-col gap-2">
        {candidates.length === 0 && <p className="text-sm text-paper-500">ekleyebileceğin arkadaş kalmadı</p>}
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
                setError(err instanceof Error ? err.message : 'hata');
              } finally {
                setBusy(false);
              }
            }}
            className="flex items-center justify-between rounded px-2 py-1.5 text-left text-sm text-paper-300 transition-colors hover:bg-night-800"
          >
            {f.nick}
            <span className="text-xs text-lamp-500">ekle</span>
          </button>
        ))}
        {error && <p className="text-sm text-stamp-400">{error}</p>}
        <p className="text-[11px] text-paper-500">ekleme, grup anahtarını yeniler</p>
      </div>
    </Modal>
  );
}

export default function DmChat({ dmId }: { dmId: string }) {
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
  const startDmCall = useVoiceStore((s) => s.startDmCall);
  const callPhase = useVoiceStore((s) => s.callState?.phase ?? null);
  const callChannelId = useVoiceStore((s) => s.callState?.channelId ?? null);
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

  useEffect(() => {
    if (stickToBottom.current) bottomRef.current?.scrollIntoView();
  }, [visible.length]);

  const onScroll = (): void => {
    const el = scrollRef.current;
    if (!el) return;
    stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
  };

  if (!dm && !gdm) {
    return <div className="flex flex-1 items-center justify-center text-sm text-paper-500">DM bulunamadı</div>;
  }
  const title = dm ? dm.peer.nick : (gdm?.name ?? '');
  const sub = dm ? null : gdm!.members.map((m) => m.nick).join(', ');

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b border-night-700 bg-night-900/40 px-4 py-2.5">
        <button
          onClick={showDmHome}
          className="rounded p-0.5 text-paper-500 transition-colors hover:text-paper-100"
          title="geri"
          aria-label="geri"
        >
          <ChevronLeft size={17} />
        </button>
        <span className="truncate font-display text-lg font-semibold uppercase tracking-[0.06em] text-paper-50" title={sub ?? undefined}>
          {dm ? `@ ${title}` : <span className="inline-flex items-center gap-1.5"><Users size={15} className="text-brass-500" />{title}</span>}
        </span>
        <span className="sealed-band">
          <ShieldCheck size={11} />
          uçtan uca mühürlü
        </span>
        {gdm && (
          <>
            <button
              onClick={() => setAdding(true)}
              className="btn-ghost ml-auto !px-2 !py-1 !text-xs"
              title="üye ekle"
            >
              <UserPlus size={13} />
              üye
            </button>
            <button
              onClick={() => setShowLeave(true)}
              className="btn-ghost !px-2 !py-1 !text-xs hover:!border-stamp-500/70 hover:!text-stamp-400"
              title="gruptan ayrıl"
            >
              <LogOut size={13} />
              ayrıl
            </button>
          </>
        )}
        {dm && (
          <>
            <button
              onClick={() => void startDmCall(dmId, false).catch(() => {})}
              disabled={callLocked}
              className="btn-ghost ml-auto !px-2.5 !py-1 !text-xs"
              title={callLocked && callChannelId === dmId ? 'arama sürüyor' : 'şifreli sesli ara'}
            >
              <Phone size={13} />
              ara
            </button>
            <button
              onClick={() => void startDmCall(dmId, true).catch(() => {})}
              disabled={callLocked}
              className="btn-ghost !px-2.5 !py-1 !text-xs"
              title={callLocked && callChannelId === dmId ? 'arama sürüyor' : 'şifreli görüntülü ara'}
            >
              <Video size={13} />
              görüntülü
            </button>
            <button
              onClick={() => setSafety(true)}
              className="btn-ghost !px-2.5 !py-1 !text-xs"
              title="güvenlik numarası"
            >
              <Fingerprint size={13} />
              güvenlik
            </button>
          </>
        )}
      </div>
      {sub && <div className="truncate border-b border-night-700/60 px-4 py-1 text-[11px] text-paper-500">{sub}</div>}
      <div ref={scrollRef} onScroll={onScroll} className="flex-1 overflow-y-auto py-2">
        {hasMore && (
          <div className="flex justify-center py-2">
            <button onClick={() => void loadOlder(dmId)} className="btn-ghost !py-1 !text-xs">
              daha eski mesajlar
            </button>
          </div>
        )}
        {visible.length === 0 && (
          <div className="flex h-full items-center justify-center text-sm text-paper-500">
            {dm ? `${dm.peer.nick} ile ilk mühürlü zarfı sen bırak` : 'grupta ilk mühürlü zarfı sen bırak'}
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
              {m.deleted ? (
                <DeletedRow nick={m.nick} sentAt={m.sentAt} />
              ) : (
                <div className="group relative">
                  <MessageRow m={m} prev={prev} />
                  <HoverActions
                    // DM: both participants may tombstone; gdm: sender only
                    // (gdm creator is allowed server-side but the client has no creator_id)
                    canDeleteAll={dm ? true : amSender(m)}
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
      <Composer
        send={(body) => send(dmId, body)}
        sending={sending}
        placeholder={dm ? `@${dm.peer.nick} — şifreli mesaj…  (Enter: gönder)` : `${gdm!.name} — şifreli mesaj…  (Enter: gönder)`}
      />
      {adding && gdm && <AddMemberModal gdmId={gdm.id} onClose={() => setAdding(false)} />}
      {safety && dm && (
        <SafetyModal peerId={dm.peer.id} peerNick={dm.peer.nick} onClose={() => setSafety(false)} />
      )}
      {showLeave && gdm && (
        <ConfirmDialog
          title="Gruptan ayrıl"
          message={`'${gdm.name}' grubundan ayrılmak istediğine emin misin? Bu geri alınamaz.`}
          danger
          confirmLabel="ayrıl"
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
