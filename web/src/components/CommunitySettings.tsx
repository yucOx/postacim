import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { useAppStore } from '../state/appStore';
import { wrapKeyFor } from '../crypto/identity';
import { onServerEvent } from '../ws/socket';
import Modal from './Modal';

interface BanRow {
  user_id: string;
  nick: string;
  created_at: number;
}
interface JoinRequestRow {
  user_id: string;
  nick: string;
  public_key: string;
  created_at: number;
}
interface InviteRow {
  id: string;
  code: string;
  target_nick: string | null;
  max_uses: number | null;
  uses: number;
  expires_at: number | null;
}

const storedLinks = (): Record<string, string> =>
  JSON.parse(localStorage.getItem('pgv_invite_links') ?? '{}') as Record<string, string>;

function InvitesTab({ communityId }: { communityId: string }) {
  const createInvite = useAppStore((s) => s.createInvite);
  const [invites, setInvites] = useState<InviteRow[] | null>(null);
  const [mode, setMode] = useState<'open' | 'targeted'>('open');
  const [targetNick, setTargetNick] = useState('');
  const [maxUses, setMaxUses] = useState('');
  const [ttlHours, setTtlHours] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [freshLink, setFreshLink] = useState<string | null>(null);

  const load = async (): Promise<void> => {
    const res = await api<{ invites: InviteRow[] }>(`/communities/${communityId}/invites`);
    setInvites(res.invites);
  };
  useEffect(() => {
    void load();
  }, [communityId]);

  const submit = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const link = await createInvite(communityId, {
        targetNick: mode === 'targeted' ? targetNick.trim() : undefined,
        maxUses: maxUses.trim() ? Number(maxUses) : undefined,
        ttlHours: ttlHours.trim() ? Number(ttlHours) : undefined,
      });
      setFreshLink(link);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'hata');
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (inviteId: string): Promise<void> => {
    await api(`/communities/${communityId}/invites/${inviteId}`, { method: 'DELETE' });
    await load();
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-2 text-xs">
        <button onClick={() => setMode('open')} className={`flex-1 rounded px-2 py-1 text-xs transition-colors ${mode === 'open' ? 'bg-paper-50 font-semibold text-night-950' : 'bg-night-800 text-paper-500 hover:text-paper-100'}`}>
          açık davet (link)
        </button>
        <button onClick={() => setMode('targeted')} className={`flex-1 rounded px-2 py-1 text-xs transition-colors ${mode === 'targeted' ? 'bg-paper-50 font-semibold text-night-950' : 'bg-night-800 text-paper-500 hover:text-paper-100'}`}>
          hedefli (nick)
        </button>
      </div>
      {mode === 'targeted' && (
        <input value={targetNick} onChange={(e) => setTargetNick(e.target.value)} placeholder="hedef nick" maxLength={24}
          className="input" />
      )}
      <div className="flex gap-2">
        <input value={maxUses} onChange={(e) => setMaxUses(e.target.value.replace(/\D/g, ''))} placeholder="max kullanım (∞)" inputMode="numeric"
          className="input w-1/2" />
        <input value={ttlHours} onChange={(e) => setTtlHours(e.target.value.replace(/[^\d.]/g, ''))} placeholder="süre (saat, ∞)" inputMode="decimal"
          className="input w-1/2" />
      </div>
      <button onClick={() => void submit()} disabled={busy || (mode === 'targeted' && !targetNick.trim())}
        className="btn-lamp">
        {busy ? 'üretiliyor…' : 'davet üret'}
      </button>
      {error && <p className="text-sm text-red-400">{error}</p>}
      {freshLink && (
        <div className="rounded-md border border-lamp-600/50 bg-lamp-100/60 p-2">
          <p className="mb-1 text-[11px] text-lamp-300">link (geçici anahtar linkin içinde — sunucuda yok)</p>
          <div className="flex items-center gap-2">
            <input readOnly value={freshLink} className="input flex-1 truncate !py-1 !text-xs" onFocus={(e) => e.target.select()} />
            <button onClick={() => void navigator.clipboard.writeText(freshLink)} className="btn-ghost !px-2 !py-1 !text-xs">
              kopyala
            </button>
          </div>
        </div>
      )}
      <div className="mt-1">
        <h3 className="plate mb-1">MEVCUT DAVETLER</h3>
        {invites?.length === 0 && <p className="text-sm text-paper-500">davet yok</p>}
        {invites?.map((inv) => {
          const link = storedLinks()[inv.id];
          return (
            <div key={inv.id} className="flex items-center gap-2 py-1 text-sm">
              <span className="w-24 truncate font-mono text-xs text-paper-100">{inv.code}</span>
              <span className="flex-1 text-xs text-paper-500">
                {inv.target_nick ? `→ ${inv.target_nick}` : 'açık'} · {inv.uses}/{inv.max_uses ?? '∞'}
                {inv.expires_at ? ` · ${new Date(inv.expires_at).toLocaleString('tr-TR')}` : ''}
              </span>
              {link ? (
                <button onClick={() => void navigator.clipboard.writeText(link)} className="btn-ghost !px-1.5 !py-0.5 !text-[11px]" title={link}>
                  linki kopyala
                </button>
              ) : (
                <span className="text-[10px] text-paper-700">link bu tarayıcıda üretilmedi</span>
              )}
              <button onClick={() => void revoke(inv.id)} className="text-xs text-paper-500 transition-colors hover:text-stamp-400">iptal</button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function RequestsTab({ communityId }: { communityId: string }) {
  const [requests, setRequests] = useState<JoinRequestRow[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async (): Promise<void> => {
    const res = await api<{ requests: JoinRequestRow[] }>(`/communities/${communityId}/join-requests`);
    setRequests(res.requests);
  };
  useEffect(() => {
    void load();
    return onServerEvent((e) => {
      if (e.type === 'join_request:new' && e.community_id === communityId) void load();
      if (e.type === 'community:member_added' && e.community_id === communityId) void load();
    });
  }, [communityId]);

  const approve = async (r: JoinRequestRow): Promise<void> => {
    setBusyId(r.user_id);
    setError(null);
    try {
      const com = useAppStore.getState().communities.find((c) => c.id === communityId);
      if (!com) throw new Error('topluluk bulunamadı');
      const wrappedKeys = [];
      for (const ch of com.channels) {
        const key = await useAppStore.getState().ensureChannelKey(ch.id);
        wrappedKeys.push({ channel_id: ch.id, key_version: ch.key_version, wrapped_key: wrapKeyFor(key, r.public_key) });
      }
      await api(`/communities/${communityId}/join-requests/${r.user_id}/approve`, {
        method: 'POST',
        body: { wrapped_keys: wrappedKeys },
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'onaylanamadı');
    } finally {
      setBusyId(null);
    }
  };

  const deny = async (r: JoinRequestRow): Promise<void> => {
    setBusyId(r.user_id);
    try {
      await api(`/communities/${communityId}/join-requests/${r.user_id}/deny`, { method: 'POST' });
      await load();
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div>
      {requests === null && <p className="text-sm text-paper-500">yükleniyor…</p>}
      {requests?.length === 0 && <p className="text-sm text-paper-500">bekleyen başvuru yok</p>}
      {error && <p className="mb-2 text-sm text-red-400">{error}</p>}
      {requests?.map((r) => (
        <div key={r.user_id} className="flex items-center gap-2 py-1">
          <span className="flex-1 truncate text-sm text-paper-100">{r.nick}</span>
          <button
            onClick={() => void approve(r)}
            disabled={busyId === r.user_id}
            className="btn-ghost !text-xs"
          >
            onayla
          </button>
          <button
            onClick={() => void deny(r)}
            disabled={busyId === r.user_id}
            className="btn-ghost !px-1.5 !py-0.5 !text-[11px]"
          >
            red
          </button>
        </div>
      ))}
      <p className="mt-2 text-[11px] text-paper-700">onayda kanal anahtarları başvuranın anahtarına sarılır</p>
    </div>
  );
}

function PasswordTab({ communityId }: { communityId: string }) {
  const setJoinPassword = useAppStore((s) => s.setJoinPassword);
  const removeJoinPassword = useAppStore((s) => s.removeJoinPassword);
  const hasPassword = useAppStore(
    (s) => s.communities.find((c) => c.id === s.activeCommunityId)?.has_join_password ?? false,
  );
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = async (): Promise<void> => {
    if (pw !== pw2) {
      setError('şifreler eşleşmiyor');
      return;
    }
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      await setJoinPassword(communityId, pw);
      setMsg(hasPassword ? 'şifre güncellendi' : 'şifre kuruldu — davetler artık ikinci faktör isteyecek');
      setPw('');
      setPw2('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'hata');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-paper-500">
        {hasPassword
          ? 'katılım şifresi aktif — davet linki + şifre ikisi birden gerekir'
          : 'şifre kurulursa davet linkine ek olarak katılım şifresi de istenir'}
      </p>
      <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="katılım şifresi" minLength={4}
        className="input" />
      <input type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} placeholder="tekrar" minLength={4}
        className="input" />
      {error && <p className="text-sm text-red-400">{error}</p>}
      {msg && <p className="text-sm text-emerald-400">{msg}</p>}
      <div className="flex gap-2">
        <button onClick={() => void submit()} disabled={busy || pw.length < 4}
          className="btn-lamp flex-1">
          {busy ? 'işleniyor…' : hasPassword ? 'değiştir' : 'kur'}
        </button>
        {hasPassword && (
          <button onClick={() => void removeJoinPassword(communityId).then(() => setMsg('şifre kaldırıldı'))}
            className="btn-ghost">
            kaldır
          </button>
        )}
      </div>
      <p className="text-[11px] text-paper-700">
        anahtar rotasyonundan sonra şifre anahtarları yenilenmelidir (yeniden kur)
      </p>
    </div>
  );
}

export default function CommunitySettings({ communityId, onClose }: { communityId: string; onClose: () => void }) {
  const myRole = useAppStore((s) => s.communities.find((c) => c.id === s.activeCommunityId)?.role);
  const pendingCount = useAppStore((s) => s.communities.find((c) => c.id === s.activeCommunityId)?.pending_join_requests ?? 0);
  const isOwner = myRole === 'owner';
  const [tab, setTab] = useState<'requests' | 'invites' | 'bans' | 'password'>('requests');
  const [bans, setBans] = useState<BanRow[] | null>(null);

  useEffect(() => {
    if (tab === 'bans' && bans === null) {
      void api<{ bans: BanRow[] }>(`/communities/${communityId}/bans`).then((res) => setBans(res.bans));
    }
  }, [tab, bans, communityId]);

  const unban = async (userId: string): Promise<void> => {
    await api(`/communities/${communityId}/bans/${userId}`, { method: 'DELETE' });
    setBans((prev) => prev?.filter((b) => b.user_id !== userId) ?? null);
  };

  return (
    <Modal title="Topluluk ayarları" onClose={onClose}>
      <div className="flex flex-col gap-4">
        <div className="flex gap-2 text-xs">
          {(['requests', 'invites', 'bans', ...(isOwner ? (['password'] as const) : [])] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)} className={`flex-1 rounded px-2 py-1 text-xs transition-colors ${tab === t ? 'bg-paper-50 font-semibold text-night-950' : 'bg-night-800 text-paper-500 hover:text-paper-100'}`}>
              {t === 'requests' ? `Başvurular${pendingCount ? ` (${pendingCount})` : ''}` : t === 'invites' ? 'Davetler' : t === 'bans' ? 'Banlılar' : 'Şifre'}
            </button>
          ))}
        </div>
        {tab === 'requests' && <RequestsTab communityId={communityId} />}
        {tab === 'invites' && <InvitesTab communityId={communityId} />}
        {tab === 'password' && isOwner && <PasswordTab communityId={communityId} />}
        {tab === 'bans' && (
          <div>
            {bans === null && <p className="text-sm text-paper-500">yükleniyor…</p>}
            {bans?.length === 0 && <p className="text-sm text-paper-500">banlı yok</p>}
            {bans?.map((b) => (
              <div key={b.user_id} className="flex items-center gap-2 py-1">
                <span className="flex-1 truncate text-sm text-paper-100">{b.nick}</span>
                <button onClick={() => void unban(b.user_id)} className="btn-ghost !px-1.5 !py-0.5 !text-[11px]">
                  banı kaldır
                </button>
              </div>
            ))}
          </div>
        )}
        <p className="text-xs text-paper-700">
          üye işlemleri (atma, banlama, admin) sağdaki üye listesinden{myRole === 'owner' ? ' — şifre ayarı yakında' : ''}
        </p>
      </div>
    </Modal>
  );
}
