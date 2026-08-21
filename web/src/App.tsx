import { useEffect, useState } from 'react';
import { useAuthStore } from './state/authStore';
import Login from './components/Login';
import Shell from './components/Shell';
import JoinScreen from './components/JoinScreen';
import { ToastContainer } from './components/Toast';
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

  let screen: React.JSX.Element;
  if (status === 'loading') {
    screen = <div className="flex h-screen items-center justify-center bg-neutral-950 text-4xl">🕊️</div>;
  } else if (status !== 'authed') {
    screen = <Login />;
  } else if (invite) {
    screen = <JoinScreen invite={invite} />;
  } else {
    screen = <Shell />;
  }
  return (
    <>
      {screen}
      <ToastContainer />
    </>
  );
}
