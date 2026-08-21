import { create } from 'zustand';
import { api } from '../api/client';
import type { ChatMessage } from '../api/types';
import { useAppStore } from './appStore';
import { decryptText, encryptText } from '../crypto/message';
import { onServerEvent } from '../ws/socket';

export interface DmDisplayMessage {
  id: number;
  channelId: string;
  senderId: string;
  nick: string;
  sentAt: number;
  body: string | null;
}

interface DmChatState {
  messages: Record<string, DmDisplayMessage[]>;
  hasMore: Record<string, boolean>;
  sending: boolean;
  loadHistory: (dmId: string) => Promise<void>;
  loadOlder: (dmId: string) => Promise<void>;
  send: (dmId: string, body: string) => Promise<void>;
  wire: () => void;
}

function toDisplay(raw: ChatMessage): DmDisplayMessage {
  const app = useAppStore.getState();
  const dm = app.dms.find((d) => d.id === raw.channel_id);
  const key = app.dmChannelKeys[raw.channel_id]?.[raw.key_version];
  if (!key) {
    return { id: raw.id, channelId: raw.channel_id, senderId: raw.sender_id, nick: raw.nick, sentAt: raw.sent_at, body: null };
  }
  try {
    return {
      id: raw.id,
      channelId: raw.channel_id,
      senderId: raw.sender_id,
      nick: raw.nick,
      sentAt: raw.sent_at,
      body: decryptText(raw.channel_id, raw.key_version, key, raw.nonce, raw.ciphertext, 'dm').body,
    };
  } catch {
    return { id: raw.id, channelId: raw.channel_id, senderId: raw.sender_id, nick: raw.nick, sentAt: raw.sent_at, body: null };
  }
}

const insertSorted = (list: DmDisplayMessage[], m: DmDisplayMessage): DmDisplayMessage[] => {
  if (list.some((x) => x.id === m.id)) return list;
  if (list.length === 0 || m.id > (list[list.length - 1]!.id)) return [...list, m];
  const next = [...list, m];
  next.sort((a, b) => a.id - b.id);
  return next;
};

export const useDmChatStore = create<DmChatState>((set, get) => ({
  messages: {},
  hasMore: {},
  sending: false,

  loadHistory: async (dmId) => {
    const res = await api<{ messages: ChatMessage[]; has_more: boolean }>(`/dms/${dmId}/messages?limit=50`);
    set((s) => ({
      messages: { ...s.messages, [dmId]: res.messages.map(toDisplay) },
      hasMore: { ...s.hasMore, [dmId]: res.has_more },
    }));
  },

  loadOlder: async (dmId) => {
    const list = get().messages[dmId] ?? [];
    const oldest = list[0]?.id;
    if (!oldest) return;
    const res = await api<{ messages: ChatMessage[]; has_more: boolean }>(
      `/dms/${dmId}/messages?before=${oldest}&limit=50`,
    );
    set((s) => ({
      messages: { ...s.messages, [dmId]: [...res.messages.map(toDisplay), ...(s.messages[dmId] ?? [])] },
      hasMore: { ...s.hasMore, [dmId]: res.has_more },
    }));
  },

  send: async (dmId, body) => {
    const app = useAppStore.getState();
    const dm = app.dms.find((d) => d.id === dmId);
    if (!dm) throw new Error('DM bulunamadı');
    const key = app.dmChannelKeys[dmId]?.[dm.key_version];
    if (!key) {
      // refetch bootstrap (peer may have opened the DM first) then retry once
      await app.loadBootstrap();
      const fresh = useAppStore.getState();
      const dm2 = fresh.dms.find((d) => d.id === dmId);
      const key2 = dm2 ? fresh.dmChannelKeys[dmId]?.[dm2.key_version] : undefined;
      if (!dm2 || !key2) throw new Error('DM anahtarı yok');
      const enc = encryptText(dmId, dm2.key_version, key2, body, 'dm');
      set({ sending: true });
      try {
        await api(`/dms/${dmId}/messages`, { method: 'POST', body: { key_version: dm2.key_version, ...enc } });
        return;
      } finally {
        set({ sending: false });
      }
    }
    const enc = encryptText(dmId, dm.key_version, key, body, 'dm');
    set({ sending: true });
    try {
      await api(`/dms/${dmId}/messages`, { method: 'POST', body: { key_version: dm.key_version, ...enc } });
    } finally {
      set({ sending: false });
    }
  },

  wire: () => {
    onServerEvent((e) => {
      if (e.type !== 'dm:message') return;
      const raw = e.message as ChatMessage;
      set((s) => ({
        messages: { ...s.messages, [raw.channel_id]: insertSorted(s.messages[raw.channel_id] ?? [], toDisplay(raw)) },
      }));
    });
  },
}));
