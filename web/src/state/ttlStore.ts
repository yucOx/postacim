import { create } from 'zustand';

// Kaybolan mesajlar — composer TTL seçimi kanal/DM başına hatırlanır.
// Tercih cihazda kalır (localStorage); sunucu tercih listesini değil, yalnız
// gönderilen her mesajın expires_at'ını görür (metadata — bkz. PRIVACY.md).
const KEY = 'pgv_msg_ttl';

function load(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, number>;
  } catch {
    return {};
  }
}

export const TTL_OFF = 0;

interface TtlState {
  /** channel id -> saniye (0 = kapalı) */
  ttl: Record<string, number>;
  setTtl: (channelId: string, seconds: number) => void;
}

export const useTtlStore = create<TtlState>((set) => ({
  ttl: load(),
  setTtl: (channelId, seconds) => {
    set((s) => {
      const next = { ...s.ttl, [channelId]: seconds };
      localStorage.setItem(KEY, JSON.stringify(next));
      return { ttl: next };
    });
  },
}));

/** gönderim sırasında okunur (hook'suz) — 0 = TTL kapalı */
export const ttlSeconds = (channelId: string): number =>
  useTtlStore.getState().ttl[channelId] ?? TTL_OFF;