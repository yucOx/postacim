import { useEffect, useRef, useState } from 'react';
import { useAppStore } from '../state/appStore';
import { useDmChatStore } from '../state/dmChatStore';
import { useUnreadStore } from '../state/unreadStore';
import { useVoiceStore } from '../state/voiceStore';
import { formatDay, sameDay } from '../lib/format';
import ConfirmDialog from './ConfirmDialog';
import MessageRow from './MessageRow';
import Composer from './Composer';
import Modal from './Modal';

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
        {candidates.length === 0 && (
          <p className="text-sm text-neutral-500">ekleyebileceğin arkadaş kalmadı</p>
        )}
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
            className="flex items-center justify-between rounded px-2 py-1.5 text-left text-sm text-neutral-300 hover:bg-neutral-800 disabled:opacity-50"
          >
            {f.nick}
            <span className="text-xs text-indigo-400">ekle</span>
          </button>
        ))}
        {error && <p className="text-sm text-red-400">{error}</p>}
        <p className="text-[11px] text-neutral-600">ekleme, grup anahtarını yeniler</p>
      </div>
    </Modal>
  );
}

export default function DmChat({ dmId }: { dmId: string }) {
  const dm = useAppStore((s) => s.dms.find((d) => d.id === dmId));
  const gdm = useAppStore((s) => s.gdms.find((g) => g.id === dmId));
  const showDmHome = useAppStore((s) => s.showDmHome);
  const leaveGdm = useAppStore((s) => s.leaveGdm);
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
  const [adding, setAdding] = useState(false);
  const [showLeave, setShowLeave] = useState(false);

  useEffect(() => {
    void loadHistory(dmId);
  }, [dmId, loadHistory]);

  // active DM is read as messages arrive
  const markRead = useUnreadStore((s) => s.markRead);
  const lastId = messages.length ? messages[messages.length - 1]!.id : 0;
  useEffect(() => {
    if (lastId) markRead(dmId, lastId);
  }, [dmId, lastId, markRead]);

  useEffect(() => {
    if (stickToBottom.current) bottomRef.current?.scrollIntoView();
  }, [messages.length]);

  const onScroll = (): void => {
    const el = scrollRef.current;
    if (!el) return;
    stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
  };

  if (!dm && !gdm) {
    return <div className="flex flex-1 items-center justify-center text-sm text-neutral-600">DM bulunamadı</div>;
  }
  const title = dm ? `@ ${dm.peer.nick}` : `👥 ${gdm!.name}`;
  const sub = dm ? null : gdm!.members.map((m) => m.nick).join(', ');

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b border-neutral-800/60 px-4 py-2 text-sm font-semibold text-neutral-300">
        <button onClick={showDmHome} className="text-neutral-500 hover:text-neutral-200" title="geri">
          ‹
        </button>
        <span className="truncate" title={sub ?? undefined}>{title}</span>
        <span className="text-[11px] font-normal text-emerald-500/80">uçtan uca şifreli</span>
        {gdm && (
          <>
            <button
              onClick={() => setAdding(true)}
              className="ml-auto rounded-full border border-neutral-700 px-2 py-0.5 text-xs text-neutral-300 hover:bg-neutral-800"
            >
              + üye
            </button>
            <button
              onClick={() => setShowLeave(true)}
              className="rounded-full border border-neutral-700 px-2 py-0.5 text-xs text-neutral-400 hover:bg-neutral-800 hover:text-red-400"
            >
              ayrıl
            </button>
          </>
        )}
        {dm && (
          <button
            onClick={() => void startDmCall(dmId).catch(() => {})}
            disabled={callChannelId !== null}
            className="ml-auto rounded-full border border-neutral-700 px-3 py-1 text-xs text-neutral-300 hover:bg-neutral-800 disabled:opacity-40"
            title="şifreli sesli/görüntülü ara"
          >
            📞 ara
          </button>
        )}
      </div>
      {sub && <div className="truncate border-b border-neutral-800/40 px-4 py-1 text-[11px] text-neutral-500">{sub}</div>}
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
            {dm ? `${dm.peer.nick} ile ilk şifreli mesajı sen yaz` : 'grupta ilk şifreli mesajı sen yaz'}
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
        placeholder={dm ? `@${dm.peer.nick} — şifreli mesaj… (Enter: gönder)` : `${gdm!.name} — şifreli mesaj… (Enter: gönder)`}
      />
      {adding && gdm && <AddMemberModal gdmId={gdm.id} onClose={() => setAdding(false)} />}
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
