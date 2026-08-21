import { useState } from 'react';
import { useAppStore } from '../state/appStore';

export default function DmHome() {
  const friends = useAppStore((s) => s.friends);
  const incoming = useAppStore((s) => s.friendIncoming);
  const outgoing = useAppStore((s) => s.friendOutgoing);
  const dms = useAppStore((s) => s.dms);
  const openDm = useAppStore((s) => s.openDm);
  const sendFriendRequest = useAppStore((s) => s.sendFriendRequest);
  const acceptFriend = useAppStore((s) => s.acceptFriend);
  const declineFriend = useAppStore((s) => s.declineFriend);
  const unfriend = useAppStore((s) => s.unfriend);
  const [nick, setNick] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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

  const dmNick = (dmId: string): string => dms.find((d) => d.id === dmId)?.peer.nick ?? '';

  return (
    <div className="flex h-full flex-col overflow-y-auto p-6">
      <h1 className="text-lg font-semibold">Özel Mesajlar</h1>
      <p className="mt-1 text-xs text-neutral-500">
        DM'ler yalnız arkadaşlarınla — uçtan uca şifreli, sunucu göremez
      </p>

      <div className="mt-6 max-w-md">
        <h2 className="mb-2 text-[11px] font-semibold tracking-wide text-neutral-500">ARKADAŞ EKLE</h2>
        <div className="flex gap-2">
          <input
            value={nick}
            onChange={(e) => setNick(e.target.value)}
            onKeyDown={(e) => nick.trim() && e.key === 'Enter' && void submit()}
            placeholder="nick"
            maxLength={24}
            className="flex-1 rounded-md border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm outline-none focus:border-neutral-500"
          />
          <button
            onClick={() => void submit()}
            disabled={busy || !nick.trim()}
            className="rounded-md bg-indigo-600 px-4 text-sm font-medium hover:bg-indigo-500 disabled:opacity-50"
          >
            istek gönder
          </button>
        </div>
        {msg && <p className="mt-1 text-sm text-emerald-400">{msg}</p>}
        {error && <p className="mt-1 text-sm text-red-400">{error}</p>}
      </div>

      {incoming.length > 0 && (
        <div className="mt-6 max-w-md">
          <h2 className="mb-2 text-[11px] font-semibold tracking-wide text-neutral-500">GELEN İSTEKLER</h2>
          {incoming.map((f) => (
            <div key={f.id} className="flex items-center gap-2 py-1">
              <span className="flex-1 truncate text-sm text-neutral-300">{f.nick}</span>
              <button onClick={() => void acceptFriend(f.id)} className="rounded bg-emerald-700 px-2 py-0.5 text-xs hover:bg-emerald-600">
                kabul
              </button>
              <button onClick={() => void declineFriend(f.id)} className="rounded border border-neutral-700 px-2 py-0.5 text-xs text-neutral-400 hover:bg-neutral-800">
                red
              </button>
            </div>
          ))}
        </div>
      )}

      {outgoing.length > 0 && (
        <div className="mt-6 max-w-md">
          <h2 className="mb-2 text-[11px] font-semibold tracking-wide text-neutral-500">GÖNDERİLEN İSTEKLER</h2>
          {outgoing.map((f) => (
            <div key={f.id} className="py-1 text-sm text-neutral-500">
              {f.nick} <span className="text-xs">— bekliyor</span>
            </div>
          ))}
        </div>
      )}

      <div className="mt-6 max-w-md">
        <h2 className="mb-2 text-[11px] font-semibold tracking-wide text-neutral-500">ARKADAŞLAR</h2>
        {friends.length === 0 && <p className="text-sm text-neutral-500">henüz arkadaş yok</p>}        {friends.map((f) => (
          <div key={f.id} className="group flex items-center gap-2 rounded px-1 py-1.5 hover:bg-neutral-800/60">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-indigo-900/60 text-sm font-bold text-indigo-300">
              {f.nick[0]?.toUpperCase()}
            </div>
            <span className="flex-1 truncate text-sm text-neutral-300">{f.nick}</span>
            <button
              onClick={() => void openDm(f.id)}
              className="rounded border border-neutral-700 px-2 py-0.5 text-xs text-neutral-400 hover:bg-neutral-700 group-hover:inline"
            >
              mesaj
            </button>
            <button
              onClick={() => confirm(`${f.nick} arkadaşlıktan çıkarılsın mı?`) && void unfriend(f.id)}
              className="text-xs text-neutral-600 hover:text-red-400 group-hover:inline"
              title="arkadaşlıktan çıkar"
            >
              ✕
            </button>
          </div>
        ))}
        {dms.length > 0 && (
          <p className="mt-2 text-[11px] text-neutral-600">
            açık DM'lar: {dms.map((d) => dmNick(d.id)).join(', ')}
          </p>
        )}
      </div>
    </div>
  );
}
