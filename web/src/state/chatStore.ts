import { create } from 'zustand';
import { api, ApiError } from '../api/client';
import type { ChatMessage } from '../api/types';
import { useAppStore } from './appStore';
import { useAuthStore } from './authStore';
import { decryptText, encryptText, nextSendIndex } from '../crypto/message';
import { ReplayFilter } from '../lib/replay';
import { notifyIncomingMessage } from '../lib/notify';
import { onServerEvent } from '../ws/socket';

// server replay sightings for this session; channel ids never collide with dmChatStore's
const replays = new ReplayFilter();

export interface DisplayMessage {
  id: number;
  channelId: string;
  senderId: string;
  nick: string;
  sentAt: number;
  /** client-generated AAD binding (replay hardening); absent on legacy rows */
  clientId?: string;
  clientSentAt?: number;
  /** null = ciphertext we cannot decrypt (missing epoch key) */
  body: string | null;
  /** tombstone: deleted for everyone — body is always null */
  deleted?: boolean;
}

interface ChatState {
  messages: Record<string, DisplayMessage[]>;
  hasMore: Record<string, boolean>;
  sending: boolean;
  /** message id -> arrival time (own messages only); drives the fresh-postmark stamp */
  sealAt: Record<number, number>;
  loadHistory: (channelId: string) => Promise<void>;
  loadOlder: (channelId: string) => Promise<void>;
  send: (channelId: string, body: string) => Promise<void>;
  wire: () => void;
}

function toDisplay(raw: ChatMessage): DisplayMessage {
  // tombstone row: the server kept the placeholder and wiped the content
  if (raw.deleted) {
    return {
      id: raw.id,
      channelId: raw.channel_id,
      senderId: raw.sender_id,
      nick: raw.nick,
      sentAt: raw.sent_at,
      clientId: raw.client_id ?? undefined,
      clientSentAt: raw.sent_at_client ?? undefined,
      body: null,
      deleted: true,
    };
  }
  const app = useAppStore.getState();
  const key = app.channelKeys[raw.channel_id]?.[raw.key_version];
  // recompute the AAD binding: decrypt only succeeds when the server kept
  // both columns intact — a forged/dropped binding renders the body unreadable
  const bind =
    raw.client_id != null && raw.sent_at_client != null
      ? { clientId: raw.client_id, clientSentAt: raw.sent_at_client }
      : undefined;
  if (!key)
    return {
      id: raw.id,
      channelId: raw.channel_id,
      senderId: raw.sender_id,
      nick: raw.nick,
      sentAt: raw.sent_at,
      clientId: raw.client_id ?? undefined,
      clientSentAt: raw.sent_at_client ?? undefined,
      body: null,
    };
  try {
    return {
      id: raw.id,
      channelId: raw.channel_id,
      senderId: raw.sender_id,
      nick: raw.nick,
      sentAt: raw.sent_at,
      clientId: raw.client_id ?? undefined,
      clientSentAt: raw.sent_at_client ?? undefined,
      body: decryptText(raw.channel_id, raw.key_version, key, raw.nonce, raw.ciphertext, 'ch', bind, raw.sender_id).body,
    };
  } catch {
    return {
      id: raw.id,
      channelId: raw.channel_id,
      senderId: raw.sender_id,
      nick: raw.nick,
      sentAt: raw.sent_at,
      clientId: raw.client_id ?? undefined,
      clientSentAt: raw.sent_at_client ?? undefined,
      body: null,
    };
  }
}

const insertSorted = (list: DisplayMessage[], m: DisplayMessage): DisplayMessage[] => {
  if (list.some((x) => x.id === m.id)) return list;
  if (list.length === 0 || m.id > (list[list.length - 1]!.id)) return [...list, m];
  const next = [...list, m];
  next.sort((a, b) => a.id - b.id);
  return next;
};

// tombstone push: keep the row (UI renders "silindi"), drop the body.
// caller guarantees the channel list is loaded.
const markDeleted = (list: DisplayMessage[], id: number): DisplayMessage[] =>
  list.map((m) => (m.id === id ? { ...m, body: null, deleted: true } : m));

export const useChatStore = create<ChatState>((set, get) => ({
  messages: {},
  hasMore: {},
  sending: false,
  sealAt: {},

  loadHistory: async (channelId) => {
    const res = await api<{ messages: ChatMessage[]; has_more: boolean }>(
      `/channels/${channelId}/messages?limit=50`,
    );
    // full reload replaces the list — rebuild the replay set so re-served
    // history is not flagged as injected duplicates
    replays.reset(channelId);
    set((s) => ({
      messages: {
        ...s.messages,
        [channelId]: res.messages
          .filter((m) => !(m.client_id && replays.check(channelId, m.client_id)))
          .map(toDisplay),
      },
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
        [channelId]: [
          ...res.messages
            .filter((m) => !(m.client_id && replays.check(channelId, m.client_id)))
            .map(toDisplay),
          ...(s.messages[channelId] ?? []),
        ],
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
      const senderId = useAuthStore.getState().user?.id;
      if (!senderId) throw new Error('oturum yok');
      // replay hardening: one client id per logical message, reused across the
      // retry loop (a 409 means the server never stored the earlier attempt)
      const clientId = crypto.randomUUID();
      const clientSentAt = Date.now();
      // encrypt + POST; on 409 (key rotated mid-flight) refresh keys and retry once
      for (let attempt = 0; ; attempt++) {
        // ratchet index'i per (channel, key_version) sayaçtan tüket; 409 ile
        // version değişirse yeni version'ın sayacı kullanılır
        const index = nextSendIndex(channelId, version);
        const enc = encryptText(channelId, version, key, body, 'ch', { clientId, clientSentAt }, false, {
          senderId,
          index,
        });
        try {
          await api(`/channels/${channelId}/messages`, {
            method: 'POST',
            body: { key_version: version, ...enc, client_id: clientId, sent_at_client: clientSentAt },
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
      // dm_/gdm_ channel ids belong to dmChatStore (its wire handles those)
      if (e.type === 'message:deleted') {
        const d = e as unknown as { channel_id: string; id: number };
        if (d.channel_id.startsWith('dm_') || d.channel_id.startsWith('gdm_')) return;
        set((s) => {
          const cur = s.messages[d.channel_id];
          if (!cur) return s; // channel not loaded — history fetch shows the tombstone
          return { messages: { ...s.messages, [d.channel_id]: markDeleted(cur, d.id) } };
        });
        return;
      }
      if (e.type !== 'message:new') return;
      const raw = e.message as ChatMessage;
      // replayed ciphertext arrives as a fresh row id with a seen client id — drop it
      if (raw.client_id && replays.check(raw.channel_id, raw.client_id)) return;
      const display = toDisplay(raw);
      set((s) => ({
        messages: { ...s.messages, [raw.channel_id]: insertSorted(s.messages[raw.channel_id] ?? [], display) },
        sealAt: amSender(display) ? { ...s.sealAt, [display.id]: Date.now() } : s.sealAt,
      }));
      // opportunistic: if we lack this epoch's key (recent rotation), fetch it once
      const app = useAppStore.getState();
      if (display.body === null && !app.channelKeys[raw.channel_id]?.[raw.key_version]) {
        void app.loadBootstrap();
      }
      // chime + OS toast for messages in rooms we're not looking at
      if (!amSender(display) && !(app.view === 'community' && app.activeChannelId === raw.channel_id)) {
        const com = app.communities.find((c) => c.channels.some((ch) => ch.id === raw.channel_id));
        const chName = com?.channels.find((ch) => ch.id === raw.channel_id)?.name;
        if (com && chName) {
          notifyIncomingMessage({
            channelId: raw.channel_id,
            communityId: com.id,
            title: `${com.name} · #${chName}`,
            nick: display.nick,
          });
        }
      }
    });
  },
}));

export const amSender = (m: DisplayMessage): boolean =>
  m.senderId === useAuthStore.getState().user?.id;
