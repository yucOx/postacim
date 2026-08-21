import { create } from 'zustand';

// Read markers live client-side only — the server never learns what you opened.
const KEY = 'pgv_read';

function load(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, number>;
  } catch {
    return {};
  }
}

interface UnreadState {
  readMap: Record<string, number>;
  markRead: (channelId: string, messageId: number) => void;
}

export const useUnreadStore = create<UnreadState>((set) => ({
  readMap: load(),
  markRead: (channelId, messageId) => {
    set((s) => {
      if ((s.readMap[channelId] ?? 0) >= messageId) return s;
      const next = { ...s.readMap, [channelId]: messageId };
      localStorage.setItem(KEY, JSON.stringify(next));
      return { readMap: next };
    });
  },
}));

/** count of known messages newer than the read marker (live session accuracy) */
export const unreadCount = (channelId: string, messages: { id: number }[] | undefined): number => {
  if (!messages?.length) return 0;
  const read = useUnreadStore.getState().readMap[channelId] ?? 0;
  return messages.filter((m) => m.id > read).length;
};
