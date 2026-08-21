import { useAuthStore } from '../state/authStore';

export default function Shell() {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  return (
    <div className="flex h-screen flex-col bg-neutral-950 text-neutral-200">
      <header className="flex items-center justify-between border-b border-neutral-800 px-4 py-2">
        <span className="font-semibold">posta-guvercini 🕊️</span>
        <div className="flex items-center gap-3 text-sm">
          <span className="text-neutral-400">{user?.nick}</span>
          <button
            onClick={() => void logout()}
            className="rounded-md border border-neutral-700 px-2 py-1 text-neutral-300 hover:bg-neutral-800"
          >
            çıkış
          </button>
        </div>
      </header>
      <div className="flex flex-1 items-center justify-center text-neutral-600">
        topluluklar yakında (faz 2)…
      </div>
    </div>
  );
}
