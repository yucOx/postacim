import { useEffect, useState } from 'react';
import { useAuthStore } from './state/authStore';
import Login from './components/Login';
import Shell from './components/Shell';
import JoinScreen from './components/JoinScreen';
import { parseInviteLink, type ParsedInvite } from './crypto/invite';

export default function App() {
  const status = useAuthStore((s) => s.status);
  const restore = useAuthStore((s) => s.restore);
  const [invite, setInvite] = useState<ParsedInvite | null>(() => parseInviteLink(location.hash));

  useEffect(() => {
    void restore();
  }, [restore]);

  useEffect(() => {
    const onHash = (): void => setInvite(parseInviteLink(location.hash));
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  if (status === 'loading') {
    return (
      <div className="flex h-screen items-center justify-center bg-neutral-950 text-4xl">🕊️</div>
    );
  }
  if (status !== 'authed') return <Login />;
  if (invite) return <JoinScreen invite={invite} />;
  return <Shell />;
}
