import { create } from 'zustand';
import { api } from '../api/client';
import type { ChatMessage } from '../api/types';
import { useAppStore } from './appStore';
import { decryptText, encryptText, type MsgScope } from '../crypto/message';
import { playPop } from '../lib/sound';
import { onServerEvent } from '../ws/socket';

// dm channel ids are prefixed dm_/gdm_ — the kind picks endpoint + AAD scope
const kindOf = (channelId: string): MsgScope => (channelId.startsWith('gdm_') ? 'gdm' : 'dm');
const baseOf = (channelId: string): string => (kindOf(channelId) === 'gdm' ? '/gdms' : '/dms');

function keyFor(channelId: string): { version: number; key: Uint8Array } | null {
  const app = useAppStore.getState();
  const info =
    app.dms.find((d) => d.id === channelId) ??
    app.gdms.find((g) => g.id === channelId);
  if (!info) return null;
  const key = app.dmChannelKeys[channelId]?.[info.key_version];
  return key ? { version: info.key_version, key } : null;
}

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
  const kind = kindOf(raw.channel_id);
  const key = useAppStore.getState().dmChannelKeys[raw.channel_id]?.[raw.key_version];
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
      body: decryptText(raw.channel_id, raw.key_version, key, raw.nonce, raw.ciphertext, kind).body,
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
    const res = await api<{ messages: ChatMessage[]; has_more: boolean }>(`${baseOf(dmId)}/${dmId}/messages?limit=50`);
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
      `${baseOf(dmId)}/${dmId}/messages?before=${oldest}&limit=50`,
    );
    set((s) => ({
      messages: { ...s.messages, [dmId]: [...res.messages.map(toDisplay), ...(s.messages[dmId] ?? [])] },
      hasMore: { ...s.hasMore, [dmId]: res.has_more },
    }));
  },

  send: async (dmId, body) => {
    let keyInfo = keyFor(dmId);
    if (!keyInfo) {
      // refetch bootstrap (peer may have opened/rekeyed first) then retry once
      await useAppStore.getState().loadBootstrap();
      keyInfo = keyFor(dmId);
      if (!keyInfo) throw new Error('DM anahtarı yok');
    }
    const enc = encryptText(dmId, keyInfo.version, keyInfo.key, body, kindOf(dmId));
    set({ sending: true });
    try {
      await api(`${baseOf(dmId)}/${dmId}/messages`, {
        method: 'POST',
        body: { key_version: keyInfo.version, ...enc },
      });
    } finally {
      set({ sending: false });
    }
  },

  wire: () => {
    const onMsg = (raw: ChatMessage): void => {
      set((s) => ({
        messages: { ...s.messages, [raw.channel_id]: insertSorted(s.messages[raw.channel_id] ?? [], toDisplay(raw)) },
      }));
      // notification for background DMs
      if (useAppStore.getState().activeDmId !== raw.channel_id) playPop();
    };
    onServerEvent((e) => {
      if (e.type === 'dm:message') onMsg(e.message as ChatMessage);
      else if (e.type === 'gdm:message') onMsg(e.message as ChatMessage);
    });
  },
}));
