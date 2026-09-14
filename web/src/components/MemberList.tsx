import { useEffect, useState } from 'react';
import { Ban, Crown, Key, Star, UserPlus, X } from 'lucide-react';
import { useAppStore } from '../state/appStore';
import { useAuthStore } from '../state/authStore';
import { ensurePinned } from '../lib/keypins';
import ConfirmDialog from './ConfirmDialog';
import KeyFingerprintModal from './KeyFingerprintModal';
import UserCard from './UserCard';
import Modal from './Modal';
import { toast } from './Toast';
import Avatar from './Avatar';
import { useT } from '../i18n/I18nProvider';

export default function MemberList() {
  const { t } = useT();
  const community = useAppStore((s) => s.communities.find((c) => c.id === s.activeCommunityId));
  const publicKeys = useAppStore((s) => s.publicKeys);
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
  const [fingerprint, setFingerprint] = useState<{ id: string; nick: string; keyB64?: string } | null>(null);
  const [card, setCard] = useState<{ id: string; nick: string } | null>(null);
  const [keyFlagged, setKeyFlagged] = useState<Set<string>>(new Set());

  // TOFU sweep over member keys; bootstrap feeds publicKeys for every member
  useEffect(() => {
    if (!community) return;
    const flagged = new Set<string>();
    for (const m of community.members) {
      const pk = publicKeys[m.id];
      if (pk && ensurePinned(m.id, pk) === 'changed') flagged.add(m.id);
    }
    setKeyFlagged(flagged);
  }, [community, publicKeys]);

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
        {t('members.roster', { n: community.members.length })}
        {isStaff && (
          <button
            onClick={() => setAdding(true)}
            className="rounded p-0.5 text-paper-500 transition-colors hover:text-paper-100"
            title={t('members.addMember')}
            aria-label={t('members.addMember')}
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
              <button
                onClick={() => setCard({ id: m.id, nick: m.nick })}
                className="shrink-0 rounded-sm transition-transform hover:scale-105"
                title={t('members.memberCardTitle', { name: m.nick })}
                aria-label={t('members.memberCard', { name: m.nick })}
              >
                <Avatar userId={m.id} label={m.nick} size={28} />
              </button>
              <span className={`flex-1 truncate text-sm ${m.id === me?.id ? 'text-paper-100' : 'text-paper-300'}`}>
                {m.nick}
              </span>
              {m.role === 'owner' && <Crown size={12} className="shrink-0 text-lamp-500" aria-label={t('members.roleOwner')} />}
              {m.role === 'admin' && <Star size={11} className="shrink-0 text-brass-400" aria-label={t('members.roleAdmin')} />}
              {m.id !== me?.id && (
                <button
                  onClick={() => setFingerprint({ id: m.id, nick: m.nick, keyB64: publicKeys[m.id] })}
                  className="relative rounded p-0.5 text-paper-700 transition-colors hover:text-paper-100"
                  title={t('members.fingerprint')}
                  aria-label={t('members.fingerprintOf', { name: m.nick })}
                >
                  <Key size={11} />
                  {keyFlagged.has(m.id) && (
                    <span
                      className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-stamp-500"
                      aria-label={t('members.keyChanged')}
                    />
                  )}
                </button>
              )}
              {canActOn && (
                <div className="hidden items-center gap-0.5 group-hover:flex">
                  {isOwner && (
                    <button
                      onClick={() => void act(() => setRole(community.id, m.id, m.role === 'member'))}
                      className="rounded p-0.5 text-paper-500 transition-colors hover:text-brass-400"
                      title={m.role === 'member' ? t('members.makeAdmin') : t('members.removeAdmin')}
                    >
                      <Star size={11} />
                    </button>
                  )}
                  <button
                    onClick={() => void act(() => banMember(community.id, m.id), t('members.kickBanConfirm', { name: m.nick }))}
                    className="rounded p-0.5 text-paper-500 transition-colors hover:text-stamp-400"
                    title={t('members.kickBan')}
                  >
                    <Ban size={11} />
                  </button>
                  <button
                    onClick={() => void act(() => removeMember(community.id, m.id), t('members.kickConfirm', { name: m.nick }))}
                    className="rounded p-0.5 text-paper-500 transition-colors hover:text-stamp-400"
                    title={t('members.kick')}
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
        <Modal title={t('members.addTitle')} onClose={() => setAdding(false)}>
          <div className="flex flex-col gap-3">
            <input
              autoFocus
              value={nick}
              onChange={(e) => setNick(e.target.value)}
              onKeyDown={(e) => nick.trim() && e.key === 'Enter' && void submit()}
              placeholder={t('members.nickPlaceholder')}
              maxLength={24}
              className="input"
            />
            <p className="text-xs text-paper-500">
              {t('members.addHint')}
            </p>
            {error && <p className="text-sm text-stamp-400">{error}</p>}
            <button onClick={() => void submit()} disabled={busy || !nick.trim()} className="btn-lamp">
              {busy ? t('members.adding') : t('members.add')}
            </button>
          </div>
        </Modal>
      )}
      {fingerprint && (
        <KeyFingerprintModal
          peerId={fingerprint.id}
          peerNick={fingerprint.nick}
          peerPublicKeyB64={fingerprint.keyB64}
          onTrust={() =>
            setKeyFlagged((prev) => {
              if (!prev.has(fingerprint.id)) return prev;
              const next = new Set(prev);
              next.delete(fingerprint.id);
              return next;
            })
          }
          onClose={() => setFingerprint(null)}
        />
      )}
      {pendingAct && (
        <ConfirmDialog
          title={t('members.confirmTitle')}
          message={pendingAct.text}
          danger
          confirmLabel={t('members.confirmYes')}
          onConfirm={() => void runAct(pendingAct.fn)}
          onCancel={() => setPendingAct(null)}
        />
      )}
      {card && <UserCard userId={card.id} nick={card.nick} onClose={() => setCard(null)} />}
    </div>
  );
}
