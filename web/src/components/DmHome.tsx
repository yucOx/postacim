import { useEffect, useState } from 'react';
import { Check, Key, Plus, X } from 'lucide-react';
import { useAppStore } from '../state/appStore';
import { useDmChatStore } from '../state/dmChatStore';
import { unreadCount, useUnreadStore } from '../state/unreadStore';
import { formatTime } from '../lib/format';
import { ensurePinned } from '../lib/keypins';
import ConfirmDialog from './ConfirmDialog';
import KeyFingerprintModal from './KeyFingerprintModal';
import Modal from './Modal';
import Avatar from './Avatar';
import { useT } from '../i18n/I18nProvider';

function NewGroupModal({ onClose }: { onClose: () => void }) {
  const { t } = useT();
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
    <Modal title={t('dmHome.newGroupModalTitle')} onClose={onClose}>
      <div className="flex w-80 flex-col gap-3">
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t('dmHome.groupNamePlaceholder')}
          maxLength={64}
          className="input"
        />
        <div className="max-h-56 overflow-y-auto">
          {friends.length === 0 && <p className="text-sm text-paper-500">{t('dmHome.noFriendsAlt')}</p>}
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
          {busy ? t('dmHome.creatingGroup') : t('dmHome.createGroup', { n: picked.size })}
        </button>
        <p className="text-[11px] text-paper-500">{t('dmHome.keyRotationHint')}</p>
      </div>
    </Modal>
  );
}

export default function DmHome() {
  const { t } = useT();
  const friends = useAppStore((s) => s.friends);
  const incoming = useAppStore((s) => s.friendIncoming);
  const outgoing = useAppStore((s) => s.friendOutgoing);
  const dms = useAppStore((s) => s.dms);
  const gdms = useAppStore((s) => s.gdms);
  const publicKeys = useAppStore((s) => s.publicKeys);
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
  // TOFU key pinning: peer keys fetched for plain DMs kept after unfriend
  const [fetchedPeerKeys, setFetchedPeerKeys] = useState<Record<string, string>>({});
  const [keyFlagged, setKeyFlagged] = useState<Record<string, boolean>>({});
  const [fingerprint, setFingerprint] = useState<{ id: string; nick: string; keyB64?: string } | null>(null);

  // a peer's key, wherever it is already available client-side
  const knownKey = (id: string): string | undefined =>
    friends.find((f) => f.id === id)?.public_key ?? publicKeys[id] ?? fetchedPeerKeys[id];

  const openFingerprint = (id: string, nick: string): void =>
    setFingerprint({ id, nick, keyB64: knownKey(id) });

  // TOFU sweep: pin every key visible client-side; flag mismatches for the banner
  useEffect(() => {
    let alive = true;
    void (async () => {
      const known = new Map<string, string>();
      for (const f of friends) known.set(f.id, f.public_key);
      for (const g of gdms) for (const m of g.members) known.set(m.id, m.public_key);
      // DM peers are normally friends; a DM kept after unfriend needs the pubkey endpoint
      const fetched: Record<string, string> = {};
      for (const d of dms) {
        if (known.has(d.peer.id)) continue;
        try {
          const res = await fetch(`/api/users/${d.peer.id}/pubkey`, { credentials: 'same-origin' });
          if (!res.ok) continue;
          const { public_key } = (await res.json()) as { public_key: string };
          fetched[d.peer.id] = public_key;
          known.set(d.peer.id, public_key);
        } catch {
          // network failure — this peer just skips the check this round
        }
      }
      const flagged: Record<string, boolean> = {};
      for (const [id, key] of known) {
        if (ensurePinned(id, key) === 'changed') flagged[id] = true;
      }
      if (!alive) return;
      if (Object.keys(fetched).length > 0) setFetchedPeerKeys((prev) => ({ ...prev, ...fetched }));
      setKeyFlagged(flagged);
    })();
    return () => {
      alive = false;
    };
  }, [friends, gdms, dms]);

  // flagged peers for the persistent warning banner, deduped by id
  const flaggedPeers = (() => {
    const byId = new Map<string, string>();
    for (const f of friends) if (keyFlagged[f.id]) byId.set(f.id, f.nick);
    for (const d of dms) if (keyFlagged[d.peer.id]) byId.set(d.peer.id, d.peer.nick);
    for (const g of gdms)
      for (const m of g.members) if (keyFlagged[m.id] && !byId.has(m.id)) byId.set(m.id, `${m.nick} (${g.name})`);
    return [...byId].map(([id, nick]) => ({ id, nick }));
  })();

  const submit = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      await sendFriendRequest(nick.trim());
      setMsg(t('dmHome.requestSent', { nick }));
      setNick('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'hata');
    } finally {
      setBusy(false);
    }
  };

  const avatar = (label: string, id: string): React.ReactNode => <Avatar userId={id} label={label} size={32} />;

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-lg flex-col gap-7 p-6">
        <div className="border-b border-night-700 pb-4">
          <h1 className="font-display text-2xl font-bold uppercase tracking-[0.1em] text-paper-50">
            {t('dmHome.title')}
          </h1>
          <p className="mt-1 text-xs text-paper-500">
            {t('dmHome.hint')}
          </p>
        </div>

        {flaggedPeers.length > 0 && (
          <div className="rounded border border-stamp-500/70 bg-night-950/70 p-3">
            <p className="text-sm font-semibold text-stamp-400">
              {t('dmHome.keyChangedBanner')}
            </p>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {flaggedPeers.map((p) => (
                <button
                  key={p.id}
                  onClick={() => openFingerprint(p.id, p.nick)}
                  className="btn-ghost !py-0.5 !text-xs hover:!border-stamp-500/70 hover:!text-stamp-400"
                >
                  {t('dmHome.verifyPeer', { name: p.nick })}
                </button>
              ))}
            </div>
          </div>
        )}

        <section>
          <h2 className="plate mb-2">{t('dmHome.addFriend')}</h2>
          <div className="flex gap-2">
            <input
              value={nick}
              onChange={(e) => setNick(e.target.value)}
              onKeyDown={(e) => nick.trim() && e.key === 'Enter' && void submit()}
              placeholder={t('dmHome.nickPlaceholder')}
              maxLength={24}
              className="input flex-1"
            />
            <button onClick={() => void submit()} disabled={busy || !nick.trim()} className="btn-lamp shrink-0">
              {t('dmHome.sendRequest')}
            </button>
          </div>
          {msg && <p className="mt-1.5 text-sm text-lamp-300">{msg}</p>}
          {error && <p className="mt-1.5 text-sm text-stamp-400">{error}</p>}
        </section>

        {incoming.length > 0 && (
          <section>
            <h2 className="plate mb-2">{t('dmHome.incoming')}</h2>
            {incoming.map((f) => (
              <div key={f.id} className="flex items-center gap-2 py-1">
                {avatar(f.nick, f.id)}
                <span className="flex-1 truncate text-sm text-paper-100">{f.nick}</span>
                <button onClick={() => void acceptFriend(f.id)} className="btn-ghost !text-xs" title={t('dmHome.acceptTitle')}>
                  <Check size={13} />
                  {t('dmHome.accept')}
                </button>
                <button
                  onClick={() => void declineFriend(f.id)}
                  className="btn-ghost !text-xs hover:!border-stamp-500/70 hover:!text-stamp-400"
                  title={t('dmHome.declineTitle')}
                >
                  <X size={13} />
                  {t('dmHome.decline')}
                </button>
              </div>
            ))}
          </section>
        )}

        {outgoing.length > 0 && (
          <section>
            <h2 className="plate mb-2">{t('dmHome.outgoing')}</h2>
            {outgoing.map((f) => (
              <div key={f.id} className="py-1 text-sm text-paper-500">
                {f.nick} <span className="text-xs">{t('dmHome.waiting')}</span>
              </div>
            ))}
          </section>
        )}

        <section>
          <div className="mb-2 flex items-center justify-between">
            <h2 className="plate">{t('dmHome.conversations')}</h2>
            <button
              onClick={() => setNewGroup(true)}
              className="btn-ghost !py-0.5 !text-xs"
              title={t('dmHome.newGroupTitle')}
            >
              <Plus size={12} />
              {t('dmHome.newGroup')}
            </button>
          </div>
          {dms.length === 0 && gdms.length === 0 && (
            <p className="text-sm text-paper-500">{t('dmHome.noConversations')}</p>
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
                  <span className="ml-1 text-[10px] text-paper-500">{t('dmHome.groupMembers', { n: g.members.length })}</span>
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
            // div instead of button — the row contains the key-icon button (no nested buttons)
            return (
              <div
                key={d.id}
                role="button"
                tabIndex={0}
                onClick={() => openDmChat(d.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    openDmChat(d.id);
                  }
                }}
                className={`flex w-full cursor-pointer items-center gap-2 rounded px-1 py-1.5 text-left transition-colors hover:bg-night-800 ${
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
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    openFingerprint(d.peer.id, d.peer.nick);
                  }}
                  className="relative rounded p-1 text-paper-700 transition-colors hover:text-paper-100"
                  title={t('dmHome.fingerprint')}
                  aria-label={t('dmHome.fingerprintOf', { name: d.peer.nick })}
                >
                  <Key size={13} />
                  {keyFlagged[d.peer.id] && (
                    <span
                      className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-stamp-500"
                      aria-label={t('dmHome.keyChanged')}
                    />
                  )}
                </button>
              </div>
            );
          })}
        </section>

        <section>
          <h2 className="plate mb-2">{t('dmHome.friends')}</h2>
          {friends.length === 0 && <p className="text-sm text-paper-500">{t('dmHome.noFriends')}</p>}
          {friends.map((f) => (
            <div key={f.id} className="group flex items-center gap-2 rounded px-1 py-1.5 hover:bg-night-800">
              {avatar(f.nick, f.id)}
              <span className="flex-1 truncate text-sm text-paper-300">{f.nick}</span>
              <button
                onClick={() => openFingerprint(f.id, f.nick)}
                className="relative rounded p-1 text-paper-700 transition-colors hover:text-paper-100"
                title={t('dmHome.fingerprint')}
                aria-label={t('dmHome.fingerprintOf', { name: f.nick })}
              >
                <Key size={13} />
                {keyFlagged[f.id] && (
                  <span
                    className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-stamp-500"
                    aria-label={t('dmHome.keyChanged')}
                  />
                )}
              </button>
              <button
                onClick={() => void openDm(f.id)}
                className="btn-ghost !py-0.5 !text-xs opacity-0 transition-opacity group-hover:opacity-100"
              >
                {t('dmHome.message')}
              </button>
              <button
                onClick={() => setUnfriendNick(f.nick)}
                className="rounded p-1 text-paper-700 opacity-0 transition-opacity hover:text-stamp-400 group-hover:opacity-100"
                title={t('dmHome.unfriendTitle')}
                aria-label={t('dmHome.unfriendOf', { name: f.nick })}
              >
                <X size={13} />
              </button>
            </div>
          ))}
        </section>
      </div>

      {newGroup && <NewGroupModal onClose={() => setNewGroup(false)} />}
      {fingerprint && (
        <KeyFingerprintModal
          peerId={fingerprint.id}
          peerNick={fingerprint.nick}
          peerPublicKeyB64={fingerprint.keyB64}
          onTrust={() =>
            setKeyFlagged((prev) => {
              if (!(fingerprint.id in prev)) return prev;
              const next = { ...prev };
              delete next[fingerprint.id];
              return next;
            })
          }
          onClose={() => setFingerprint(null)}
        />
      )}
      {unfriendNick && (
        <ConfirmDialog
          title={t('dmHome.unfriendTitleModal')}
          message={t('dmHome.unfriendMessage', { name: unfriendNick })}
          danger
          confirmLabel={t('dmHome.unfriendConfirm')}
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
