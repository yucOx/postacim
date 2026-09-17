import { create } from 'zustand';
import { api, ApiError } from '../api/client';
import type { ChatMessage } from '../api/types';
import { useAppStore } from './appStore';
import { useAuthStore } from './authStore';
import { decryptText, encryptText, nextSendIndex } from '../crypto/message';
import { dhAnchor } from '../crypto/dhratchet';
import { dhParamsFor } from './dhstep';
import { ReplayFilter } from '../lib/replay';
import { notifyIncomingMessage } from '../lib/notify';
import { applyRemote, toggleMine, withReactions, type Reaction } from '../lib/reactions';
import { refreshSignKeys, resolveSignKeys } from '../lib/signkeys';
import { ttlSeconds } from './ttlStore';
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
  /** kaybolan mesaj TTL'i (ms epoch); absent = kapalı — sunucu metadata'sı */
  expiresAt?: number | null;
  /** reply target in the same channel; nick = target sender's nick */
  replyTo?: { id: number; nick: string } | null;
  /** grouped reaction chips as served by history / kept live by reaction:update */
  reactions: Reaction[];
}

interface ChatState {
  messages: Record<string, DisplayMessage[]>;
  hasMore: Record<string, boolean>;
  sending: boolean;
  /** message id -> arrival time (own messages only); drives the fresh-postmark stamp */
  sealAt: Record<number, number>;
  loadHistory: (channelId: string) => Promise<void>;
  loadOlder: (channelId: string) => Promise<void>;
  send: (channelId: string, body: string, replyTo?: number) => Promise<void>;
  /** optimistic own reaction toggle; server errors revert it */
  toggleReaction: (channelId: string, messageId: number, emoji: string, mine: boolean) => Promise<void>;
  wire: () => void;
}

// reply/reactions metadata shared by every display shape
function metaOf(raw: ChatMessage): Pick<DisplayMessage, 'replyTo' | 'reactions'> {
  return {
    replyTo: raw.reply_to ? { id: raw.reply_to, nick: raw.reply_nick ?? '' } : null,
    reactions: (raw.reactions ?? []).map((r) => ({ ...r })),
  };
}

function toDisplay(raw: ChatMessage): DisplayMessage {
  const meta = metaOf(raw);
  const expiry = { expiresAt: raw.expires_at ?? undefined };
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
      ...expiry,
      ...meta,
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
      ...expiry,
      ...meta,
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
      body: decryptText(
        raw.channel_id,
        raw.key_version,
        key,
        raw.nonce,
        raw.ciphertext,
        'ch',
        bind,
        raw.sender_id,
        // gönderen atfı: imza doğrulama + cutover bağlamı. Kendi mesajımız için
        // RAM'deki public yetiyor (KDF/password korumalı) — keytransparency
        // sync beklenmeden decode başarır; başkaları için defter kullanılır.
        { signPublicKey: resolveSignKeys(raw.sender_id, useAuthStore.getState().user?.id, useAuthStore.getState().signPublicKey), sentAt: raw.sent_at },
        // v4 okuma yolu: epok çapası private (row'un kendi epok anahtarından)
        { myPriv: dhAnchor(key).privateKey },
      ).body,
      ...expiry,
      ...meta,
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
      ...expiry,
      ...meta,
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

  send: async (channelId, body, replyTo) => {
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
      // gönderen atfı: imza anahtarı yoksa üretip yayınla (eski hesap ilk mesajda)
      let signPrivateKey = useAuthStore.getState().signPrivateKey;
      if (!signPrivateKey) {
        await useAuthStore.getState().ensureSignIdentity();
        signPrivateKey = useAuthStore.getState().signPrivateKey;
      }
      if (!signPrivateKey) throw new Error('imza anahtarı yok');
      // replay hardening: one client id per logical message, reused across the
      // retry loop (a 409 means the server never stored the earlier attempt)
      const clientId = crypto.randomUUID();
      const clientSentAt = Date.now();
      const ttl = ttlSeconds(channelId);
      // encrypt + POST; on 409 (key rotated mid-flight) refresh keys and retry once
      for (let attempt = 0; ; attempt++) {
        // ratchet index'i per (channel, key_version) sayaçtan tüket; 409 ile
        // version değişirse yeni version'ın sayacı kullanılır
        const index = nextSendIndex(channelId, version);
        // v4 DH adımı: epok çapası ile per-sender ephemeral (M/T pencere — dmstep ile aynı)
        const dh = await dhParamsFor(channelId, 'ch', version, key, index);
        const enc = encryptText(channelId, version, key, body, 'ch', { clientId, clientSentAt }, false, {
          senderId,
          index,
        }, { signPrivateKey }, dh);
        try {
          await api(`/channels/${channelId}/messages`, {
            method: 'POST',
            body: {
              key_version: version,
              ...enc,
              client_id: clientId,
              sent_at_client: clientSentAt,
              // kaybolan mesajlar: seçili TTL varsa expires_at body'ye eklenir
              // (AAD dışı sunucu metadata'sı)
              ...(ttl > 0 ? { expires_at: Date.now() + ttl * 1000 } : {}),
              ...(replyTo ? { reply_to: replyTo } : {}),
            },
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

  // optimistic own toggle; a server rejection (rate limit, rights) reverts it
  toggleReaction: async (channelId, messageId, emoji, mine) => {
    const list = get().messages[channelId];
    if (!list?.some((m) => m.id === messageId)) return;
    const reactionsOf = (l: DisplayMessage[]): Reaction[] =>
      l.find((m) => m.id === messageId)?.reactions ?? [];
    set((s) => ({
      messages: {
        ...s.messages,
        [channelId]: withReactions(s.messages[channelId] ?? [], messageId, toggleMine(reactionsOf(s.messages[channelId] ?? []), emoji)),
      },
    }));
    try {
      if (mine) {
        await api(`/channels/${channelId}/messages/${messageId}/reactions?emoji=${encodeURIComponent(emoji)}`, {
          method: 'DELETE',
        });
      } else {
        await api(`/channels/${channelId}/messages/${messageId}/reactions`, { method: 'POST', body: { emoji } });
      }
    } catch {
      // rare (rate limit, rights) — double-toggle is an involution: restores
      set((s) => ({
        messages: {
          ...s.messages,
          [channelId]: withReactions(
            s.messages[channelId] ?? [],
            messageId,
            toggleMine(reactionsOf(s.messages[channelId] ?? []), emoji),
          ),
        },
      }));
    }
  },

  wire: () => {
    onServerEvent((e) => {
      const me = useAuthStore.getState().user?.id;
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
      // live reaction chips from others (own toggles applied optimistically)
      if (e.type === 'reaction:update') {
        const ru = e as unknown as {
          scope: string;
          channel_id: string;
          message_id: number;
          emoji: string;
          action: 'add' | 'remove';
          user_id: string;
        };
        if (ru.scope !== 'channel') return;
        if (ru.user_id === me) return; // own toggle: optimistic already applied
        set((s) => {
          const cur = s.messages[ru.channel_id];
          if (!cur) return s;
          return {
            messages: {
              ...s.messages,
              [ru.channel_id]: withReactions(
                cur,
                ru.message_id,
                applyRemote(cur.find((m) => m.id === ru.message_id)?.reactions ?? [], ru.emoji, ru.action),
              ),
            },
          };
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
      // opportunistic: if we lack this epoch's key (recent rotation), fetch it once;
      // yeni üyelerin imza anahtarı için de defteri tazele
      const app = useAppStore.getState();
      if (display.body === null && raw.sent_at > Date.now() - 3_600_000) {
        if (!app.channelKeys[raw.channel_id]?.[raw.key_version]) void app.loadBootstrap();
        else void refreshSignKeys();
      }
      // chime + OS toast for messages in rooms we're not looking at
      if (!amSender(display) && !(app.view === 'community' && app.activeChannelId === raw.channel_id)) {
        const com = app.communities.find((c) => c.channels.some((ch) => ch.id === raw.channel_id));
        const chName = com?.channels.find((ch) => ch.id === raw.channel_id)?.name;
        if (com && chName) {
          // mention flag: decrypted body names us (case-insensitive) — louder chime
          const myNick = useAuthStore.getState().user?.nick;
          const mention =
            !!myNick && display.body !== null && display.body.toLowerCase().includes(myNick.toLowerCase());
          notifyIncomingMessage({
            channelId: raw.channel_id,
            communityId: com.id,
            title: `${com.name} · #${chName}`,
            nick: display.nick,
            mention,
          });
        }
      }
    });
  },
}));

export const amSender = (m: DisplayMessage): boolean =>
  m.senderId === useAuthStore.getState().user?.id;
