import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { EyeOff, KeyRound, ServerOff, ShieldCheck } from 'lucide-react';
import { useAuthStore } from '../state/authStore';
import { generateMnemonic, quizPositions, validateMnemonic } from '../crypto/bip39';
import PasswordInput, { passwordScore } from './PasswordInput';
import Turnstile, { turnstileEnabled } from './Turnstile';
import { PigeonMark, Postmark, SealMark } from './Brand';

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
  // Turnstile tokens are single-use: a failed attempt burns the token, so the
  // widget is remounted (key=attempt) to mint a fresh one for the next try.
  const [tsToken, setTsToken] = useState<string | null>(null);
  const [tsAttempt, setTsAttempt] = useState(0);
  const tsNeeded = turnstileEnabled() && !tsToken;
  const status = useAuthStore((s) => s.status);
  const sessionNick = useAuthStore((s) => s.user?.nick ?? '');
  const login = useAuthStore((s) => s.login);
  const register = useAuthStore((s) => s.register);

  // reload with a live session: password-only card, the nick is already known
  if (status === 'needs_password') return <ReauthStep nick={sessionNick} />;

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
      if (step === 'login') await login(nick.trim(), password, tsToken ?? undefined);
      else setStep('phrase'); // phrase screen finishes registration
    } catch (err) {
      setError(err instanceof Error ? err.message : 'bir hata oluştu');
      setTsToken(null); // token consumed server-side — force a fresh challenge
      setTsAttempt((a) => a + 1);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-10 bg-night-950 px-4 py-10 text-paper-100 lg:flex-row lg:gap-20">
      {step === 'phrase' ? (
        <PhraseStep
          nick={nick.trim()}
          password={password}
          tsToken={tsToken}
          clearTsToken={() => setTsToken(null)}
          onBack={() => setStep('register')}
        />
      ) : step === 'forgot' ? (
        <ForgotStep onBack={() => setStep('login')} />
      ) : (
        <>
          {/* vagon kapısı — the brand face; the promise in plain words */}
          <div className="flex max-w-md flex-col items-center text-center lg:items-start lg:text-left">
            <div className="text-brass-400">
              <SealMark size={128} />
            </div>
            <h1 className="mt-4 font-display text-6xl font-bold uppercase tracking-[0.08em] text-paper-50">
              postacim
            </h1>
            <p className="mt-2 max-w-xs text-sm text-paper-500">
              güvercinler gece uçar — mesajın da seninle gizli taşınır
            </p>
            <ul className="mt-6 flex flex-col gap-2.5 text-sm text-paper-300">
              <li className="flex items-center gap-2.5">
                <ShieldCheck size={16} className="shrink-0 text-lamp-500" />
                mesajlar ve aramalar uçtan uca şifreli
              </li>
              <li className="flex items-center gap-2.5">
                <ServerOff size={16} className="shrink-0 text-lamp-500" />
                sunucu içeriği asla göremez — yalnızca sarılı kutular
              </li>
              <li className="flex items-center gap-2.5">
                <EyeOff size={16} className="shrink-0 text-lamp-500" />
                okundu bilgisi cihazından çıkmaz
              </li>
            </ul>
          </div>

          {/* posta senedi — the form card, stamped */}
          <form
            onSubmit={submit}
            className="relative w-full max-w-88 rounded-lg border border-brass-700/70 bg-night-900 p-6 shadow-[0_18px_50px_-12px_rgba(0,0,0,0.8)]"
          >
            <div className="animate-stamp absolute -right-3 -top-3 rotate-12 text-lamp-500" aria-hidden>
              <Postmark />
            </div>
            <div className="mb-5 flex items-center gap-2.5 border-b border-night-700 pb-4">
              <PigeonMark size={22} className="text-lamp-500" />
              <div>
                <div className="plate !text-sm !tracking-[0.2em] text-paper-100">
                  {step === 'login' ? 'GİRİŞ' : 'KAYIT'}
                </div>
                <p className="mt-0.5 text-[11px] text-paper-500">
                  sunucu hiçbir şey göremez
                </p>
              </div>
            </div>

            <div className="flex flex-col gap-4">
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-paper-300">nick</span>
                <input
                  value={nick}
                  onChange={(e) => setNick(e.target.value)}
                  placeholder="guvercin"
                  autoComplete="username"
                  required
                  minLength={3}
                  maxLength={24}
                  className="input"
                />
              </label>

              <div className="flex flex-col gap-1 text-sm">
                <span className="text-paper-300">şifre</span>
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
                    <span className="text-paper-300">şifre (tekrar)</span>
                    <PasswordInput value={password2} onChange={setPassword2} placeholder="••••••••" showStrength={false} />
                    {password2.length > 0 && password !== password2 && (
                      <span className="text-[11px] text-stamp-400">şifreler eşleşmiyor</span>
                    )}
                  </div>

                  <label className="flex items-start gap-2.5 rounded-md border border-lamp-600/50 bg-lamp-100/60 p-3 text-xs text-lamp-300">
                    <input
                      type="checkbox"
                      checked={ack}
                      onChange={(e) => setAck(e.target.checked)}
                      className="mt-0.5 accent-lamp-500"
                    />
                    <span>
                      Şifremi kaybedersem <b className="text-paper-100">hesabım ve tüm geçmişim kurtarılamaz</b> — bunun
                      için bir kurtarma ifadesi kaydedeceğim.
                    </span>
                  </label>
                  {ack && !ackReady && <p className="text-center text-[11px] text-paper-500">biraz düşün…</p>}
                </>
              )}

              {error && (
                <p className="rounded-md border border-stamp-500/60 bg-stamp-100 px-3 py-2 text-sm text-stamp-400">{error}</p>
              )}

              {turnstileEnabled() && <Turnstile key={tsAttempt} onToken={setTsToken} />}

              <button
                type="submit"
                disabled={busy || tsNeeded || (step === 'register' && !canRegister)}
                className="btn-lamp w-full"
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
                  className="text-paper-500 transition-colors hover:text-paper-100"
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
                    className="flex items-center gap-1 text-xs text-paper-500 transition-colors hover:text-paper-300"
                  >
                    <KeyRound size={12} />
                    şifremi unuttum
                  </button>
                )}
              </div>
            </div>
          </form>
        </>
      )}
    </div>
  );
}

// --- reload re-auth: session cookie alive, KEK gone with the old tab ---

function ReauthStep({ nick }: { nick: string }) {
  const reauthenticate = useAuthStore((s) => s.reauthenticate);
  const logout = useAuthStore((s) => s.logout);
  const [password, setPassword] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await reauthenticate(password);
    } catch (err) {
      // wrong password only fails locally — the session stays valid, so the
      // user stays here and can retry
      setError(err instanceof Error ? err.message : 'bir hata oluştu');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-10 bg-night-950 px-4 py-10 text-paper-100">
      <div className="text-brass-400">
        <SealMark size={96} />
      </div>
      <form
        onSubmit={submit}
        className="w-full max-w-88 rounded-lg border border-brass-700/70 bg-night-900 p-6 shadow-[0_18px_50px_-12px_rgba(0,0,0,0.8)]"
      >
        <div className="mb-5 flex items-center gap-2.5 border-b border-night-700 pb-4">
          <PigeonMark size={22} className="text-lamp-500" />
          <div>
            <div className="plate !text-sm !tracking-[0.2em] text-paper-100">TEKRAR GİRİŞ</div>
            <p className="mt-0.5 text-[11px] text-paper-500">
              oturumun hâlâ açık — anahtarın için şifren gerekiyor
            </p>
          </div>
        </div>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1 text-sm">
            <span className="text-paper-300">nick</span>
            <div className="input select-all">{nick}</div>
          </div>
          <div className="flex flex-col gap-1 text-sm">
            <span className="text-paper-300">şifre</span>
            <PasswordInput
              value={password}
              onChange={setPassword}
              placeholder="••••••••"
              showStrength={false}
              autoComplete="current-password"
              autoFocus
            />
          </div>
          {error && (
            <p className="rounded-md border border-stamp-500/60 bg-stamp-100 px-3 py-2 text-sm text-stamp-400">{error}</p>
          )}
          <button type="submit" disabled={busy || !password} className="btn-lamp w-full">
            {busy ? 'anahtar türetiliyor…' : 'giriş yap'}
          </button>
          <button
            type="button"
            onClick={() => void logout()}
            disabled={busy}
            className="w-full text-center text-xs text-paper-500 transition-colors hover:text-paper-300"
          >
            bu hesap değil — başka hesapla gir
          </button>
        </div>
      </form>
    </div>
  );
}

// --- registration step 2: the recovery phrase ritual ---

function PhraseStep({
  nick,
  password,
  tsToken,
  clearTsToken,
  onBack,
}: {
  nick: string;
  password: string;
  tsToken: string | null;
  clearTsToken: () => void;
  onBack: () => void;
}) {
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
      await register(nick, password, words, tsToken ?? undefined);
    } catch (err) {
      // a burned Turnstile token (or any failure) → main form remints one
      setError(err instanceof Error ? err.message : 'kayıt başarısız');
      clearTsToken();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="w-full max-w-105 rounded-lg border border-brass-700/70 bg-night-900 p-6 shadow-[0_18px_50px_-12px_rgba(0,0,0,0.8)]">
      <div className="mb-5 flex items-center gap-2.5 border-b border-night-700 pb-4">
        <KeyRound size={18} className="text-lamp-500" />
        <div>
          <div className="plate !text-sm !tracking-[0.2em] text-paper-100">KURTARMA İFADESİ</div>
          <p className="mt-0.5 text-[11px] text-paper-500">
            şifreni kaybedersen hesabını geri getiren tek şey — şimdi kaydet
          </p>
        </div>
      </div>

      {phase === 'show' && (
        <>
          <div className="grid grid-cols-3 gap-2">
            {(words ?? Array.from({ length: 12 }, () => '…')).map((w, i) => (
              <div
                key={i}
                className="flex items-baseline gap-1.5 rounded-sm border border-brass-700/40 bg-paper-50 px-2 py-1.5 text-night-950"
              >
                <span className="font-display text-[10px] font-semibold text-brass-700">{i + 1}</span>
                <span className="select-all font-mono text-[13px] font-medium">{w}</span>
              </div>
            ))}
          </div>
          <div className="mt-4 flex gap-2">
            <button onClick={download} className="btn-ghost flex-1">
              indir
            </button>
            <button onClick={() => setPhase('quiz')} disabled={!words} className="btn-lamp flex-1">
              kaydettim, doğrula →
            </button>
          </div>
        </>
      )}

      {phase === 'quiz' && (
        <>
          <p className="text-center text-sm text-paper-300">
            kaydettiğinden emin olalım — <b className="text-paper-100">{quiz.map((i) => i + 1).join(', ')}.</b> kelimeleri yaz:
          </p>
          <div className="mt-4 flex flex-col gap-2">
            {quiz.map((i) => (
              <label key={i} className="flex items-center gap-2 text-sm">
                <span className="w-16 shrink-0 text-paper-500">{i + 1}. kelime</span>
                <input
                  value={answers[i] ?? ''}
                  onChange={(e) => setAnswers((a) => ({ ...a, [i]: e.target.value }))}
                  className="input font-mono"
                  autoComplete="off"
                  spellCheck={false}
                />
              </label>
            ))}
          </div>
          <button onClick={() => setPhase('saved')} disabled={!quizOk} className="btn-lamp mt-4 w-full">
            doğru — hesabımı oluştur
          </button>
          <button
            onClick={() => setPhase('show')}
            className="mt-3 w-full text-center text-xs text-paper-500 transition-colors hover:text-paper-300"
          >
            ← kelimelere geri dön
          </button>
        </>
      )}

      {phase === 'saved' && (
        <>
          <div className="rounded-md border border-lamp-600/60 bg-lamp-100/60 p-3 text-sm text-lamp-300">
            kayıt tamamlanıyor — kurtarma ifaden{' '}
            <b className="text-paper-100">{downloaded ? 'indirilen dosyada' : 'az önce yazdığın kelimelerde'}</b>.
          </div>
          {error && (
            <p className="mt-3 rounded-md border border-stamp-500/60 bg-stamp-100 px-3 py-2 text-sm text-stamp-400">{error}</p>
          )}
          <button onClick={() => void finish()} disabled={busy} className="btn-lamp mt-4 w-full">
            {busy ? 'anahtarlar türetiliyor…' : 'başla'}
          </button>
        </>
      )}

      {error && phase !== 'saved' && (
        <p className="rounded-md border border-stamp-500/60 bg-stamp-100 px-3 py-2 text-sm text-stamp-400">{error}</p>
      )}
      {phase !== 'saved' && (
        <button
          onClick={onBack}
          className="mt-4 w-full text-center text-xs text-paper-500 transition-colors hover:text-paper-300"
        >
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
    <div className="w-full max-w-105 rounded-lg border border-brass-700/70 bg-night-900 p-6 shadow-[0_18px_50px_-12px_rgba(0,0,0,0.8)]">
      <div className="mb-5 flex items-center gap-2.5 border-b border-night-700 pb-4">
        <KeyRound size={18} className="text-lamp-500" />
        <div>
          <div className="plate !text-sm !tracking-[0.2em] text-paper-100">ŞİFREMİ UNUTTUM</div>
          <p className="mt-0.5 text-[11px] text-paper-500">
            kurtarma ifadesini gir — kimliğin ve geçmişin aynı kalır
          </p>
        </div>
      </div>
      <div className="flex flex-col gap-4">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-paper-300">nick</span>
          <input value={nick} onChange={(e) => setNick(e.target.value)} autoComplete="username" className="input" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-paper-300">kurtarma ifadesi (12 kelime)</span>
          <textarea
            value={wordsText}
            onChange={(e) => setWordsText(e.target.value)}
            rows={2}
            placeholder="word1 word2 …"
            className="input font-mono"
            spellCheck={false}
          />
          {wordsText.trim().length > 0 && words.length !== 12 && (
            <span className="text-[11px] text-lamp-500">{words.length}/12 kelime</span>
          )}
        </label>
        <div className="flex flex-col gap-1 text-sm">
          <span className="text-paper-300">yeni şifre</span>
          <PasswordInput value={newPassword} onChange={setNewPassword} />
        </div>
        <div className="flex flex-col gap-1 text-sm">
          <span className="text-paper-300">yeni şifre (tekrar)</span>
          <PasswordInput value={newPassword2} onChange={setNewPassword2} showStrength={false} />
        </div>
        {error && (
          <p className="rounded-md border border-stamp-500/60 bg-stamp-100 px-3 py-2 text-sm text-stamp-400">{error}</p>
        )}
        <button onClick={() => void submit()} disabled={busy || !canGo} className="btn-lamp w-full">
          {busy ? 'kimlik geri getiriliyor…' : 'şifreyi sıfırla ve gir'}
        </button>
        <button
          onClick={onBack}
          className="w-full text-center text-xs text-paper-500 transition-colors hover:text-paper-300"
        >
          ← girişe dön
        </button>
      </div>
    </div>
  );
}
