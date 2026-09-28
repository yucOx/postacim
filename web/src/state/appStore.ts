import { create } from 'zustand';
import { api } from '../api/client';
import type { BootstrapCommunity } from '../api/types';
import { useAuthStore } from './authStore';
import { b64, randomBytes } from '../crypto/bytes';
import { deriveKeys, newKdfSaltHex } from '../crypto/argon2';
import { generateIdentity, unwrapMyKey, wrapKeyFor } from '../crypto/identity';
import { sealJoinKey } from '../crypto/joinpw';
import { buildInviteLink } from '../crypto/invite';
import { onServerEvent } from '../ws/socket';
import { getSignKeys, refreshSignKeys } from '../lib/signkeys';
import { bandFromIngest, ingestDhUpdate } from '../lib/dhupdate';
import {
  classifyKeylogHead,
  isValidIncomingHead,
  publishKeylogHead,
  registerGossipPublisher,
  startGossipLoop,
} from '../lib/keygossip';
import { useSecurityStore } from './securityStore';
import { useDeviceStore } from './deviceStore';
import { useSettingsStore } from './settingsStore';
import { playChime } from '../lib/sound';

export interface Channel {
  id: string;
  name: string;
  type: 'text' | 'voice';
  key_version: number;
  needs_rekey?: boolean;
  my_wrapped_key?: string | null;
}
export type Role = 'owner' | 'admin' | 'member';
export interface Member {
  id: string;
  nick: string;
  role: Role;
}
export interface Community {
  id: string;
  name: string;
  role: Role;
  members: Member[];
  channels: Channel[];
  pending_join_requests?: number;
  has_join_password?: boolean;
}

export interface FriendInfo {
  id: string;
  nick: string;
  public_key: string;
}
export interface FriendBrief {
  id: string;
  nick: string;
}
export interface DmInfo {
  id: string;
  peer: { id: string; nick: string };
  key_version: number;
  my_wrapped_key: string | null;
  last_message_at: number | null;
}
export interface GdmInfo {
  id: string;
  name: string;
  creator_id: string;
  key_version: number;
  members: { id: string; nick: string; public_key: string }[];
  my_wrapped_key: string | null;
  last_message_at: number | null;
}

// channelId -> key_version -> raw channel key; epochs kept so rotated history stays readable
type KeyEpochs = Record<string, Record<number, Uint8Array>>;

interface AppState {
  loaded: boolean;
  view: 'community' | 'dm';
  communities: Community[];
  publicKeys: Record<string, string>;
  friends: FriendInfo[];
  friendIncoming: FriendBrief[];
  friendOutgoing: FriendBrief[];
  dms: DmInfo[];
  gdms: GdmInfo[];
  dmChannelKeys: KeyEpochs;
  activeDmId: string | null;
  activeCommunityId: string | null;
  activeChannelId: string | null;
  channelKeys: KeyEpochs;
  /** kabul bekleyen sunucu daveti (staff "üye ekle" → hedefte onay modalı) */
  pendingInvite: { code: string; communityName: string; fromNick: string } | null;
  setPendingInvite: (v: { code: string; communityName: string; fromNick: string } | null) => void;
  loadBootstrap: () => Promise<void>;
  activeCommunity: () => Community | null;
  activeChannel: () => Channel | null;
  selectCommunity: (id: string) => void;
  selectChannel: (id: string) => void;
  currentKey: (channelId: string) => Uint8Array | null;
  ensureChannelKey: (channelId: string) => Promise<Uint8Array>;
  rekeyAffected: (communityId: string, channelIds: string[]) => Promise<void>;
  createCommunity: (name: string) => Promise<void>;
  createChannel: (communityId: string, name: string, type: 'text' | 'voice') => Promise<void>;
  addMember: (communityId: string, nick: string) => Promise<string>;
  removeMember: (communityId: string, userId: string) => Promise<void>;
  banMember: (communityId: string, userId: string) => Promise<void>;
  setRole: (communityId: string, userId: string, makeAdmin: boolean) => Promise<void>;
  leaveCommunity: (communityId: string) => Promise<void>;
  deleteCommunity: (communityId: string) => Promise<void>;
  createInvite: (
    communityId: string,
    opts: { targetNick?: string; maxUses?: number; ttlHours?: number },
  ) => Promise<string>;
  setJoinPassword: (communityId: string, password: string) => Promise<void>;
  removeJoinPassword: (communityId: string) => Promise<void>;
  showDmHome: () => void;
  openDmChat: (dmId: string) => void;
  backToCommunity: () => void;
  sendFriendRequest: (nick: string) => Promise<void>;
  acceptFriend: (userId: string) => Promise<void>;
  declineFriend: (userId: string) => Promise<void>;
  unfriend: (userId: string) => Promise<void>;
  openDm: (userId: string) => Promise<void>;
  createGroupDm: (name: string, memberIds: string[]) => Promise<void>;
  addGdmMember: (gdmId: string, userId: string) => Promise<void>;
  leaveGdm: (gdmId: string) => Promise<void>;
  wireEvents: () => void;
}

const setKeyEpoch = (keys: KeyEpochs, channelId: string, version: number, key: Uint8Array): KeyEpochs => ({
  ...keys,
  [channelId]: { ...(keys[channelId] ?? {}), [version]: key },
});

function unwrapBootstrap(
  communities: BootstrapCommunity[],
  existingKeys: KeyEpochs,
): { communities: Community[]; keys: KeyEpochs } {
  const { publicKey, privateKey } = useAuthStore.getState();
  if (!publicKey || !privateKey) throw new Error('kimlik yok');
  // merge: existing epochs survive, latest version (re)unwrapped — rotated history stays readable
  const keys: KeyEpochs = { ...existingKeys };
  const out: Community[] = communities.map((c) => ({
    ...c,
    channels: c.channels.map((ch) => {
      if (ch.my_wrapped_key) {
        keys[ch.id] = {
          ...(keys[ch.id] ?? {}),
          [ch.key_version]: unwrapMyKey(ch.my_wrapped_key, publicKey, privateKey),
        };
      }
      return { ...ch, my_wrapped_key: undefined };
    }),
  }));
  return { communities: out, keys };
}

export const useAppStore = create<AppState>((set, get) => {
  // drop a community from local state: used by self-leave, delete, and the
  // member_removed broadcast. Falls back to the first remaining community,
  // or to the DM home when none are left.
  const dropCommunity = (id: string): void => {
    const state = get();
    const communities = state.communities.filter((c) => c.id !== id);
    const activeWasIn = state.activeCommunityId === id;
    const first = communities[0];
    set({
      communities,
      activeCommunityId: activeWasIn ? (first?.id ?? null) : state.activeCommunityId,
      activeChannelId: activeWasIn
        ? (first?.channels.find((c) => c.type === 'text')?.id ?? null)
        : state.activeChannelId,
      view: activeWasIn && communities.length === 0 ? 'dm' : state.view,
    });
  };
  return ({
  loaded: false,
  // default landing: mektuplar (friends/DM home) — communities open via route
  view: 'dm',
  communities: [],
  publicKeys: {},
  friends: [],
  friendIncoming: [],
  friendOutgoing: [],
  dms: [],
  gdms: [],
  dmChannelKeys: {},
  activeDmId: null,
  activeCommunityId: null,
  activeChannelId: null,
  channelKeys: {},
  pendingInvite: null,
  setPendingInvite: (v) => set({ pendingInvite: v }),

  loadBootstrap: async () => {
    const data = await api<{
      communities: BootstrapCommunity[];
      public_keys: Record<string, string>;
      friends: { friends: FriendInfo[]; incoming: FriendBrief[]; outgoing: FriendBrief[] };
      dms?: DmInfo[];
      gdms?: GdmInfo[];
      devices?: import('./deviceStore').DeviceInfo[];
    }>('/bootstrap');
    // imza anahtarı haritası defterden beslenir — yeni üye/kayıt sonrası tazele
    void refreshSignKeys();
    if (data.devices) useDeviceStore.setState({ devices: data.devices });
    const { communities, keys } = unwrapBootstrap(data.communities, get().channelKeys);
    // DM/GDM keys: unwrap into a separate epoch map (ids never collide: dm_/gdm_ prefixes)
    const { publicKey, privateKey } = useAuthStore.getState();
    if (!publicKey || !privateKey) throw new Error('kimlik yok');
    const dmKeys: KeyEpochs = { ...get().dmChannelKeys };
    const dms: DmInfo[] = (data.dms ?? []).map((d) => {
      if (d.my_wrapped_key) {
        dmKeys[d.id] = {
          ...(dmKeys[d.id] ?? {}),
          [d.key_version]: unwrapMyKey(d.my_wrapped_key, publicKey, privateKey),
        };
      }
      return { ...d, my_wrapped_key: null };
    });
    const pubKeys = { ...data.public_keys };
    const gdms: GdmInfo[] = (data.gdms ?? []).map((g) => {
      if (g.my_wrapped_key) {
        dmKeys[g.id] = {
          ...(dmKeys[g.id] ?? {}),
          [g.key_version]: unwrapMyKey(g.my_wrapped_key, publicKey, privateKey),
        };
      }
      for (const m of g.members) pubKeys[m.id] ??= m.public_key;
      return { ...g, my_wrapped_key: null };
    });
    const prevActiveChannel = get().activeChannelId;
    set({
      loaded: true,
      communities,
      publicKeys: pubKeys,
      friends: data.friends.friends,
      friendIncoming: data.friends.incoming,
      friendOutgoing: data.friends.outgoing,
      dms,
      gdms,
      dmChannelKeys: dmKeys,
      channelKeys: keys,
    });
    // keep selection if still valid, otherwise pick first text channel of first community
    const stillThere = communities.some((c) => c.channels.some((ch) => ch.id === prevActiveChannel));
    if (!stillThere) {
      const first = communities[0];
      const firstText = first?.channels.find((ch) => ch.type === 'text');
      set({ activeCommunityId: first?.id ?? null, activeChannelId: firstText?.id ?? null });
    } else if (!get().activeCommunityId) {
      const com = communities.find((c) => c.channels.some((ch) => ch.id === prevActiveChannel));
      set({ activeCommunityId: com?.id ?? null });
    }
  },

  activeCommunity: () => get().communities.find((c) => c.id === get().activeCommunityId) ?? null,
  activeChannel: () => {
    for (const c of get().communities) {
      const ch = c.channels.find((x) => x.id === get().activeChannelId);
      if (ch) return ch;
    }
    return null;
  },

  selectCommunity: (id) => {
    const com = get().communities.find((c) => c.id === id);
    set({
      view: 'community',
      activeDmId: null,
      activeCommunityId: id,
      activeChannelId: com?.channels.find((c) => c.type === 'text')?.id ?? null,
    });
  },

  selectChannel: (id) => {
    const parent = get().communities.find((c) => c.channels.some((ch) => ch.id === id));
    set({ activeChannelId: id, activeCommunityId: parent?.id ?? get().activeCommunityId });
  },

  currentKey: (channelId) => {
    const epochs = get().channelKeys[channelId];
    if (!epochs) return null;
    let version = -1;
    for (const ch of get().communities) {
      const found = ch.channels.find((c) => c.id === channelId);
      if (found) version = found.key_version;
    }
    return epochs[version] ?? null;
  },

  ensureChannelKey: async (channelId) => {
    const existing = get().currentKey(channelId);
    if (existing) return existing;
    const res = await api<{ key_version: number; wrapped_key: string }>(
      `/channels/${channelId}/my-key`,
    );
    const { publicKey, privateKey } = useAuthStore.getState();
    if (!publicKey || !privateKey) throw new Error('kimlik yok');
    const key = unwrapMyKey(res.wrapped_key, publicKey, privateKey);
    set({ channelKeys: setKeyEpoch(get().channelKeys, channelId, res.key_version, key) });
    return key;
  },

  // Shared kick/ban tail: refresh (member already gone server-side), then seal a
  // fresh key per affected channel to every remaining member.
  rekeyAffected: async (communityId, channelIds) => {
    await get().loadBootstrap();
    const { publicKeys, communities } = get();
    const com = communities.find((c) => c.id === communityId);
    if (!com) return;
    for (const channelId of channelIds) {
      const newKey = randomBytes(32);
      const wrappedKeys = com.members.map((m) => {
        const pk = publicKeys[m.id];
        if (!pk) throw new Error(`${m.nick} için açık anahtar yok`);
        return { user_id: m.id, wrapped_key: wrapKeyFor(newKey, pk) };
      });
      await api(`/channels/${channelId}/rotate`, {
        method: 'POST',
        body: { wrapped_keys: wrappedKeys },
      });
      // own epoch map updates via the channel:rotated → loadBootstrap handler
    }
  },

  createCommunity: async (name) => {
    const { publicKey } = useAuthStore.getState();
    if (!publicKey) throw new Error('kimlik yok');
    const defaults: { name: string; type: 'text' | 'voice' }[] = [
      { name: 'genel', type: 'text' },
      { name: 'Genel Ses', type: 'voice' },
    ];
    const generated = defaults.map((d) => ({ ...d, key: randomBytes(32) }));
    const res = await api<{
      community: { id: string };
      channels: { id: string; key_version: number }[];
    }>('/communities', {
      method: 'POST',
      body: {
        name,
        channels: generated.map((c) => ({
          name: c.name,
          type: c.type,
          wrapped_key: wrapKeyFor(c.key, b64(publicKey)),
        })),
      },
    });
    let keys = get().channelKeys;
    res.channels.forEach((ch, i) => {
      keys = setKeyEpoch(keys, ch.id, ch.key_version, generated[i]!.key);
    });
    set({ channelKeys: keys });
    await get().loadBootstrap();
    set({ activeCommunityId: res.community.id });
  },

  createChannel: async (communityId, name, type) => {
    const { publicKeys } = get();
    const com = get().communities.find((c) => c.id === communityId);
    if (!com) throw new Error('topluluk bulunamadı');
    const key = randomBytes(32);
    const wrappedKeys = com.members.map((m) => {
      const pk = publicKeys[m.id];
      if (!pk) throw new Error(`${m.nick} için anahtar yok — sayfayı yenile`);
      return { user_id: m.id, wrapped_key: wrapKeyFor(key, pk) };
    });
    const res = await api<{ channel: { id: string; key_version: number } }>(
      `/communities/${communityId}/channels`,
      { method: 'POST', body: { name, type, wrapped_keys: wrappedKeys } },
    );
    set({ channelKeys: setKeyEpoch(get().channelKeys, res.channel.id, res.channel.key_version, key) });
    await get().loadBootstrap();
    set({ activeChannelId: res.channel.id });
  },

  addMember: async (communityId, nick) => {
    const target = await api<{ id: string; nick: string; public_key: string }>(
      `/users/lookup?nick=${encodeURIComponent(nick)}`,
    );
    const com = get().communities.find((c) => c.id === communityId);
    if (!com) throw new Error('topluluk bulunamadı');
    const wrapped = [];
    for (const ch of com.channels) {
      const key = await get().ensureChannelKey(ch.id);
      wrapped.push({ channel_id: ch.id, wrapped_key: wrapKeyFor(key, target.public_key) });
    }
    // server turns this into a targeted invite + WS prompt for the target —
    // membership lands only when THEY accept (consent)
    await api(`/communities/${communityId}/members`, {
      method: 'POST',
      body: { user_id: target.id, wrapped_keys: wrapped },
    });
    return target.nick;
    // member_added broadcast fires when the target accepts (their complete)
  },

  // Owner/admin flow: remove on the server, then rekey every affected channel by
  // sealing a fresh key to each remaining member. Old epochs stay decryptable.
  removeMember: async (communityId, userId) => {
    const res = await api<{ affected_channel_ids: string[] }>(
      `/communities/${communityId}/members/${userId}`,
      { method: 'DELETE' },
    );
    await get().rekeyAffected(communityId, res.affected_channel_ids);
  },

  // Ban = kick (server-side, incl. wrapped-key purge) + ban row + rekey.
  banMember: async (communityId, userId) => {
    const res = await api<{ affected_channel_ids: string[] }>(
      `/communities/${communityId}/bans`,
      { method: 'POST', body: { user_id: userId } },
    );
    await get().rekeyAffected(communityId, res.affected_channel_ids);
  },

  setRole: async (communityId, userId, makeAdmin) => {
    await api(`/communities/${communityId}/admins${makeAdmin ? '' : `/${userId}`}`, {
      method: makeAdmin ? 'POST' : 'DELETE',
      ...(makeAdmin ? { body: { user_id: userId } } : {}),
    });
    // roles_updated event refreshes bootstrap
  },

  // Self-leave: the server freezes channels + kills invites; remaining staff
  // see the rekey locks. The member_removed broadcast also drops it locally.
  leaveCommunity: async (communityId) => {
    await api(`/communities/${communityId}/leave`, { method: 'POST' });
    dropCommunity(communityId);
  },

  deleteCommunity: async (communityId) => {
    await api(`/communities/${communityId}`, { method: 'DELETE' });
    dropCommunity(communityId);
  },

  // Open invite: keys sealed to an ephemeral keypair whose private half lives in
  // the link (never on the server) → owner can be offline when it is redeemed.
  // Targeted invite: sealed straight to the target's identity key.
  createInvite: async (communityId, opts) => {
    const com = get().communities.find((c) => c.id === communityId);
    if (!com) throw new Error('topluluk bulunamadı');
    let target: { id: string; public_key: string } | null = null;
    if (opts.targetNick) {
      target = await api<{ id: string; public_key: string }>(
        `/users/lookup?nick=${encodeURIComponent(opts.targetNick)}`,
      );
    }
    const eph = opts.targetNick ? null : generateIdentity();
    const wrappedKeys = [];
    for (const ch of com.channels) {
      const key = await get().ensureChannelKey(ch.id);
      const sealTo = eph ? b64(eph.publicKey) : target!.public_key;
      wrappedKeys.push({ channel_id: ch.id, key_version: ch.key_version, wrapped_key: wrapKeyFor(key, sealTo) });
    }
    const res = await api<{ invite: { id: string; code: string } }>(
      `/communities/${communityId}/invites`,
      {
        method: 'POST',
        body: {
          ...(target ? { target_user_id: target.id } : {}),
          max_uses: opts.maxUses,
          ttl_hours: opts.ttlHours,
          wrapped_keys: wrappedKeys,
        },
      },
    );
    const link = buildInviteLink(res.invite.code, eph ? eph.privateKey : undefined);
    // only the client can rebuild open-invite links; keep them per-browser
    const stored = JSON.parse(localStorage.getItem('pgv_invite_links') ?? '{}') as Record<string, string>;
    stored[res.invite.id] = link;
    localStorage.setItem('pgv_invite_links', JSON.stringify(stored));
    return link;
  },

  // Join password: Argon2id gives proof (server verifier) + JW (key wrap);
  // channel keys leave sealed under JW — the password itself never leaves.
  setJoinPassword: async (communityId, password) => {
    const com = get().communities.find((c) => c.id === communityId);
    if (!com) throw new Error('topluluk bulunamadı');
    const kdfSalt = newKdfSaltHex();
    const { authMaterial, kek } = await deriveKeys(password, kdfSalt);
    const wrappedKeys = [];
    for (const ch of com.channels) {
      const key = await get().ensureChannelKey(ch.id);
      wrappedKeys.push({ channel_id: ch.id, key_version: ch.key_version, wrapped_key: sealJoinKey(key, kek) });
    }
    await api(`/communities/${communityId}/join-password`, {
      method: 'POST',
      body: { kdf_salt: kdfSalt, verifier_input: b64(authMaterial), wrapped_keys: wrappedKeys },
    });
    await get().loadBootstrap();
  },

  removeJoinPassword: async (communityId) => {
    await api(`/communities/${communityId}/join-password`, { method: 'DELETE' });
    await get().loadBootstrap();
  },

  showDmHome: () => set({ view: 'dm', activeDmId: null }),
  openDmChat: (dmId) => set({ view: 'dm', activeDmId: dmId }),
  backToCommunity: () => {
    const state = get();
    const first = state.communities[0];
    set({
      view: 'community',
      activeDmId: null,
      activeCommunityId: state.activeCommunityId ?? first?.id ?? null,
      activeChannelId:
        state.activeChannelId ??
        first?.channels.find((c) => c.type === 'text')?.id ??
        null,
    });
  },

  sendFriendRequest: async (nick) => {
    await api('/friends/requests', { method: 'POST', body: { nick } });
    await get().loadBootstrap();
  },
  acceptFriend: async (userId) => {
    await api(`/friends/requests/${userId}/accept`, { method: 'POST' });
    await get().loadBootstrap();
  },
  declineFriend: async (userId) => {
    await api(`/friends/requests/${userId}/decline`, { method: 'POST' });
    await get().loadBootstrap();
  },
  unfriend: async (userId) => {
    await api(`/friends/${userId}`, { method: 'DELETE' });
    await get().loadBootstrap();
  },

  // DM open: idempotent; new pair → key sealed to both identities by the opener.
  openDm: async (userId) => {
    const existing = get().dms.find((d) => d.peer.id === userId);
    if (existing) {
      set({ view: 'dm', activeDmId: existing.id });
      return;
    }
    const { publicKey } = useAuthStore.getState();
    const friend = get().friends.find((f) => f.id === userId);
    if (!publicKey || !friend) throw new Error('arkadaş bulunamadı');
    const key = randomBytes(32);
    const res = await api<{ channel: { id: string; existing: boolean } }>('/dms', {
      method: 'POST',
      body: {
        user_id: userId,
        wrapped_keys: [
          { user_id: userId, wrapped_key: wrapKeyFor(key, friend.public_key) },
          { user_id: useAuthStore.getState().user!.id, wrapped_key: wrapKeyFor(key, b64(publicKey)) },
        ],
      },
    });
    if (!res.channel.existing) {
      set({ dmChannelKeys: setKeyEpoch(get().dmChannelKeys, res.channel.id, 1, key) });
    }
    await get().loadBootstrap();
    set({ view: 'dm', activeDmId: res.channel.id });
  },

  // Group DM: creator seals one v1 key to every picked friend + self.
  createGroupDm: async (name, memberIds) => {
    const { publicKey } = useAuthStore.getState();
    const me = useAuthStore.getState().user?.id;
    const friends = get().friends.filter((f) => memberIds.includes(f.id));
    if (!publicKey || !me || friends.length !== memberIds.length) throw new Error('arkadaşlar bulunamadı');
    const key = randomBytes(32);
    const wrappedKeys = friends.map((f) => ({ user_id: f.id, wrapped_key: wrapKeyFor(key, f.public_key) }));
    wrappedKeys.push({ user_id: me, wrapped_key: wrapKeyFor(key, b64(publicKey)) });
    const res = await api<{ channel: { id: string } }>('/gdms', {
      method: 'POST',
      body: { name, member_ids: memberIds, wrapped_keys: wrappedKeys },
    });
    set({ dmChannelKeys: setKeyEpoch(get().dmChannelKeys, res.channel.id, 1, key) });
    await get().loadBootstrap();
    set({ view: 'dm', activeDmId: res.channel.id });
  },

  // Member add = rekey: new key for everyone (new member can't read history).
  addGdmMember: async (gdmId, userId) => {
    const gdm = get().gdms.find((g) => g.id === gdmId);
    const friend = get().friends.find((f) => f.id === userId);
    if (!gdm || !friend) throw new Error('grup/arkadaş bulunamadı');
    const oldKey = get().dmChannelKeys[gdmId]?.[gdm.key_version];
    if (!oldKey) throw new Error('grup anahtarı yok');
    const newKey = randomBytes(32);
    const nextVersion = gdm.key_version + 1;
    const all = [...gdm.members.map((m) => ({ id: m.id, pub: m.public_key })), { id: friend.id, pub: friend.public_key }];
    const wrappedKeys = all.map((m) => ({ user_id: m.id, wrapped_key: wrapKeyFor(newKey, m.pub) }));
    await api(`/gdms/${gdmId}/members`, {
      method: 'POST',
      body: { user_id: userId, key_version: nextVersion, wrapped_keys: wrappedKeys },
    });
    set({ dmChannelKeys: setKeyEpoch(get().dmChannelKeys, gdmId, nextVersion, newKey) });
    await get().loadBootstrap();
  },

  // Leaving rekeys for those staying, so the leaver can't read the future.
  leaveGdm: async (gdmId) => {
    const gdm = get().gdms.find((g) => g.id === gdmId);
    if (!gdm) return;
    const oldKey = get().dmChannelKeys[gdmId]?.[gdm.key_version];
    const remaining = gdm.members.filter((m) => m.id !== useAuthStore.getState().user?.id);
    const body: { key_version?: number; wrapped_keys?: { user_id: string; wrapped_key: string }[] } = {};
    if (oldKey && remaining.length > 0) {
      const newKey = randomBytes(32);
      body.key_version = gdm.key_version + 1;
      body.wrapped_keys = remaining.map((m) => ({ user_id: m.id, wrapped_key: wrapKeyFor(newKey, m.public_key) }));
    }
    await api(`/gdms/${gdmId}/leave`, { method: 'POST', body });
    if (get().activeDmId === gdmId) set({ activeDmId: null });
    await get().loadBootstrap();
  },

  wireEvents: () => {
    onServerEvent((e) => {
      const me = useAuthStore.getState().user?.id;
      if (e.type === 'community:member_added') {
        void get().loadBootstrap();
      } else if (e.type === 'community:invite') {
        // staff "üye ekle" → hedefte onay modalı (davet kabul edilmeden
        // üyelik basılmaz). Chime: davetin geldiğini haber versin.
        const inv = e as unknown as { code: string; community_name: string; from_nick: string };
        get().setPendingInvite({ code: inv.code, communityName: inv.community_name, fromNick: inv.from_nick });
        if (useSettingsStore.getState().soundOn) playChime();
      } else if (e.type === 'community:member_removed') {
        if (e.user_id === me) {
          dropCommunity(e.community_id as string);
        } else {
          void get().loadBootstrap();
        }
      } else if (e.type === 'community:deleted') {
        dropCommunity(e.community_id as string);
      } else if (
        e.type === 'channel:created' ||
        e.type === 'channel:rotated' ||
        e.type === 'community:roles_updated' ||
        e.type === 'join_request:new' ||
        e.type === 'community:join_password' ||
        e.type === 'friend_request:new' ||
        e.type === 'friend:new' ||
        e.type === 'friend:removed' ||
        e.type === 'dm:new' ||
        e.type === 'gdm:new' ||
        e.type === 'gdm:updated'
      ) {
        void get().loadBootstrap();
      } else if (e.type === 'dh_update') {
        // self-update duyurusu (Faz 5c): Ed25519 doğrulaması + TOFU pin.
        // Faz 5d: imza REDDİ kırmızı güvenlik bandına bağlanır; malformed /
        // bilinmeyen gönderen sessizce düşer (çöp frame bandı spam'lemesin).
        const d = e as unknown as { channel_id: string; payload: string; from: string };
        const r = ingestDhUpdate(d.from, d.channel_id, d.payload, getSignKeys(d.from));
        const band = bandFromIngest(r);
        if (band) useSecurityStore.getState().flagDhUpdateRejected(band);
      } else if (e.type === 'keylog_head') {
        // Faz 6 — istemci-arası head gossip. Savunmacı ön kontrol
        // (sunucu da doğrular ama biz bağımsız kalırız). Kendi head'imiz
        // yoksa sessiz (kendi senkronumuzun sonucunu bekliyoruz).
        if (!isValidIncomingHead(e)) return;
        if (e.from === me) return; // kendi yayınımız — yankı yok
        const sec = useSecurityStore.getState();
        const myHead = sec.keylogHead;
        const action = classifyKeylogHead(myHead, e);
        if (action.kind === 'fork') {
          sec.flagKeylogFork(
            `id=${e.id} hash=${e.hash.slice(0, 8)}… görüldü: ${e.from}`,
          );
        } else if (action.kind === 'sync') {
          // gerideyiz → sessiz tetikleyici: yeni keylog çek, doğrula; eşleşirse
          // bant temizlenir, eşleşmezse syncKeyLog zaten kendi bandını kurar
          const auth = useAuthStore.getState();
          if (auth.user && auth.publicKey) {
            void sec.runKeyLogCheck(auth.user.id, auth.publicKey);
          }
        }
      } else if (e.type === 'device:link_request') {
        // Faz 7 — primary cihaza yeni cihaz bağlama isteği. Modal açar.
        const d = e as unknown as { device_id: string; device_name: string; ephemeral_pub: string };
        useDeviceStore.getState().setPendingLink({
          device_id: d.device_id,
          device_name: d.device_name,
          ephemeral_pub: d.ephemeral_pub,
        });
      } else if (e.type === 'device:link_approved') {
        // Joinee tarafında: approval geldi. finishLink UI tetikler.
        // Burada yalnız kayıt → deviceStore tarafında ownLinkInProgress
        // UI tarafından yönetilir; onay event'i UI'ı uyarır.
        const d = e as unknown as { link_token: string; approval: string };
        window.dispatchEvent(new CustomEvent('pgv:device-link-approved', { detail: d }));
      } else if (e.type === 'device:link_completed') {
        // Primary'a joinee'in başarıyla eklendiği bildirimi. Listeyi tazele.
        void get().loadBootstrap();
      } else if (e.type === 'device:revoked') {
        // Bir cihaz iptal edildi (bu cihaz dahil olabilir — sunucu
        // oturumu düşürmediği sürece biz yine de listeden düşürürüz).
        const d = e as unknown as { device_id: string };
        useDeviceStore.setState((s) => ({
          devices: s.devices.filter((dev) => dev.id !== d.device_id),
        }));
      }
    });

    // Faz 6 — gossip publisher kaydı + periyodik loop başlat.
    // Üye olunan topluluklar bootstrap'ten gelir (yeni topluluk eklendikçe
    // güncellenir). Head securityStore'dan okunur (syncKeyLog sonrası).
    const userId = useAuthStore.getState().user?.id;
    if (userId) {
      registerGossipPublisher({
        userId,
        communities: () => get().communities.map((c) => c.id),
        head: () => useSecurityStore.getState().keylogHead,
      });
      startGossipLoop();
      // JIT: ilk publish bir sonraki periyotu beklemeden — boot senkronundan
      // sonra aynı topluluktaki diğer istemciler hemen fark etsin
      publishKeylogHead();
    }
  },
}) });
