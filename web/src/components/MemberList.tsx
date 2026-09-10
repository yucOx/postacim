import { useState } from 'react';
import { Ban, Crown, Star, UserPlus, X } from 'lucide-react';
import { useAppStore } from '../state/appStore';
import { useAuthStore } from '../state/authStore';
import { nickColor } from '../lib/format';
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
  // hooks stay above the early return — community can disappear mid-session
  const [pendingAct, setPendingAct] = useState<{ fn: () => Promise<void>; text: string } | null>(null);

  if (!community) return <div className="w-56 shrink-0 border-l border-night-700 bg-night-900/50" />;

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
    <div className="flex w-56 shrink-0 flex-col border-l border-night-700 bg-night-900/50">
      <div className="plate flex items-center justify-between border-b border-night-700 px-4 py-3">
        MANİFO — {community.members.length}
        {isStaff && (
          <button
            onClick={() => setAdding(true)}
            className="rounded p-0.5 text-paper-500 transition-colors hover:text-paper-100"
            title="üye ekle"
            aria-label="üye ekle"
          >
            <UserPlus size={13} />
          </button>
        )}
      </div>
      <div className="flex-1 overflow-y-auto p-2">
        {community.members.map((m) => {
          const canActOn =
            isStaff && m.id !== me?.id && m.role !== 'owner' && !(myRole === 'admin' && m.role === 'admin');
          return (
            <div key={m.id} className="group flex items-center gap-2 rounded px-2 py-1.5 hover:bg-night-800">
              <div
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-sm border border-brass-700/40 bg-night-800 font-display text-xs font-bold"
                style={{ color: nickColor(m.nick) }}
                aria-hidden
              >
                {m.nick[0]?.toLocaleUpperCase('tr-TR')}
              </div>
              <span className={`flex-1 truncate text-sm ${m.id === me?.id ? 'text-paper-100' : 'text-paper-300'}`}>
                {m.nick}
              </span>
              {m.role === 'owner' && <Crown size={12} className="shrink-0 text-lamp-500" aria-label="sahip" />}
              {m.role === 'admin' && <Star size={11} className="shrink-0 text-brass-400" aria-label="admin" />}
              {canActOn && (
                <div className="hidden items-center gap-0.5 group-hover:flex">
                  {isOwner && (
                    <button
                      onClick={() => void act(() => setRole(community.id, m.id, m.role === 'member'))}
                      className="rounded p-0.5 text-paper-500 transition-colors hover:text-brass-400"
                      title={m.role === 'member' ? 'admin yap' : 'adminliği kaldır'}
                    >
                      <Star size={11} />
                    </button>
                  )}
                  <button
                    onClick={() => void act(() => banMember(community.id, m.id), `${m.nick} atılıp BANLANSIN mı? Odalar yeni anahtara döner.`)}
                    className="rounded p-0.5 text-paper-500 transition-colors hover:text-stamp-400"
                    title="çıkar + banla"
                  >
                    <Ban size={11} />
                  </button>
                  <button
                    onClick={() => void act(() => removeMember(community.id, m.id), `${m.nick} çıkarılsın mı? Odalar yeni anahtara döner.`)}
                    className="rounded p-0.5 text-paper-500 transition-colors hover:text-stamp-400"
                    title="çıkar"
                  >
                    <X size={12} />
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
              className="input"
            />
            <p className="text-xs text-paper-500">
              Kanal anahtarları onun anahtarına sarılır; sunucu yalnızca sarılı kutuları görür.
            </p>
            {error && <p className="text-sm text-stamp-400">{error}</p>}
            <button onClick={() => void submit()} disabled={busy || !nick.trim()} className="btn-lamp">
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
