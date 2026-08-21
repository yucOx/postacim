import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { useAuthStore } from '../state/authStore';
import { generateMnemonic, quizPositions, validateMnemonic } from '../crypto/bip39';
import PasswordInput, { passwordScore } from './PasswordInput';

type Step = 'login' | 'register' | 'phrase' | 'forgot';

export default function Login() {
  const [step, setStep] = useState<Step>('login');
  const [nick, setNick] = useState('');
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [ack, setAck] = useState(false);
  const [ackReady, setAckReady] = useState(false); // 3s anti-reflex timer
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const login = useAuthStore((s) => s.login);
  const register = useAuthStore((s) => s.register);

  useEffect(() => {
    if (!ack) return;
    setAckReady(false);
    const t = setTimeout(() => setAckReady(true), 3000);
    return () => clearTimeout(t);
  }, [ack]);

  const pwScore = passwordScore(password);
  const canRegister =
    nick.trim().length >= 3 &&
    password.length >= 6 &&
    password === password2 &&
    pwScore >= 2 &&
    ack &&
    ackReady;

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (step === 'login') await login(nick.trim(), password);
      else setStep('phrase'); // phrase screen finishes registration
    } catch (err) {
      setError(err instanceof Error ? err.message : 'bir hata oluştu');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-screen items-center justify-center bg-neutral-950 text-neutral-200">
      {step === 'phrase' ? (
        <PhraseStep
          nick={nick.trim()}
          password={password}
          onBack={() => setStep('register')}
        />
      ) : step === 'forgot' ? (
        <ForgotStep onBack={() => setStep('login')} />
      ) : (
        <form
          onSubmit={submit}
          className="w-88 flex flex-col gap-4 rounded-xl border border-neutral-800 bg-neutral-900 p-6"
        >
          <div className="text-center">
            <div className="text-2xl font-bold">postacim 🕊️</div>
            <p className="mt-1 text-xs text-neutral-500">
              uçtan uca şifreli sohbet — sunucu hiçbir şey göremez
            </p>
          </div>

          <label className="flex flex-col gap-1 text-sm">
            <span className="text-neutral-400">nick</span>
            <input
              value={nick}
              onChange={(e) => setNick(e.target.value)}
              placeholder="guvercin"
              autoComplete="username"
              required
              minLength={3}
              maxLength={24}
              className="rounded-md border border-neutral-700 bg-neutral-800 px-3 py-2 outline-none focus:border-neutral-500"
            />
          </label>

          <div className="flex flex-col gap-1 text-sm">
            <span className="text-neutral-400">şifre</span>
            <PasswordInput
              value={password}
              onChange={setPassword}
              placeholder="••••••••"
              showStrength={step === 'register'}
            />
          </div>

          {step === 'register' && (
            <>
              <div className="flex flex-col gap-1 text-sm">
                <span className="text-neutral-400">şifre (tekrar)</span>
                <PasswordInput value={password2} onChange={setPassword2} placeholder="••••••••" showStrength={false} />
                {password2.length > 0 && password !== password2 && (
                  <span className="text-[11px] text-red-400">şifreler eşleşmiyor</span>
                )}
              </div>

              <label className="flex items-start gap-2 rounded-md border border-amber-900/50 bg-amber-950/30 p-3 text-xs text-amber-200/90">
                <input
                  type="checkbox"
                  checked={ack}
                  onChange={(e) => setAck(e.target.checked)}
                  className="mt-0.5"
                />
                <span>
                  Şifremi kaybedersem <b>hesabım ve tüm geçmişim kurtarılamaz</b> — bunun için bir
                  kurtarma ifadesi kaydedeceğim.
                </span>
              </label>
              {ack && !ackReady && <p className="text-center text-[11px] text-neutral-500">biraz düşün…</p>}
            </>
          )}

          {error && <p className="rounded-md bg-red-950/50 px-3 py-2 text-sm text-red-400">{error}</p>}

          <button
            type="submit"
            disabled={busy || (step === 'register' && !canRegister)}
            className="rounded-md bg-indigo-600 py-2 font-medium hover:bg-indigo-500 disabled:opacity-50"
          >
            {busy
              ? 'anahtar türetiliyor…'
              : step === 'login'
                ? 'giriş yap'
                : 'kurtarma ifadesine geç →'}
          </button>

          <div className="flex items-center justify-between text-sm">
            <button
              type="button"
              onClick={() => {
                setStep(step === 'login' ? 'register' : 'login');
                setError(null);
              }}
              className="text-neutral-400 hover:text-neutral-200"
            >
              {step === 'login' ? 'hesabın yok mu? kayıt ol' : 'hesabın var mı? giriş yap'}
            </button>
            {step === 'login' && (
              <button
                type="button"
                onClick={() => {
                  setStep('forgot');
                  setError(null);
                }}
                className="text-xs text-neutral-500 hover:text-neutral-300"
              >
                şifremi unuttum
              </button>
            )}
          </div>
        </form>
      )}
    </div>
  );
}

// --- registration step 2: the recovery phrase ritual ---

function PhraseStep({ nick, password, onBack }: { nick: string; password: string; onBack: () => void }) {
  const register = useAuthStore((s) => s.register);
  const [phase, setPhase] = useState<'show' | 'quiz' | 'saved'>('show');
  // generated once, lives only in memory — the phrase never regenerates mid-ritual
  const [words, setWords] = useState<string[] | null>(null);
  useEffect(() => {
    void generateMnemonic().then(setWords);
  }, []);
  const [quiz] = useState(() => quizPositions());
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [downloaded, setDownloaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const quizOk =
    !!words &&
    quiz.every((i) => (answers[i] ?? '').trim().toLowerCase() === words[i]?.toLowerCase());

  const download = (): void => {
    if (!words) return;
    const txt =
      `postacim kurtarma ifadesi\n\n${words.join(' ')}\n\n` +
      `Bu 12 kelime hesabını geri getiren tek şeydir. Şifreni unuttuğunda\n` +
      `'şifremi unuttum' ekranından bu kelimeleri girerek yeni şifre kurarsın.\n` +
      `Kimselerle paylaşma. Ekran görüntüsü alma. Kağıda yaz, kilitli bir yerde sakla.\n`;
    const url = URL.createObjectURL(new Blob([txt], { type: 'text/plain' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'postacim-kurtarma.txt';
    a.click();
    URL.revokeObjectURL(url);
    setDownloaded(true);
  };

  const finish = async (): Promise<void> => {
    if (!words) return;
    setBusy(true);
    setError(null);
    try {
      const ok = await validateMnemonic(words);
      if (!ok) throw new Error('ifade doğrulanamadı — tekrar dene');
      await register(nick, password, words);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'kayıt başarısız');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="w-105 flex flex-col gap-4 rounded-xl border border-neutral-800 bg-neutral-900 p-6">
      <div className="text-center">
        <div className="text-lg font-bold">🗝️ Kurtarma ifaden</div>
        <p className="mt-1 text-xs text-neutral-500">
          şifreni kaybedersen hesabını geri getiren tek şey — şimdi kaydet
        </p>
      </div>

      {phase === 'show' && (
        <>
          <div className="grid grid-cols-3 gap-2">
            {(words ?? Array.from({ length: 12 }, () => '…')).map((w, i) => (
              <div
                key={i}
                className="flex items-baseline gap-1.5 rounded-md border border-neutral-800 bg-neutral-950/60 px-2 py-1.5"
              >
                <span className="text-[10px] text-neutral-600">{i + 1}</span>
                <span className="select-all font-mono text-sm">{w}</span>
              </div>
            ))}
          </div>
          <div className="flex gap-2">
            <button
              onClick={download}
              className="flex-1 rounded-md border border-neutral-700 py-1.5 text-sm text-neutral-300 hover:bg-neutral-800"
            >
              ⬇ metin dosyası olarak indir
            </button>
            <button
              onClick={() => setPhase('quiz')}
              disabled={!words}
              className="flex-1 rounded-md bg-indigo-600 py-1.5 text-sm font-medium hover:bg-indigo-500 disabled:opacity-50"
            >
              kaydettim, doğrula →
            </button>
          </div>
        </>
      )}

      {phase === 'quiz' && (
        <>
          <p className="text-center text-sm text-neutral-300">
            kaydettiğinden emin olalım — <b>{quiz.map((i) => i + 1).join(', ')}. kelimeleri</b> yaz:
          </p>
          <div className="flex flex-col gap-2">
            {quiz.map((i) => (
              <label key={i} className="flex items-center gap-2 text-sm">
                <span className="w-16 shrink-0 text-neutral-500">{i + 1}. kelime</span>
                <input
                  value={answers[i] ?? ''}
                  onChange={(e) => setAnswers((a) => ({ ...a, [i]: e.target.value }))}
                  className="flex-1 rounded-md border border-neutral-700 bg-neutral-800 px-3 py-1.5 font-mono text-sm outline-none focus:border-neutral-500"
                  autoComplete="off"
                  spellCheck={false}
                />
              </label>
            ))}
          </div>
          <button
            onClick={() => setPhase('saved')}
            disabled={!quizOk}
            className="rounded-md bg-indigo-600 py-1.5 text-sm font-medium hover:bg-indigo-500 disabled:opacity-50"
          >
            doğru — hesabımı oluştur
          </button>
          <button onClick={() => setPhase('show')} className="text-center text-xs text-neutral-500 hover:text-neutral-300">
            ← kelimelere geri dön
          </button>
        </>
      )}

      {phase === 'saved' && (
        <>
          <div className="rounded-md border border-emerald-900/50 bg-emerald-950/30 p-3 text-sm text-emerald-200/90">
            ✔ kayıt tamamlanıyor… kurtarma ifaden <b>{downloaded ? 'indirilen dosyada' : 'az önce yazdığın kelimelerde'}</b>.
          </div>
          {error && <p className="rounded-md bg-red-950/50 px-3 py-2 text-sm text-red-400">{error}</p>}
          <button
            onClick={() => void finish()}
            disabled={busy}
            className="rounded-md bg-indigo-600 py-2 font-medium hover:bg-indigo-500 disabled:opacity-50"
          >
            {busy ? 'anahtarlar türetiliyor…' : 'başla 🕊️'}
          </button>
        </>
      )}

      {error && phase !== 'saved' && (
        <p className="rounded-md bg-red-950/50 px-3 py-2 text-sm text-red-400">{error}</p>
      )}
      {phase !== 'saved' && (
        <button onClick={onBack} className="text-center text-xs text-neutral-500 hover:text-neutral-300">
          ← geri
        </button>
      )}
    </div>
  );
}

// --- "forgot password" flow ---

function ForgotStep({ onBack }: { onBack: () => void }) {
  const recoverLogin = useAuthStore((s) => s.recoverLogin);
  const [nick, setNick] = useState('');
  const [wordsText, setWordsText] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newPassword2, setNewPassword2] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const words = useMemo(
    () => wordsText.trim().split(/[\s,]+/).filter(Boolean),
    [wordsText],
  );
  const canGo =
    nick.trim().length >= 3 &&
    words.length === 12 &&
    newPassword.length >= 6 &&
    newPassword === newPassword2 &&
    passwordScore(newPassword) >= 2;

  const submit = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await recoverLogin(nick.trim(), words, newPassword);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'kurtarma başarısız');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="w-105 flex flex-col gap-4 rounded-xl border border-neutral-800 bg-neutral-900 p-6">
      <div className="text-center">
        <div className="text-lg font-bold">🔑 Şifremi unuttum</div>
        <p className="mt-1 text-xs text-neutral-500">
          kurtarma ifadesini gir — kimliğin ve geçmişin aynı kalır
        </p>
      </div>
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-neutral-400">nick</span>
        <input
          value={nick}
          onChange={(e) => setNick(e.target.value)}
          autoComplete="username"
          className="rounded-md border border-neutral-700 bg-neutral-800 px-3 py-2 outline-none focus:border-neutral-500"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-neutral-400">kurtarma ifadesi (12 kelime)</span>
        <textarea
          value={wordsText}
          onChange={(e) => setWordsText(e.target.value)}
          rows={2}
          placeholder="word1 word2 …"
          className="rounded-md border border-neutral-700 bg-neutral-800 px-3 py-2 font-mono text-sm outline-none focus:border-neutral-500"
          spellCheck={false}
        />
        {wordsText.trim().length > 0 && words.length !== 12 && (
          <span className="text-[11px] text-amber-400">{words.length}/12 kelime</span>
        )}
      </label>
      <div className="flex flex-col gap-1 text-sm">
        <span className="text-neutral-400">yeni şifre</span>
        <PasswordInput value={newPassword} onChange={setNewPassword} />
      </div>
      <div className="flex flex-col gap-1 text-sm">
        <span className="text-neutral-400">yeni şifre (tekrar)</span>
        <PasswordInput value={newPassword2} onChange={setNewPassword2} showStrength={false} />
      </div>
      {error && <p className="rounded-md bg-red-950/50 px-3 py-2 text-sm text-red-400">{error}</p>}
      <button
        onClick={() => void submit()}
        disabled={busy || !canGo}
        className="rounded-md bg-indigo-600 py-2 font-medium hover:bg-indigo-500 disabled:opacity-50"
      >
        {busy ? 'kimlik geri getiriliyor…' : 'şifreyi sıfırla ve gir'}
      </button>
      <button onClick={onBack} className="text-center text-xs text-neutral-500 hover:text-neutral-300">
        ← girişe dön
      </button>
    </div>
  );
}
