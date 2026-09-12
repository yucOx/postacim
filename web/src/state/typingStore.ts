// Ephemeral "yazıyor…" state. Entries live 4s max: a fresh WS event refreshes
// the timestamp, a setTimeout prunes whatever stopped refreshing.
import { create } from 'zustand';
import { onServerEvent } from '../ws/socket';
import { useAuthStore } from './authStore';

export const TYPING_TTL = 4000;

interface Typer {
  nick: string;
  at: number;
}
interface TypingState {
  byChannel: Record<string, Record<string, Typer>>;
  wire: () => void;
}

export const useTypingStore = create<TypingState>((set) => ({
  byChannel: {},

  wire: () => {
    onServerEvent((e) => {
      if (e.type !== 'channel:typing') return;
      const channelId = e.channel_id as string;
      const user = e.user as { id: string; nick: string };
      if (user.id === useAuthStore.getState().user?.id) return;
      set((s) => ({
        byChannel: {
          ...s.byChannel,
          [channelId]: { ...(s.byChannel[channelId] ?? {}), [user.id]: { nick: user.nick, at: Date.now() } },
        },
      }));
      // prune a typer that stopped refreshing (fires well past the TTL)
      setTimeout(
        () =>
          set((s) => {
            const cur = s.byChannel[channelId]?.[user.id];
            if (!cur || Date.now() - cur.at < TYPING_TTL) return s;
            const next = { ...(s.byChannel[channelId] ?? {}) };
            delete next[user.id];
            return { byChannel: { ...s.byChannel, [channelId]: next } };
          }),
        TYPING_TTL + 1000,
      );
    });
  },
}));

/** fresh typer nicks for a channel (render-time filter — stale ones vanish) */
export const typersIn = (channelId: string): string[] => {
  const map = useTypingStore.getState().byChannel[channelId];
  if (!map) return [];
  const now = Date.now();
  return Object.values(map)
    .filter((t) => now - t.at < TYPING_TTL)
    .map((t) => t.nick);
};