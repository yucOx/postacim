import { useState } from 'react';
import { Check, Plus, X } from 'lucide-react';
import { useAppStore } from '../state/appStore';
import { useDmChatStore } from '../state/dmChatStore';
import { unreadCount, useUnreadStore } from '../state/unreadStore';
import { formatTime, nickColor } from '../lib/format';
import ConfirmDialog from './ConfirmDialog';
import Modal from './Modal';

function NewGroupModal({ onClose }: { onClose: () => void }) {
  const friends = useAppStore((s) => s.friends);
  const createGroupDm = useAppStore((s) => s.createGroupDm);
  const [name, setName] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = (id: string): void => {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const submit = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await createGroupDm(name.trim(), [...picked]);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'hata');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Grup kur" onClose={onClose}>
      <div className="flex w-80 flex-col gap-3">
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="grup adı"
          maxLength={64}
          className="input"
        />
        <div className="max-h-56 overflow-y-auto">
          {friends.length === 0 && <p className="text-sm text-paper-500">arkadaşın yok</p>}
          {friends.map((f) => (
            <label key={f.id} className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 hover:bg-night-800">
              <input type="checkbox" checked={picked.has(f.id)} onChange={() => toggle(f.id)} className="accent-lamp-500" />
              <span className="text-sm text-paper-300">{f.nick}</span>
            </label>
          ))}
        </div>
        {error && <p className="text-sm text-stamp-400">{error}</p>}
        <button
          onClick={() => void submit()}
          disabled={busy || !name.trim() || picked.size === 0}
          className="btn-lamp"
        >
          {busy ? 'kuruluyor…' : `grubu kur (${picked.size})`}
        </button>
        <p className="text-[11px] text-paper-500">üye eklenen/ayrılan gruplarda anahtar yenilenir</p>
      </div>
    </Modal>
  );
}

export default function DmHome() {
  const friends = useAppStore((s) => s.friends);
  const incoming = useAppStore((s) => s.friendIncoming);
  const outgoing = useAppStore((s) => s.friendOutgoing);
  const dms = useAppStore((s) => s.dms);
  const gdms = useAppStore((s) => s.gdms);
  const activeDmId = useAppStore((s) => s.activeDmId);
  const openDm = useAppStore((s) => s.openDm);
  const openDmChat = useAppStore((s) => s.openDmChat);
  const sendFriendRequest = useAppStore((s) => s.sendFriendRequest);
  const acceptFriend = useAppStore((s) => s.acceptFriend);
  const declineFriend = useAppStore((s) => s.declineFriend);
  const unfriend = useAppStore((s) => s.unfriend);
  const dmMessages = useDmChatStore((s) => s.messages);
  useUnreadStore((s) => s.readMap);
  const [nick, setNick] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [newGroup, setNewGroup] = useState(false);
  const [unfriendNick, setUnfriendNick] = useState<string | null>(null);

  const submit = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      await sendFriendRequest(nick.trim());
      setMsg(`${nick} için istek gönderildi`);
      setNick('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'hata');
    } finally {
      setBusy(false);
    }
  };

  const avatar = (label: string, id: string): React.ReactNode => (
    <div
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-sm border border-brass-700/40 bg-night-800 font-display text-sm font-bold"
      style={{ color: nickColor(label) }}
      aria-hidden
    >
      {label[0]?.toLocaleUpperCase('tr-TR')}
    </div>
  );

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-lg flex-col gap-7 p-6">
        <div className="border-b border-night-700 pb-4">
          <h1 className="font-display text-2xl font-bold uppercase tracking-[0.1em] text-paper-50">
            Özel Yükler
          </h1>
          <p className="mt-1 text-xs text-paper-500">
            DM'ler yalnız arkadaşlarınla — uçtan uca mühürlü, sunucu göremez
          </p>
        </div>

        <section>
          <h2 className="plate mb-2">ARKADAŞ EKLE</h2>
          <div className="flex gap-2">
            <input
              value={nick}
              onChange={(e) => setNick(e.target.value)}
              onKeyDown={(e) => nick.trim() && e.key === 'Enter' && void submit()}
              placeholder="nick"
              maxLength={24}
              className="input flex-1"
            />
            <button onClick={() => void submit()} disabled={busy || !nick.trim()} className="btn-lamp shrink-0">
              istek gönder
            </button>
          </div>
          {msg && <p className="mt-1.5 text-sm text-lamp-300">{msg}</p>}
          {error && <p className="mt-1.5 text-sm text-stamp-400">{error}</p>}
        </section>

        {incoming.length > 0 && (
          <section>
            <h2 className="plate mb-2">GELEN İSTEKLER</h2>
            {incoming.map((f) => (
              <div key={f.id} className="flex items-center gap-2 py-1">
                {avatar(f.nick, f.id)}
                <span className="flex-1 truncate text-sm text-paper-100">{f.nick}</span>
                <button onClick={() => void acceptFriend(f.id)} className="btn-ghost !text-xs" title="kabul et">
                  <Check size={13} />
                  kabul
                </button>
                <button
                  onClick={() => void declineFriend(f.id)}
                  className="btn-ghost !text-xs hover:!border-stamp-500/70 hover:!text-stamp-400"
                  title="reddet"
                >
                  <X size={13} />
                  red
                </button>
              </div>
            ))}
          </section>
        )}

        {outgoing.length > 0 && (
          <section>
            <h2 className="plate mb-2">GÖNDERİLEN İSTEKLER</h2>
            {outgoing.map((f) => (
              <div key={f.id} className="py-1 text-sm text-paper-500">
                {f.nick} <span className="text-xs">— bekliyor</span>
              </div>
            ))}
          </section>
        )}

        <section>
          <div className="mb-2 flex items-center justify-between">
            <h2 className="plate">KONUŞMALAR</h2>
            <button
              onClick={() => setNewGroup(true)}
              className="btn-ghost !py-0.5 !text-xs"
              title="grup DM kur"
            >
              <Plus size={12} />
              grup
            </button>
          </div>
          {dms.length === 0 && gdms.length === 0 && (
            <p className="text-sm text-paper-500">henüz konuşma yok</p>
          )}
          {gdms.map((g) => {
            const unread = unreadCount(g.id, dmMessages[g.id]);
            return (
              <button
                key={g.id}
                onClick={() => openDmChat(g.id)}
                className={`flex w-full items-center gap-2 rounded px-1 py-1.5 text-left transition-colors hover:bg-night-800 ${
                  g.id === activeDmId ? 'bg-night-800' : ''
                }`}
              >
                {avatar(g.name, g.id)}
                <span className={`flex-1 truncate text-sm ${unread > 0 ? 'font-semibold text-paper-50' : 'text-paper-300'}`}>
                  {g.name}
                  <span className="ml-1 text-[10px] text-paper-500">{g.members.length} kişi</span>
                </span>
                {g.last_message_at && (
                  <span className="font-mono text-[10px] text-paper-500">{formatTime(g.last_message_at)}</span>
                )}
                {unread > 0 && (
                  <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-lamp-500 px-1 font-display text-[9px] font-bold text-night-950">
                    {unread > 99 ? '99+' : unread}
                  </span>
                )}
              </button>
            );
          })}
          {dms.map((d) => {
            const unread = unreadCount(d.id, dmMessages[d.id]);
            return (
              <button
                key={d.id}
                onClick={() => openDmChat(d.id)}
                className={`flex w-full items-center gap-2 rounded px-1 py-1.5 text-left transition-colors hover:bg-night-800 ${
                  d.id === activeDmId ? 'bg-night-800' : ''
                }`}
              >
                {avatar(d.peer.nick, d.id)}
                <span className={`flex-1 truncate text-sm ${unread > 0 ? 'font-semibold text-paper-50' : 'text-paper-300'}`}>
                  {d.peer.nick}
                </span>
                {d.last_message_at && (
                  <span className="font-mono text-[10px] text-paper-500">{formatTime(d.last_message_at)}</span>
                )}
                {unread > 0 && (
                  <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-lamp-500 px-1 font-display text-[9px] font-bold text-night-950">
                    {unread > 99 ? '99+' : unread}
                  </span>
                )}
              </button>
            );
          })}
        </section>

        <section>
          <h2 className="plate mb-2">ARKADAŞLAR</h2>
          {friends.length === 0 && <p className="text-sm text-paper-500">henüz arkadaş yok</p>}
          {friends.map((f) => (
            <div key={f.id} className="group flex items-center gap-2 rounded px-1 py-1.5 hover:bg-night-800">
              {avatar(f.nick, f.id)}
              <span className="flex-1 truncate text-sm text-paper-300">{f.nick}</span>
              <button
                onClick={() => void openDm(f.id)}
                className="btn-ghost !py-0.5 !text-xs opacity-0 transition-opacity group-hover:opacity-100"
              >
                mesaj
              </button>
              <button
                onClick={() => setUnfriendNick(f.nick)}
                className="rounded p-1 text-paper-700 opacity-0 transition-opacity hover:text-stamp-400 group-hover:opacity-100"
                title="arkadaşlıktan çıkar"
                aria-label={`${f.nick} arkadaşlıktan çıkar`}
              >
                <X size={13} />
              </button>
            </div>
          ))}
        </section>
      </div>

      {newGroup && <NewGroupModal onClose={() => setNewGroup(false)} />}
      {unfriendNick && (
        <ConfirmDialog
          title="Arkadaşlıktan çıkar"
          message={`${unfriendNick} arkadaşlıktan çıkarılsın mı? DM geçmişi okunur kalır, yeni mesaj gönderilemez.`}
          danger
          confirmLabel="çıkar"
          onConfirm={() => {
            const f = friends.find((x) => x.nick === unfriendNick);
            if (f) void unfriend(f.id).catch(() => {});
          }}
          onCancel={() => setUnfriendNick(null)}
        />
      )}
    </div>
  );
}
