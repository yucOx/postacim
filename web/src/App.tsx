import { useEffect, useState } from 'react';
import { useAuthStore } from './state/authStore';
import { useAppStore } from './state/appStore';
import Login from './components/Login';
import Shell from './components/Shell';
import JoinScreen from './components/JoinScreen';
import { ToastContainer } from './components/Toast';
import { SealMark } from './components/Brand';
import { parseInviteLink, type ParsedInvite } from './crypto/invite';
import { writeRoute } from './router';

export default function App() {
  const status = useAuthStore((s) => s.status);
  const restore = useAuthStore((s) => s.restore);
  const [invite, setInvite] = useState<ParsedInvite | null>(() => parseInviteLink(location.hash));

  // mirror the in-app view into the URL slug — F5 (after re-auth) lands back
  // in the same conversation
  useEffect(
    () =>
      useAppStore.subscribe((s) =>
        writeRoute(s.view, s.activeDmId, s.activeChannelId),
      ),
    [],
  );

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
    screen = (
      <div className="flex h-screen items-center justify-center bg-night-950">
        <div className="animate-pulse text-brass-600">
          <SealMark size={96} text="POSTACIM · GECE POSTASI · " />
        </div>
      </div>
    );
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
