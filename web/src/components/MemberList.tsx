import { useState } from 'react';
import { useAppStore } from '../state/appStore';
import { useAuthStore } from '../state/authStore';
import ConfirmDialog from './ConfirmDialog';
import Modal from './Modal';
import { toast } from './Toast';

export default function MemberList() {
  const community = useAppStore((s) => s.communities.find((c) => c.id === s.activeCommunityId));
  const addMember = useAppStore((s) => s.addMember);
  const removeMember = useAppStore((s) => s.removeMember);
  const banMember = useAppStore((s) => s.banMember);
  const setRole = useAppStore((s) => s.setRole);
  const me = useAuthStore((s) => s.user);
  const [adding, setAdding] = useState(false);
  const [nick, setNick] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!community) return <div className="w-56 shrink-0 border-l border-neutral-800/60 bg-neutral-900/40" />;

  const myRole = community.role;
  const isOwner = myRole === 'owner';
  const isStaff = isOwner || myRole === 'admin';

  const submit = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await addMember(community.id, nick.trim());
      setAdding(false);
      setNick('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'hata');
    } finally {
      setBusy(false);
    }
  };

  const [pendingAct, setPendingAct] = useState<{ fn: () => Promise<void>; text: string } | null>(null);
  const runAct = async (fn: () => Promise<void>): Promise<void> => {
    try {
      await fn();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'işlem başarısız');
    } finally {
      setPendingAct(null);
    }
  };
  const act = (fn: () => Promise<void>, confirmText?: string): void => {
    if (confirmText) {
      setPendingAct({ fn, text: confirmText });
      return;
    }
    void runAct(fn);
  };

  return (
    <div className="flex w-56 shrink-0 flex-col border-l border-neutral-800/60 bg-neutral-900/40">
      <div className="flex items-center justify-between border-b border-neutral-800/60 px-4 py-3 text-[11px] font-semibold tracking-wide text-neutral-500">
        ÜYELER — {community.members.length}
        {isStaff && (
          <button onClick={() => setAdding(true)} className="text-neutral-400 hover:text-neutral-200" title="üye ekle">
            +
          </button>
        )}
      </div>
      <div className="flex-1 overflow-y-auto p-2">
        {community.members.map((m) => {
          const canActOn =
            isStaff && m.id !== me?.id && m.role !== 'owner' && !(myRole === 'admin' && m.role === 'admin');
          return (
            <div key={m.id} className="group flex items-center gap-2 rounded px-2 py-1.5 hover:bg-neutral-800/60">
              <div className="flex h-7 w-7 items-center justify-center rounded-full bg-indigo-900/60 text-xs font-bold text-indigo-300">
                {m.nick[0]?.toUpperCase()}
              </div>
              <span className={`flex-1 truncate text-sm ${m.id === me?.id ? 'text-neutral-200' : 'text-neutral-400'}`}>
                {m.nick}
              </span>
              {m.role === 'owner' && <span className="text-[10px] text-amber-500">sahip</span>}
              {m.role === 'admin' && <span className="text-[10px] text-sky-400">admin</span>}
              {canActOn && (
                <div className="hidden items-center gap-1 group-hover:flex">
                  {isOwner && (
                    <button
                      onClick={() => void act(() => setRole(community.id, m.id, m.role === 'member'))}
                      className="text-[10px] text-neutral-500 hover:text-sky-400"
                      title={m.role === 'member' ? 'admin yap' : 'admin kaldır'}
                    >
                      {m.role === 'member' ? '⭐' : '☆'}
                    </button>
                  )}
                  <button
                    onClick={() => void act(() => banMember(community.id, m.id), `${m.nick} atılıp BANLANSIN mı? Odalar yeni anahtara döner.`)}
                    className="text-[10px] text-neutral-500 hover:text-red-400"
                    title="çıkar + banla"
                  >
                    🚫
                  </button>
                  <button
                    onClick={() => void act(() => removeMember(community.id, m.id), `${m.nick} çıkarılsın mı? Odalar yeni anahtara döner.`)}
                    className="text-xs text-neutral-500 hover:text-red-400"
                    title="çıkar"
                  >
                    ✕
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {adding && (
        <Modal title="Üye ekle" onClose={() => setAdding(false)}>
          <div className="flex flex-col gap-3">
            <input
              autoFocus
              value={nick}
              onChange={(e) => setNick(e.target.value)}
              onKeyDown={(e) => nick.trim() && e.key === 'Enter' && void submit()}
              placeholder="nick"
              maxLength={24}
              className="rounded-md border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm outline-none focus:border-neutral-500"
            />
            <p className="text-xs text-neutral-500">
              Kanal anahtarları onun anahtarına sarılır; sunucu yalnızca sarılı kutuları görür.
            </p>
            {error && <p className="text-sm text-red-400">{error}</p>}
            <button
              onClick={() => void submit()}
              disabled={busy || !nick.trim()}
              className="rounded-md bg-indigo-600 py-2 text-sm font-medium hover:bg-indigo-500 disabled:opacity-50"
            >
              {busy ? 'ekleniyor…' : 'ekle'}
            </button>
          </div>
        </Modal>
      )}
      {pendingAct && (
        <ConfirmDialog
          title="Emin misin?"
          message={pendingAct.text}
          danger
          confirmLabel="evet, devam"
          onConfirm={() => void runAct(pendingAct.fn)}
          onCancel={() => setPendingAct(null)}
        />
      )}
    </div>
  );
}
