import { useEffect, useState } from 'react';
import { useAppStore } from '../state/appStore';
import { useAuthStore } from '../state/authStore';
import { wsConnect, wsDisconnect, onWsStatus, type WsStatus } from '../ws/socket';
import ServerRail from './ServerRail';
import ChannelSidebar from './ChannelSidebar';
import MemberList from './MemberList';
import ChatView from './ChatView';
import VoiceRoom from './VoiceRoom';
import DmHome from './DmHome';
import DmChat from './DmChat';
import IncomingCall from './IncomingCall';
import CallView from './CallView';
import Modal from './Modal';
import { generateMnemonic, quizPositions } from '../crypto/bip39';
import { useChatStore } from '../state/chatStore';
import { useDmChatStore } from '../state/dmChatStore';
import { useUnreadStore, unreadCount } from '../state/unreadStore';
import { useVoiceStore } from '../state/voiceStore';

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
          <p className="text-sm text-emerald-400">
            şifre güncellendi — tüm oturumlar kapandı, yeni şifrenle tekrar giriş yap
          </p>
          <button
            onClick={() => void logout().finally(onClose)}
            className="rounded-md bg-indigo-600 py-2 text-sm font-medium hover:bg-indigo-500"
          >
            giriş ekranına dön
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <input type="password" autoFocus value={oldPw} onChange={(e) => setOldPw(e.target.value)} placeholder="eski şifre" className="rounded-md border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm outline-none focus:border-neutral-500" />
          <input type="password" value={newPw} onChange={(e) => setNewPw(e.target.value)} placeholder="yeni şifre" minLength={6} className="rounded-md border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm outline-none focus:border-neutral-500" />
          <input type="password" value={newPw2} onChange={(e) => setNewPw2(e.target.value)} placeholder="yeni şifre (tekrar)" minLength={6} className="rounded-md border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm outline-none focus:border-neutral-500" />
          {error && <p className="text-sm text-red-400">{error}</p>}
          <button onClick={() => void submit()} disabled={busy || !oldPw || newPw.length < 6} className="rounded-md bg-indigo-600 py-2 text-sm font-medium hover:bg-indigo-500 disabled:opacity-50">
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
  const loaded = useAppStore((s) => s.loaded);
  const loadBootstrap = useAppStore((s) => s.loadBootstrap);
  const wireEvents = useAppStore((s) => s.wireEvents);
  const channel = useAppStore((s) => s.activeChannel());
  const view = useAppStore((s) => s.view);
  const activeDm = useAppStore((s) => (s.activeDmId ? s.dms.find((d) => d.id === s.activeDmId) ?? null : null));
  const isDmCall = useVoiceStore((s) => s.isDmCall);
  const dms = useAppStore((s) => s.dms);
  const dmMessages = useDmChatStore((s) => s.messages);
  useUnreadStore((s) => s.readMap);

  // browser-tab badge: total unread DMs
  const dmUnreadTotal = dms.reduce((n, d) => n + unreadCount(d.id, dmMessages[d.id]), 0);
  useEffect(() => {
    document.title = dmUnreadTotal > 0 ? `(${dmUnreadTotal}) postacim` : 'postacim';
  }, [dmUnreadTotal]);

  useEffect(() => {
    wireEvents();
    useChatStore.getState().wire();
    useDmChatStore.getState().wire();
    useVoiceStore.getState().wire();
    wsConnect();
    void loadBootstrap();
    return () => wsDisconnect();
  }, [wireEvents, loadBootstrap]);

  // live connection badge — the socket retries forever; this says when it's down
  const [wsStat, setWsStat] = useState<WsStatus>('offline');
  useEffect(() => onWsStatus(setWsStat), []);

  return (
    <div className="flex h-screen flex-col bg-neutral-950 text-neutral-200">
      <header className="flex h-10 items-center justify-between border-b border-neutral-800/60 px-4">
        <span className="text-sm font-semibold">postacim 🕊️</span>
        {wsStat !== 'open' && (
          <span
            className={`ml-2 rounded-full px-2 py-0.5 text-[10px] font-medium ${
              wsStat === 'connecting' ? 'bg-amber-900/50 text-amber-300' : 'bg-red-900/50 text-red-300'
            }`}
          >
            {wsStat === 'connecting' ? 'bağlanıyor…' : 'bağlantı yok — yeniden deneniyor'}
          </span>
        )}
        <div className="flex items-center gap-3 text-sm">
          <span className="text-neutral-400">{user?.nick}</span>
          <button
            onClick={() => setRecModal(true)}
            className="rounded border border-neutral-700 px-2 py-0.5 text-xs text-neutral-300 hover:bg-neutral-800"
          >
            🗝️ kurtarma
          </button>
          <button
            onClick={() => setPwModal(true)}
            className="rounded border border-neutral-700 px-2 py-0.5 text-xs text-neutral-300 hover:bg-neutral-800"
          >
            şifre
          </button>
          <button
            onClick={() => void logout()}
            className="rounded border border-neutral-700 px-2 py-0.5 text-xs text-neutral-300 hover:bg-neutral-800"
          >
            çıkış
          </button>
        </div>
      </header>
      <div className="flex min-h-0 flex-1">
        <ServerRail />
        {view === 'dm' ? (
          <main className="flex min-w-0 flex-1 flex-col">
            {activeDm ? <DmChat dmId={activeDm.id} /> : <DmHome />}
          </main>
        ) : (
          <>
            <ChannelSidebar />
            <main className="flex min-w-0 flex-1 flex-col">
          {!loaded ? (
            <div className="flex flex-1 items-center justify-center text-neutral-600">yükleniyor…</div>
          ) : channel ? (
            channel.type === 'text' ? (
              <ChatView channelId={channel.id} channelName={channel.name} />
            ) : (
              <VoiceRoom channelId={channel.id} channelName={channel.name} />
            )
          ) : (
            <div className="flex flex-1 items-center justify-center text-sm text-neutral-600">
              soldan bir topluluk ve oda seç
            </div>
          )}
            </main>
            <MemberList />
          </>
        )}
      </div>
      {pwModal && <PasswordModal onClose={() => setPwModal(false)} />}
      {recModal && <RecoveryModal onClose={() => setRecModal(false)} />}
      {isDmCall && <CallView />}
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
    <Modal title="🗝️ Kurtarma ifadesi" onClose={onClose}>
      {phase === 'show' && (
        <div className="flex flex-col gap-3">
          <p className="text-xs text-neutral-500">
            hesabın bu ifadede yedeklenir — şifreni kaybedersen tek kurtarma yolu bu
          </p>
          <div className="grid grid-cols-3 gap-1.5">
            {(words ?? Array.from({ length: 12 }, () => '…')).map((w, i) => (
              <div key={i} className="flex items-baseline gap-1 rounded border border-neutral-800 bg-neutral-950/60 px-1.5 py-1">
                <span className="text-[9px] text-neutral-600">{i + 1}</span>
                <span className="select-all font-mono text-xs">{w}</span>
              </div>
            ))}
          </div>
          <div className="flex gap-2">
            <button onClick={download} className="flex-1 rounded border border-neutral-700 py-1.5 text-xs text-neutral-300 hover:bg-neutral-800">
              ⬇ indir
            </button>
            <button
              onClick={() => setPhase('quiz')}
              disabled={!words}
              className="flex-1 rounded bg-indigo-600 py-1.5 text-xs font-medium hover:bg-indigo-500 disabled:opacity-50"
            >
              kaydettim, doğrula
            </button>
          </div>
        </div>
      )}
      {phase === 'quiz' && (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-neutral-300">
            {quiz.map((i) => i + 1).join(', ')}. kelimeleri yaz:
          </p>
          {quiz.map((i) => (
            <label key={i} className="flex items-center gap-2 text-sm">
              <span className="w-14 text-neutral-500">{i + 1}. kelime</span>
              <input
                value={answers[i] ?? ''}
                onChange={(e) => setAnswers((a) => ({ ...a, [i]: e.target.value }))}
                className="flex-1 rounded border border-neutral-700 bg-neutral-800 px-2 py-1 font-mono text-sm outline-none focus:border-neutral-500"
                spellCheck={false}
              />
            </label>
          ))}
          <button
            onClick={() => void finish()}
            disabled={!quizOk || busy}
            className="rounded bg-indigo-600 py-1.5 text-sm font-medium hover:bg-indigo-500 disabled:opacity-50"
          >
            {busy ? 'kaydediliyor…' : 'kaydet'}
          </button>
          <button onClick={() => setPhase('show')} className="text-xs text-neutral-500 hover:text-neutral-300">
            ← kelimelere dön
          </button>
        </div>
      )}
      {phase === 'done' && (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-emerald-400">✔ kurtarma ifadesi hesabına bağlandı</p>
          <button onClick={onClose} className="rounded bg-indigo-600 py-1.5 text-sm font-medium hover:bg-indigo-500">
            tamam
          </button>
        </div>
      )}
      {error && <p className="mt-2 text-sm text-red-400">{error}</p>}
    </Modal>
  );
}
