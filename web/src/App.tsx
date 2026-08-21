import { useEffect } from 'react';
import { useAuthStore } from './state/authStore';
import Login from './components/Login';
import Shell from './components/Shell';

export default function App() {
  const status = useAuthStore((s) => s.status);
  const restore = useAuthStore((s) => s.restore);

  useEffect(() => {
    void restore();
  }, [restore]);

  if (status === 'loading') {
    return (
      <div className="flex h-screen items-center justify-center bg-neutral-950 text-4xl">🕊️</div>
    );
  }
  return status === 'authed' ? <Shell /> : <Login />;
}
