import { useEffect } from 'react';
import { useAppStore } from '../state/appStore';
import { useAuthStore } from '../state/authStore';
import { wsConnect, wsDisconnect } from '../ws/socket';
import ServerRail from './ServerRail';
import ChannelSidebar from './ChannelSidebar';
import MemberList from './MemberList';
import ChatView from './ChatView';
import { useChatStore } from '../state/chatStore';

export default function Shell() {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const loaded = useAppStore((s) => s.loaded);
  const loadBootstrap = useAppStore((s) => s.loadBootstrap);
  const wireEvents = useAppStore((s) => s.wireEvents);
  const channel = useAppStore((s) => s.activeChannel());

  useEffect(() => {
    wireEvents();
    useChatStore.getState().wire();
    const token = localStorage.getItem('pgv_token');
    if (token) wsConnect(token);
    void loadBootstrap();
    return () => wsDisconnect();
  }, [wireEvents, loadBootstrap]);

  return (
    <div className="flex h-screen flex-col bg-neutral-950 text-neutral-200">
      <header className="flex h-10 items-center justify-between border-b border-neutral-800/60 px-4">
        <span className="text-sm font-semibold">posta-guvercini 🕊️</span>
        <div className="flex items-center gap-3 text-sm">
          <span className="text-neutral-400">{user?.nick}</span>
          <button
            onClick={() => void logout()}
            className="rounded border border-neutral-700 px-2 py-0.5 text-xs text-neutral-300 hover:bg-neutral-800"
          >
            çıkış
          </button>
        </div>
      </header>
      <div className="flex min-h-0 flex-1">
        <ServerRail />
        <ChannelSidebar />
        <main className="flex min-w-0 flex-1 flex-col">
          {!loaded ? (
            <div className="flex flex-1 items-center justify-center text-neutral-600">yükleniyor…</div>
          ) : channel ? (
            channel.type === 'text' ? (
              <ChatView channelId={channel.id} channelName={channel.name} />
            ) : (
              <div className="flex flex-1 flex-col">
                <div className="border-b border-neutral-800/60 px-4 py-2 text-sm font-semibold text-neutral-300">
                  🔊 {channel.name}
                </div>
                <div className="flex flex-1 items-center justify-center text-sm text-neutral-600">
                  sesli/görüntülü oda yakında (faz 4)…
                </div>
              </div>
            )
          ) : (
            <div className="flex flex-1 items-center justify-center text-sm text-neutral-600">
              soldan bir topluluk ve oda seç
            </div>
          )}
        </main>
        <MemberList />
      </div>
    </div>
  );
}
