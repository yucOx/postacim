import { useEffect, useRef, useState } from 'react';
import { KeyRound, LogOut, Menu, ShieldCheck } from 'lucide-react';
import { useAppStore } from '../state/appStore';
import { useAuthStore } from '../state/authStore';
import { wsConnect, wsDisconnect, onWsStatus, type WsStatus } from '../ws/socket';
import ServerRail from './ServerRail';
import ChannelSidebar from './ChannelSidebar';
import MemberList from './MemberList';
import ChatView from './ChatView';
import VoiceRoom from './VoiceRoom';
import DmHome from './DmHome';
import DmSidebar from './DmSidebar';
import DmChat from './DmChat';
import IncomingCall from './IncomingCall';
import CallView from './CallView';
import PiPWidget from './PiPWidget';
import Modal from './Modal';
import { PigeonMark } from './Brand';
import Avatar from './Avatar';
import ProfileModal from './ProfileModal';
import DeviceLockModal from './DeviceLockModal';
import { deviceOfferDeclined, deviceUnlockSupported, hasDeviceUnlock } from '../crypto/devicekey';
import { generateMnemonic, quizPositions } from '../crypto/bip39';
import { useChatStore } from '../state/chatStore';
import { useDmChatStore } from '../state/dmChatStore';
import { useUnreadStore, unreadCount } from '../state/unreadStore';
import { useVoiceStore } from '../state/voiceStore';
import { useSecurityStore } from '../state/securityStore';
import { readRoute } from '../router';

function PasswordModal({ onClose }: { onClose: () => void }) {
  const changePassword = useAuthStore((s) => s.changePassword);
  const logout = useAuthStore((s) => s.logout);
  const [oldPw, setOldPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [newPw2, setNewPw2] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const submit = async (): Promise<void> => {
    if (newPw !== newPw2) {
      setError('yeni şifreler eşleşmiyor');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await changePassword(oldPw, newPw);
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'hata');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Şifre değiştir" onClose={onClose}>
      {done ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-lamp-300">
            şifre güncellendi — tüm oturumlar kapandı, yeni şifrenle tekrar giriş yap
          </p>
          <button onClick={() => void logout().finally(onClose)} className="btn-lamp">
            giriş ekranına dön
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <input type="password" autoFocus value={oldPw} onChange={(e) => setOldPw(e.target.value)} placeholder="eski şifre" className="input" />
          <input type="password" value={newPw} onChange={(e) => setNewPw(e.target.value)} placeholder="yeni şifre" minLength={6} className="input" />
          <input type="password" value={newPw2} onChange={(e) => setNewPw2(e.target.value)} placeholder="yeni şifre (tekrar)" minLength={6} className="input" />
          {error && <p className="text-sm text-stamp-400">{error}</p>}
          <button onClick={() => void submit()} disabled={busy || !oldPw || newPw.length < 6} className="btn-lamp">
            {busy ? 'güncelleniyor…' : 'değiştir'}
          </button>
        </div>
      )}
    </Modal>
  );
}

export default function Shell() {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const [pwModal, setPwModal] = useState(false);
  const [recModal, setRecModal] = useState(false);
  const [profileModal, setProfileModal] = useState(false);
  const [deviceOffer, setDeviceOffer] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const loaded = useAppStore((s) => s.loaded);
  const loadBootstrap = useAppStore((s) => s.loadBootstrap);
  const wireEvents = useAppStore((s) => s.wireEvents);
  const channel = useAppStore((s) => s.activeChannel());
  const view = useAppStore((s) => s.view);
  const activeDm = useAppStore((s) => (s.activeDmId ? s.dms.find((d) => d.id === s.activeDmId) ?? null : null));
  const isDmCall = useVoiceStore((s) => s.isDmCall);
  const pip = useVoiceStore((s) => s.pip);
  const dms = useAppStore((s) => s.dms);
  const gdms = useAppStore((s) => s.gdms);
  const openDmChat = useAppStore((s) => s.openDmChat);
  const selectChannel = useAppStore((s) => s.selectChannel);
  const dmMessages = useDmChatStore((s) => s.messages);
  useUnreadStore((s) => s.readMap);
  const keylogWarning = useSecurityStore((s) => s.keylogWarning);

  // browser-tab badge: total unread DMs
  const dmUnreadTotal = dms.reduce((n, d) => n + unreadCount(d.id, dmMessages[d.id]), 0);
  useEffect(() => {
    document.title = dmUnreadTotal > 0 ? `(${dmUnreadTotal}) postacim` : 'postacim';
  }, [dmUnreadTotal]);

  // "bu cihazda hatırla" teklifi — bir kez: desteklenen cihazda, kayıt yoksa ve
  // daha önce reddedilmemişse çıkar. Destek yoksa hiç görünmez.
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        if (!(await deviceUnlockSupported())) return;
        if (deviceOfferDeclined()) return;
        if (await hasDeviceUnlock()) return;
        if (alive) setDeviceOffer(true);
      } catch {
        /* destek algısı başarısız → teklif yok, her şey eskisi gibi */
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    wireEvents();
    useChatStore.getState().wire();
    useDmChatStore.getState().wire();
    useVoiceStore.getState().wire();
    wsConnect();
    void loadBootstrap();
    return () => wsDisconnect();
  }, [wireEvents, loadBootstrap]);

  // anahtar defteri doğrulaması — Shell mount'unda bir kez (giriş/kayıt
  // sonrası): defteri çek, zinciri doğrula, kendi kaydını kontrol et
  useEffect(() => {
    const { user, publicKey } = useAuthStore.getState();
    if (user && publicKey) void useSecurityStore.getState().runKeyLogCheck(user.id, publicKey);
  }, []);

  // live connection badge — the socket retries forever; this says when it's down
  const [wsStat, setWsStat] = useState<WsStatus>('offline');
  useEffect(() => onWsStatus(setWsStat), []);

  // F5 restore: once bootstrap is in, the URL slug decides where you land
  // (the re-auth card sits in front of this — after the password you're back
  // in the same conversation). Unknown ids fall through to the default view.
  const routeApplied = useRef(false);
  useEffect(() => {
    if (!loaded || routeApplied.current) return;
    routeApplied.current = true;
    const r = readRoute();
    if (r?.view === 'dm') {
      if (dms.some((d) => d.id === r.dmId) || gdms.some((g) => g.id === r.dmId)) openDmChat(r.dmId);
    } else if (r?.view === 'community') {
      if (useAppStore.getState().communities.some((c) => c.channels.some((ch) => ch.id === r.channelId)))
        selectChannel(r.channelId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded]);

  const closeNav = (): void => setNavOpen(false);

  return (
    <div className="flex h-screen flex-col bg-night-950 text-paper-100">
      {/* rota plakası — the wagon header */}
      <header className="flex h-11 shrink-0 items-center justify-between gap-2 border-b border-night-700 bg-night-900 px-3 sm:px-4">
        <div className="flex min-w-0 items-center gap-2.5">
          <button
            onClick={() => setNavOpen(true)}
            aria-label="menü"
            className="rounded p-1 text-paper-300 transition-colors hover:bg-night-800 hover:text-paper-100 lg:hidden"
          >
            <Menu size={18} />
          </button>
          <PigeonMark size={19} className="shrink-0 text-lamp-500" />
          <span className="plate !text-sm !tracking-[0.22em] text-paper-100">postacim</span>
          {wsStat !== 'open' && (
            <span
              className={`ml-1 rounded-sm border px-1.5 py-px font-display text-[10px] font-semibold uppercase tracking-[0.16em] ${
                wsStat === 'connecting'
                  ? 'border-lamp-600/70 bg-lamp-100 text-lamp-300'
                  : 'border-stamp-500/70 bg-stamp-100 text-stamp-400'
              }`}
            >
              {wsStat === 'connecting' ? 'hat kuruluyor' : 'hat yok — yeniden deneniyor'}
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1.5 text-sm">
          <button
            onClick={() => setProfileModal(true)}
            className="flex items-center gap-1.5 rounded-sm px-1 py-0.5 text-paper-300 transition-colors hover:bg-night-800 hover:text-paper-100"
            title="profil"
            aria-label="profil"
          >
            {user && <Avatar userId={user.id} label={user.nick} size={22} srcOverride={user.avatar_updated_at ? undefined : null} />}
            <span className="hidden sm:inline">{user?.nick}</span>
          </button>
          <button
            onClick={() => setRecModal(true)}
            className="btn-ghost !px-2 !py-1 !text-xs"
            title="kurtarma ifadesi"
          >
            <ShieldCheck size={13} />
            <span className="hidden md:inline">kurtarma</span>
          </button>
          <button onClick={() => setPwModal(true)} className="btn-ghost !px-2 !py-1 !text-xs" title="şifre değiştir">
            <KeyRound size={13} />
            <span className="hidden md:inline">şifre</span>
          </button>
          <button onClick={() => void logout()} className="btn-ghost !px-2 !py-1 !text-xs" title="çıkış yap">
            <LogOut size={13} />
            <span className="hidden md:inline">çıkış</span>
          </button>
        </div>
      </header>

      {/* anahtar defteri çelişkisi — zincir kopmuş / yeniden yazılmış /
          kimliğimiz başka anahtarla yayınlanıyor: bariz kırmızı */}
      {keylogWarning && (
        <div className="shrink-0 border-b border-stamp-500/70 bg-stamp-100 px-3 py-1.5">
          <p className="text-xs font-semibold text-stamp-400">
            güvenlik uyarısı — {keylogWarning}. durum düzelene kadar bu sunucudaki hiçbir
            anahtara güvenmeyin
          </p>
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        {/* desktop rails */}
        <div className="hidden lg:flex">
          <ServerRail />
          {view === 'community' && <ChannelSidebar />}
          {view === 'dm' && <DmSidebar />}
        </div>

        {view === 'dm' ? (
          <main className="flex min-w-0 flex-1 flex-col">
            {activeDm ? <DmChat dmId={activeDm.id} /> : <DmHome />}
          </main>
        ) : (
          <main className="flex min-w-0 flex-1 flex-col">
            {!loaded ? (
              <div className="flex flex-1 items-center justify-center text-paper-500">yükleniyor…</div>
            ) : channel ? (
              channel.type === 'text' ? (
                <ChatView channelId={channel.id} channelName={channel.name} />
              ) : (
                <VoiceRoom channelId={channel.id} channelName={channel.name} />
              )
            ) : (
              <div className="flex flex-1 items-center justify-center text-sm text-paper-500">
                soldan bir topluluk ve oda seç
              </div>
            )}
          </main>
        )}
        {view === 'community' && (
          <div className="hidden xl:flex">
            <MemberList />
          </div>
        )}
      </div>

      {/* mobile drawer — rail + channels as one pull-out sorting tray */}
      {navOpen && (
        <div className="fixed inset-0 z-40 lg:hidden" role="presentation">
          <div className="absolute inset-0 bg-night-950/80" onClick={closeNav} />
          <div className="absolute inset-y-0 left-0 flex animate-seal-in border-r border-brass-700/70 bg-night-900 shadow-[0_0_60px_rgba(0,0,0,0.7)]">
            <ServerRail onNavigate={closeNav} />
            {view === 'community' && <ChannelSidebar onNavigate={closeNav} />}
            {view === 'dm' && <DmSidebar onNavigate={closeNav} />}
          </div>
        </div>
      )}

      {pwModal && <PasswordModal onClose={() => setPwModal(false)} />}
      {recModal && <RecoveryModal onClose={() => setRecModal(false)} />}
      {profileModal && <ProfileModal onClose={() => setProfileModal(false)} />}
      {deviceOffer && <DeviceLockModal onClose={() => setDeviceOffer(false)} />}
      {isDmCall && !pip && <CallView />}
      {isDmCall && pip && <PiPWidget />}
      <IncomingCall />
    </div>
  );
}

// Attach a recovery phrase to a logged-in account (created before the ritual).
function RecoveryModal({ onClose }: { onClose: () => void }) {
  const setupRecovery = useAuthStore((s) => s.setupRecovery);
  const [phase, setPhase] = useState<'show' | 'quiz' | 'done'>('show');
  const [words, setWords] = useState<string[] | null>(null);
  useEffect(() => {
    void generateMnemonic().then(setWords);
  }, []);
  const [quiz] = useState(() => quizPositions());
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const quizOk =
    !!words && quiz.every((i) => (answers[i] ?? '').trim().toLowerCase() === words[i]?.toLowerCase());

  const download = (): void => {
    if (!words) return;
    const txt =
      `postacim kurtarma ifadesi\n\n${words.join(' ')}\n\n` +
      `Bu 12 kelime hesabını geri getiren tek şeydir. Kimselerle paylaşma,\n` +
      `ekran görüntüsü alma. Kağıda yaz, kilitli bir yerde sakla.\n`;
    const url = URL.createObjectURL(new Blob([txt], { type: 'text/plain' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'postacim-kurtarma.txt';
    a.click();
    URL.revokeObjectURL(url);
  };

  const finish = async (): Promise<void> => {
    if (!words) return;
    setBusy(true);
    setError(null);
    try {
      await setupRecovery(words);
      setPhase('done');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'kaydedilemedi');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Kurtarma ifadesi" onClose={onClose}>
      {phase === 'show' && (
        <div className="flex flex-col gap-3">
          <p className="text-xs text-paper-500">
            hesabın bu ifadede yedeklenir — şifreni kaybedersen tek kurtarma yolu bu
          </p>
          <div className="grid grid-cols-3 gap-1.5">
            {(words ?? Array.from({ length: 12 }, () => '…')).map((w, i) => (
              <div
                key={i}
                className="flex items-baseline gap-1 rounded-sm border border-brass-700/40 bg-paper-50 px-1.5 py-1 text-night-950"
              >
                <span className="font-display text-[9px] font-semibold text-brass-700">{i + 1}</span>
                <span className="select-all font-mono text-xs font-medium">{w}</span>
              </div>
            ))}
          </div>
          <div className="flex gap-2">
            <button onClick={download} className="btn-ghost flex-1">
              indir
            </button>
            <button onClick={() => setPhase('quiz')} disabled={!words} className="btn-lamp flex-1">
              kaydettim, doğrula
            </button>
          </div>
        </div>
      )}
      {phase === 'quiz' && (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-paper-300">{quiz.map((i) => i + 1).join(', ')}. kelimeleri yaz:</p>
          {quiz.map((i) => (
            <label key={i} className="flex items-center gap-2 text-sm">
              <span className="w-14 shrink-0 text-paper-500">{i + 1}. kelime</span>
              <input
                value={answers[i] ?? ''}
                onChange={(e) => setAnswers((a) => ({ ...a, [i]: e.target.value }))}
                className="input font-mono"
                spellCheck={false}
              />
            </label>
          ))}
          <button onClick={() => void finish()} disabled={!quizOk || busy} className="btn-lamp">
            {busy ? 'kaydediliyor…' : 'kaydet'}
          </button>
          <button
            onClick={() => setPhase('show')}
            className="text-xs text-paper-500 transition-colors hover:text-paper-300"
          >
            ← kelimelere dön
          </button>
        </div>
      )}
      {phase === 'done' && (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-lamp-300">kurtarma ifadesi hesabına bağlandı</p>
          <button onClick={onClose} className="btn-lamp">
            tamam
          </button>
        </div>
      )}
      {error && <p className="mt-2 text-sm text-stamp-400">{error}</p>}
    </Modal>
  );
}
