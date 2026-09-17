import { create } from 'zustand';
import { api } from '../api/client';
import type { ChatMessage } from '../api/types';
import { useAppStore } from './appStore';
import { useAuthStore } from './authStore';
import { decryptText, encryptText, nextSendIndex, type MsgScope } from '../crypto/message';
import { dhAnchor } from '../crypto/dhratchet';
import { dhParamsFor } from './dhstep';
import { ReplayFilter } from '../lib/replay';
import { notifyIncomingMessage } from '../lib/notify';
import { applyRemote, toggleMine, withReactions, type Reaction } from '../lib/reactions';
import { resolveSignKeys, ingestSignKeys } from '../lib/signkeys';
import { ttlSeconds } from './ttlStore';
import { onServerEvent } from '../ws/socket';

// dm_/gdm_ ids never collide with chatStore's channel ids — separate filter is safe
const replays = new ReplayFilter();

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
  /** client-generated AAD binding (replay hardening); absent on legacy rows */
  clientId?: string;
  clientSentAt?: number;
  body: string | null;
  /** tombstone: deleted for everyone — body is always null */
  deleted?: boolean;
  /** kaybolan mesaj TTL'i (ms epoch); absent = kapalı — sunucu metadata'sı */
  expiresAt?: number | null;
  /** reply target (same DM/GDM); nick = target sender's nick */
  replyTo?: { id: number; nick: string } | null;
  /** grouped reaction chips as served by history / kept live by reaction:update */
  reactions: Reaction[];
}

interface DmChatState {
  messages: Record<string, DmDisplayMessage[]>;
  hasMore: Record<string, boolean>;
  sending: boolean;
  loadHistory: (dmId: string) => Promise<void>;
  loadOlder: (dmId: string) => Promise<void>;
  send: (dmId: string, body: string, replyTo?: number) => Promise<void>;
  /** optimistic own reaction toggle; server errors revert it */
  toggleReaction: (dmId: string, messageId: number, emoji: string, mine: boolean) => Promise<void>;
  wire: () => void;
}

// reply/reactions metadata shared by every display shape
function metaOf(raw: ChatMessage): Pick<DmDisplayMessage, 'replyTo' | 'reactions'> {
  return {
    replyTo: raw.reply_to ? { id: raw.reply_to, nick: raw.reply_nick ?? '' } : null,
    reactions: (raw.reactions ?? []).map((r) => ({ ...r })),
  };
}

function toDisplay(raw: ChatMessage): DmDisplayMessage {
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
  const kind = kindOf(raw.channel_id);
  const key = useAppStore.getState().dmChannelKeys[raw.channel_id]?.[raw.key_version];
  // recompute the AAD binding: decrypt only succeeds when the server kept
  // both columns intact — a forged/dropped binding renders the body unreadable
  const bind =
    raw.client_id != null && raw.sent_at_client != null
      ? { clientId: raw.client_id, clientSentAt: raw.sent_at_client }
      : undefined;
  if (!key) {
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
  try {
    // v4 okuma yolu (dm + gdm): alıcı private'ı başlıktaki ephemeral public ile
    // DH çıktısını üretir (stateless türetim) — dm'de kimlik private, gdm'de
    // epok çapası private (row'un kendi epok anahtarından türetilir)
    const myPriv = kind === 'dm' ? useAuthStore.getState().privateKey : key ? dhAnchor(key).privateKey : null;
    // server'dan gelen sender_sign_key'i deftere al (Faz 1 hotfix: kendi
    // mesajımızı kendi RAM'de yokken bile açarız — syncKeyLog beklenmez)
    if (raw.sender_sign_key) {
      ingestSignKeys([{ id: 0, user_id: raw.sender_id, sign_public_key: raw.sender_sign_key }]);
    }
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
        kind,
        bind,
        raw.sender_id,
        // gönderen atfı: imza doğrulama + cutover bağlamı. Kendi mesajımız için
        // RAM'deki public yetiyor (KDF/password korumalı) — keytransparency
        // sync beklenmeden decode başarır; başkaları için defter kullanılır.
        { signPublicKey: resolveSignKeys(raw.sender_id, useAuthStore.getState().user?.id, useAuthStore.getState().signPublicKey), sentAt: raw.sent_at },
        ...(myPriv ? [{ myPriv }] : []),
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

const insertSorted = (list: DmDisplayMessage[], m: DmDisplayMessage): DmDisplayMessage[] => {
  if (list.some((x) => x.id === m.id)) return list;
  if (list.length === 0 || m.id > (list[list.length - 1]!.id)) return [...list, m];
  const next = [...list, m];
  next.sort((a, b) => a.id - b.id);
  return next;
};

// tombstone push: keep the row (UI renders "silindi"), drop the body.
// caller guarantees the channel list is loaded.
const markDeleted = (list: DmDisplayMessage[], id: number): DmDisplayMessage[] =>
  list.map((m) => (m.id === id ? { ...m, body: null, deleted: true } : m));

export const useDmChatStore = create<DmChatState>((set, get) => ({
  messages: {},
  hasMore: {},
  sending: false,

  loadHistory: async (dmId) => {
    const res = await api<{ messages: ChatMessage[]; has_more: boolean }>(`${baseOf(dmId)}/${dmId}/messages?limit=50`);
    // full reload replaces the list — rebuild the replay set so re-served
    // history is not flagged as injected duplicates
    replays.reset(dmId);
    set((s) => ({
      messages: {
        ...s.messages,
        [dmId]: res.messages
          .filter((m) => !(m.client_id && replays.check(dmId, m.client_id)))
          .map(toDisplay),
      },
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
      messages: {
        ...s.messages,
        [dmId]: [
          ...res.messages
            .filter((m) => !(m.client_id && replays.check(dmId, m.client_id)))
            .map(toDisplay),
          ...(s.messages[dmId] ?? []),
        ],
      },
      hasMore: { ...s.hasMore, [dmId]: res.has_more },
    }));
  },

  send: async (dmId, body, replyTo) => {
    let keyInfo = keyFor(dmId);
    if (!keyInfo) {
      // refetch bootstrap (peer may have opened/rekeyed first) then retry once
      await useAppStore.getState().loadBootstrap();
      keyInfo = keyFor(dmId);
      if (!keyInfo) throw new Error('DM anahtarı yok');
    }
    const senderId = useAuthStore.getState().user?.id;
    if (!senderId) throw new Error('oturum yok');
    // gönderen atfı: imza anahtarı yoksa üretip yayınla (eski hesap ilk mesajda)
    let signPrivateKey = useAuthStore.getState().signPrivateKey;
    if (!signPrivateKey) {
      await useAuthStore.getState().ensureSignIdentity();
      signPrivateKey = useAuthStore.getState().signPrivateKey;
    }
    if (!signPrivateKey) throw new Error('imza anahtarı yok');
    // replay hardening: client id rides the AAD and the body as one logical message
    const clientId = crypto.randomUUID();
    const clientSentAt = Date.now();
    const ttl = ttlSeconds(dmId);
    // ratchet index'i per (channel, key_version) sayaçtan tüketilir; v4 DH adımı
    // kararı bu index üzerinden verilir (step_base = adımın ilk index'i)
    const index = nextSendIndex(dmId, keyInfo.version);
    const dh = await dhParamsFor(dmId, kindOf(dmId), keyInfo.version, keyInfo.key, index);
    const enc = encryptText(dmId, keyInfo.version, keyInfo.key, body, kindOf(dmId), { clientId, clientSentAt }, false, {
      senderId,
      index,
    }, { signPrivateKey }, dh);
    set({ sending: true });
    try {
      await api(`${baseOf(dmId)}/${dmId}/messages`, {
        method: 'POST',
        body: {
          key_version: keyInfo.version,
          ...enc,
          client_id: clientId,
          sent_at_client: clientSentAt,
          // kaybolan mesajlar: seçili TTL varsa expires_at body'ye eklenir
          // (AAD dışı sunucu metadata'sı)
          ...(ttl > 0 ? { expires_at: Date.now() + ttl * 1000 } : {}),
          ...(replyTo ? { reply_to: replyTo } : {}),
        },
      });
    } finally {
      set({ sending: false });
    }
  },

  // optimistic own toggle; a server rejection (rate limit, rights) reverts it
  toggleReaction: async (dmId, messageId, emoji, mine) => {
    const list = get().messages[dmId];
    if (!list?.some((m) => m.id === messageId)) return;
    const reactionsOf = (l: DmDisplayMessage[]): Reaction[] =>
      l.find((m) => m.id === messageId)?.reactions ?? [];
    set((s) => ({
      messages: {
        ...s.messages,
        [dmId]: withReactions(s.messages[dmId] ?? [], messageId, toggleMine(reactionsOf(s.messages[dmId] ?? []), emoji)),
      },
    }));
    try {
      if (mine) {
        await api(`${baseOf(dmId)}/${dmId}/messages/${messageId}/reactions?emoji=${encodeURIComponent(emoji)}`, {
          method: 'DELETE',
        });
      } else {
        await api(`${baseOf(dmId)}/${dmId}/messages/${messageId}/reactions`, { method: 'POST', body: { emoji } });
      }
    } catch {
      // rare (rate limit, rights) — double-toggle is an involution: restores
      set((s) => ({
        messages: {
          ...s.messages,
          [dmId]: withReactions(
            s.messages[dmId] ?? [],
            messageId,
            toggleMine(reactionsOf(s.messages[dmId] ?? []), emoji),
          ),
        },
      }));
    }
  },

  wire: () => {
    const onMsg = (raw: ChatMessage): void => {
      // replayed ciphertext arrives as a fresh row id with a seen client id — drop it
      if (raw.client_id && replays.check(raw.channel_id, raw.client_id)) return;
      const display = toDisplay(raw);
      set((s) => ({
        messages: { ...s.messages, [raw.channel_id]: insertSorted(s.messages[raw.channel_id] ?? [], display) },
      }));
      // notification for background DMs (never for own messages sent from another tab)
      const app = useAppStore.getState();
      if (
        app.activeDmId !== raw.channel_id &&
        display.senderId !== useAuthStore.getState().user?.id
      ) {
        const title =
          app.dms.find((d) => d.id === raw.channel_id)?.peer.nick ??
          app.gdms.find((g) => g.id === raw.channel_id)?.name ??
          'özel mesaj';
        // mention flag: decrypted body names us (case-insensitive) — louder chime
        const myNick = useAuthStore.getState().user?.nick;
        const mention =
          !!myNick && display.body !== null && display.body.toLowerCase().includes(myNick.toLowerCase());
        notifyIncomingMessage({ channelId: raw.channel_id, title, nick: display.nick, mention });
      }
    };
    onServerEvent((e) => {
      const me = useAuthStore.getState().user?.id;
      if (e.type === 'dm:message') onMsg(e.message as ChatMessage);
      else if (e.type === 'gdm:message') onMsg(e.message as ChatMessage);
      // live reaction chips from others (own toggles applied optimistically)
      else if (e.type === 'reaction:update') {
        const ru = e as unknown as {
          scope: string;
          channel_id: string;
          message_id: number;
          emoji: string;
          action: 'add' | 'remove';
          user_id: string;
        };
        if (ru.scope !== 'dm' && ru.scope !== 'gdm') return;
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
      }
      // community-channel ids belong to chatStore (its wire handles those)
      else if (e.type === 'message:deleted') {
        const d = e as unknown as { channel_id: string; id: number };
        if (!d.channel_id.startsWith('dm_') && !d.channel_id.startsWith('gdm_')) return;
        set((s) => {
          const cur = s.messages[d.channel_id];
          if (!cur) return s; // channel not loaded — history fetch shows the tombstone
          return { messages: { ...s.messages, [d.channel_id]: markDeleted(cur, d.id) } };
        });
      }
    });
  },
}));
