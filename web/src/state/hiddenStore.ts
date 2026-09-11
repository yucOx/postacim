import { create } from 'zustand';

// "benim için sil" — purely local hiding; the server never learns what you hid.
const KEY = 'pgv_hidden_msgs';

function load(): Record<string, number[]> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, number[]>;
  } catch {
    return {};
  }
}

interface HiddenState {
  /** channel id -> hidden message ids */
  hidden: Record<string, number[]>;
  hideForMe: (channelId: string, messageId: number) => void;
}

export const useHiddenStore = create<HiddenState>((set) => ({
  hidden: load(),
  hideForMe: (channelId, messageId) => {
    set((s) => {
      const cur = s.hidden[channelId] ?? [];
      if (cur.includes(messageId)) return s;
      const next = { ...s.hidden, [channelId]: [...cur, messageId] };
      localStorage.setItem(KEY, JSON.stringify(next));
      return { hidden: next };
    });
  },
}));

// stable ref: `?? []` in a zustand selector recreates it each call and loops React 19 (#185)
export const NO_HIDDEN: number[] = [];
