import { useEffect } from 'react';
import { useJoinStore } from '../state/joinStore';
import type { ParsedInvite } from '../crypto/invite';

export default function JoinScreen({ invite }: { invite: ParsedInvite }) {
  const status = useJoinStore((s) => s.status);
  const error = useJoinStore((s) => s.error);
  const communityName = useJoinStore((s) => s.communityName);
  const start = useJoinStore((s) => s.start);
  const complete = useJoinStore((s) => s.complete);

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
    <div className="flex h-screen items-center justify-center bg-neutral-950 text-neutral-200">
      <div className="w-96 rounded-xl border border-neutral-800 bg-neutral-900 p-6 text-center">
        <div className="text-2xl font-bold">postacim 🕊️</div>
        {status === 'loading' && <p className="mt-4 text-sm text-neutral-500">davet kontrol ediliyor…</p>}
        {status === 'idle' && error && (
          <p className="mt-4 rounded-md bg-red-950/50 px-3 py-2 text-sm text-red-400">{error}</p>
        )}
        {(status === 'ready' || status === 'joining') && (
          <div className="mt-4 flex flex-col gap-4">
            <p className="text-sm">
              <span className="font-semibold">{communityName}</span> topluluğuna katılıyorsun
            </p>
            <p className="text-xs text-neutral-500">
              kanal anahtarları davet linkinden çözülüp kendi kimliğine sarılacak — sunucu yalnızca
              sarılı kutuları görür
            </p>
            {error && <p className="text-sm text-red-400">{error}</p>}
            <button
              onClick={() => void complete()}
              disabled={status === 'joining'}
              className="rounded-md bg-indigo-600 py-2 text-sm font-medium hover:bg-indigo-500 disabled:opacity-50"
            >
              {status === 'joining' ? 'katılınıyor…' : 'katıl'}
            </button>
          </div>
        )}
        {status === 'needs_password' && (
          <p className="mt-4 text-sm text-amber-400">bu topluluk katılım şifresi istiyor (yakında)</p>
        )}
      </div>
    </div>
  );
}
