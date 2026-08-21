import { useState } from 'react';
import type { FormEvent } from 'react';
import { useAuthStore } from '../state/authStore';

export default function Login() {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [nick, setNick] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const login = useAuthStore((s) => s.login);
  const register = useAuthStore((s) => s.register);

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (mode === 'login') await login(nick.trim(), password);
      else await register(nick.trim(), password);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'bir hata oluştu');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-screen items-center justify-center bg-neutral-950 text-neutral-200">
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

        <label className="flex flex-col gap-1 text-sm">
          <span className="text-neutral-400">şifre</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            required
            minLength={6}
            className="rounded-md border border-neutral-700 bg-neutral-800 px-3 py-2 outline-none focus:border-neutral-500"
          />
        </label>

        {error && <p className="rounded-md bg-red-950/50 px-3 py-2 text-sm text-red-400">{error}</p>}

        <button
          type="submit"
          disabled={busy}
          className="rounded-md bg-indigo-600 py-2 font-medium hover:bg-indigo-500 disabled:opacity-50"
        >
          {busy ? 'anahtar türetiliyor…' : mode === 'login' ? 'giriş yap' : 'kayıt ol'}
        </button>

        <button
          type="button"
          onClick={() => {
            setMode(mode === 'login' ? 'register' : 'login');
            setError(null);
          }}
          className="text-center text-sm text-neutral-400 hover:text-neutral-200"
        >
          {mode === 'login' ? 'hesabın yok mu? kayıt ol' : 'hesabın var mı? giriş yap'}
        </button>
      </form>
    </div>
  );
}
