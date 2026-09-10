import { useEffect, useState } from 'react';
import { useJoinStore } from '../state/joinStore';
import type { ParsedInvite } from '../crypto/invite';
import { PigeonMark } from './Brand';

export default function JoinScreen({ invite }: { invite: ParsedInvite }) {
  const status = useJoinStore((s) => s.status);
  const error = useJoinStore((s) => s.error);
  const communityName = useJoinStore((s) => s.communityName);
  const start = useJoinStore((s) => s.start);
  const complete = useJoinStore((s) => s.complete);
  const submitPassword = useJoinStore((s) => s.submitPassword);
  const [password, setPassword] = useState('');
  const [pwBusy, setPwBusy] = useState(false);

  useEffect(() => {
    void start(invite.code, invite.ephPriv);
  }, [invite, start]);

  useEffect(() => {
    if (status === 'joined') {
      location.hash = '';
      useJoinStore.getState().reset();
    }
  }, [status]);

  return (
    <div className="flex h-screen items-center justify-center bg-night-950 px-4 text-paper-100">
      <div className="w-full max-w-96 rounded-lg border border-brass-700/70 bg-night-900 p-6 text-center shadow-[0_18px_50px_-12px_rgba(0,0,0,0.8)]">
        <div className="mb-5 flex items-center justify-center gap-2.5 border-b border-night-700 pb-4">
          <PigeonMark size={22} className="text-lamp-500" />
          <span className="plate !text-sm !tracking-[0.2em] text-paper-100">DAVET</span>
        </div>
        {status === 'loading' && <p className="mt-4 text-sm text-paper-500">davet kontrol ediliyor…</p>}
        {status === 'idle' && error && (
          <p className="mt-4 rounded-md border border-stamp-500/60 bg-stamp-100 px-3 py-2 text-sm text-stamp-400">{error}</p>
        )}
        {(status === 'ready' || status === 'joining') && (
          <div className="mt-4 flex flex-col gap-4">
            <p className="text-sm">
              <span className="font-semibold text-paper-50">{communityName}</span> topluluğuna katılıyorsun
            </p>
            <p className="text-xs text-paper-500">
              kanal anahtarları davet linkinden çözülüp kendi kimliğine sarılacak — sunucu yalnızca sarılı
              kutuları görür
            </p>
            {error && <p className="text-sm text-stamp-400">{error}</p>}
            <button onClick={() => void complete()} disabled={status === 'joining'} className="btn-lamp w-full">
              {status === 'joining' ? 'katılınıyor…' : 'katıl'}
            </button>
          </div>
        )}
        {status === 'needs_password' && (
          <div className="mt-4 flex flex-col gap-3">
            <p className="text-sm">
              <span className="font-semibold text-paper-50">{communityName}</span> topluluğu katılım şifresi istiyor
            </p>
            <input
              type="password"
              autoFocus
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) =>
                password &&
                e.key === 'Enter' &&
                void (async () => {
                  setPwBusy(true);
                  await submitPassword(password);
                  setPwBusy(false);
                })()
              }
              placeholder="katılım şifresi"
              className="input"
            />
            {error && <p className="text-sm text-stamp-400">{error}</p>}
            <button
              onClick={() => {
                setPwBusy(true);
                void submitPassword(password).finally(() => setPwBusy(false));
              }}
              disabled={pwBusy || !password}
              className="btn-lamp w-full"
            >
              {pwBusy ? 'doğrulanıyor…' : 'devam'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
