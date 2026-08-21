import { create } from 'zustand';
import { api, ApiError } from '../api/client';
import type { ChatMessage } from '../api/types';
import { useAppStore } from './appStore';
import { useAuthStore } from './authStore';
import { decryptText, encryptText } from '../crypto/message';
import { onServerEvent } from '../ws/socket';

export interface DisplayMessage {
  id: number;
  channelId: string;
  senderId: string;
  nick: string;
  sentAt: number;
  /** null = ciphertext we cannot decrypt (missing epoch key) */
  body: string | null;
}

interface ChatState {
  messages: Record<string, DisplayMessage[]>;
  hasMore: Record<string, boolean>;
  sending: boolean;
  loadHistory: (channelId: string) => Promise<void>;
  loadOlder: (channelId: string) => Promise<void>;
  send: (channelId: string, body: string) => Promise<void>;
  wire: () => void;
}

function toDisplay(raw: ChatMessage): DisplayMessage {
  const app = useAppStore.getState();
  const key = app.channelKeys[raw.channel_id]?.[raw.key_version];
  if (!key) return { id: raw.id, channelId: raw.channel_id, senderId: raw.sender_id, nick: raw.nick, sentAt: raw.sent_at, body: null };
  try {
    return {
      id: raw.id,
      channelId: raw.channel_id,
      senderId: raw.sender_id,
      nick: raw.nick,
      sentAt: raw.sent_at,
      body: decryptText(raw.channel_id, raw.key_version, key, raw.nonce, raw.ciphertext).body,
    };
  } catch {
    return { id: raw.id, channelId: raw.channel_id, senderId: raw.sender_id, nick: raw.nick, sentAt: raw.sent_at, body: null };
  }
}

const insertSorted = (list: DisplayMessage[], m: DisplayMessage): DisplayMessage[] => {
  if (list.some((x) => x.id === m.id)) return list;
  if (list.length === 0 || m.id > (list[list.length - 1]!.id)) return [...list, m];
  const next = [...list, m];
  next.sort((a, b) => a.id - b.id);
  return next;
};

export const useChatStore = create<ChatState>((set, get) => ({
  messages: {},
  hasMore: {},
  sending: false,

  loadHistory: async (channelId) => {
    const res = await api<{ messages: ChatMessage[]; has_more: boolean }>(
      `/channels/${channelId}/messages?limit=50`,
    );
    set((s) => ({
      messages: { ...s.messages, [channelId]: res.messages.map(toDisplay) },
      hasMore: { ...s.hasMore, [channelId]: res.has_more },
    }));
  },

  loadOlder: async (channelId) => {
    const list = get().messages[channelId] ?? [];
    const oldest = list[0]?.id;
    if (!oldest) return;
    const res = await api<{ messages: ChatMessage[]; has_more: boolean }>(
      `/channels/${channelId}/messages?before=${oldest}&limit=50`,
    );
    set((s) => ({
      messages: {
        ...s.messages,
        [channelId]: [...res.messages.map(toDisplay), ...(s.messages[channelId] ?? [])],
      },
      hasMore: { ...s.hasMore, [channelId]: res.has_more },
    }));
  },

  send: async (channelId, body) => {
    const app = useAppStore.getState();
    const ch = app.communities.flatMap((c) => c.channels).find((c) => c.id === channelId);
    if (!ch) throw new Error('kanal bulunamadı');
    let key = app.currentKey(channelId);
    let version = ch.key_version;
    if (!key) {
      key = await app.ensureChannelKey(channelId);
      const fresh = useAppStore.getState().communities.flatMap((c) => c.channels).find((c) => c.id === channelId);
      version = fresh?.key_version ?? version;
    }

    set({ sending: true });
    try {
      // encrypt + POST; on 409 (key rotated mid-flight) refresh keys and retry once
      for (let attempt = 0; ; attempt++) {
        const enc = encryptText(channelId, version, key, body);
        try {
          await api(`/channels/${channelId}/messages`, {
            method: 'POST',
            body: { key_version: version, ...enc },
          });
          return;
        } catch (err) {
          if (err instanceof ApiError && err.status === 409 && attempt === 0) {
            await useAppStore.getState().loadBootstrap();
            const app2 = useAppStore.getState();
            const fresh = app2.communities.flatMap((c) => c.channels).find((c) => c.id === channelId);
            key = app2.currentKey(channelId);
            if (!fresh || !key) throw err;
            version = fresh.key_version;
            continue;
          }
          throw err;
        }
      }
    } finally {
      set({ sending: false });
    }
  },

  wire: () => {
    onServerEvent((e) => {
      if (e.type !== 'message:new') return;
      const raw = e.message as ChatMessage;
      const display = toDisplay(raw);
      set((s) => ({
        messages: { ...s.messages, [raw.channel_id]: insertSorted(s.messages[raw.channel_id] ?? [], display) },
      }));
      // opportunistic: if we lack this epoch's key (recent rotation), fetch it once
      const app = useAppStore.getState();
      if (display.body === null && !app.channelKeys[raw.channel_id]?.[raw.key_version]) {
        void app.loadBootstrap();
      }
    });
  },
}));

export const amSender = (m: DisplayMessage): boolean =>
  m.senderId === useAuthStore.getState().user?.id;
