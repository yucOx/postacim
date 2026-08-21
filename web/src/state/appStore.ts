import { create } from 'zustand';
import { api } from '../api/client';
import type { BootstrapCommunity } from '../api/types';
import { useAuthStore } from './authStore';
import { b64, randomBytes } from '../crypto/bytes';
import { unwrapMyKey, wrapKeyFor } from '../crypto/identity';
import { onServerEvent } from '../ws/socket';

export interface Channel {
  id: string;
  name: string;
  type: 'text' | 'voice';
  key_version: number;
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
}

// channelId -> key_version -> raw channel key; epochs kept so rotated history stays readable
type KeyEpochs = Record<string, Record<number, Uint8Array>>;

interface AppState {
  loaded: boolean;
  communities: Community[];
  publicKeys: Record<string, string>;
  activeCommunityId: string | null;
  activeChannelId: string | null;
  channelKeys: KeyEpochs;
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
  addMember: (communityId: string, nick: string) => Promise<void>;
  removeMember: (communityId: string, userId: string) => Promise<void>;
  banMember: (communityId: string, userId: string) => Promise<void>;
  setRole: (communityId: string, userId: string, makeAdmin: boolean) => Promise<void>;
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

export const useAppStore = create<AppState>((set, get) => ({
  loaded: false,
  communities: [],
  publicKeys: {},
  activeCommunityId: null,
  activeChannelId: null,
  channelKeys: {},

  loadBootstrap: async () => {
    const data = await api<{ communities: BootstrapCommunity[]; public_keys: Record<string, string> }>(
      '/bootstrap',
    );
    const { communities, keys } = unwrapBootstrap(data.communities, get().channelKeys);
    const prevActiveChannel = get().activeChannelId;
    set({ loaded: true, communities, publicKeys: data.public_keys, channelKeys: keys });
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
    set({ activeCommunityId: id, activeChannelId: com?.channels.find((c) => c.type === 'text')?.id ?? null });
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
    await api(`/communities/${communityId}/members`, {
      method: 'POST',
      body: { user_id: target.id, wrapped_keys: wrapped },
    });
    // member_added broadcast triggers bootstrap refresh for everyone
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

  wireEvents: () => {
    onServerEvent((e) => {
      const me = useAuthStore.getState().user?.id;
      if (e.type === 'community:member_added') {
        void get().loadBootstrap();
      } else if (e.type === 'community:member_removed') {
        if (e.user_id === me) {
          const removed = e.community_id as string;
          const state = get();
          const communities = state.communities.filter((c) => c.id !== removed);
          const activeWasIn = state.activeCommunityId === removed;
          const first = communities[0];
          set({
            communities,
            activeCommunityId: activeWasIn ? (first?.id ?? null) : state.activeCommunityId,
            activeChannelId: activeWasIn
              ? (first?.channels.find((c) => c.type === 'text')?.id ?? null)
              : state.activeChannelId,
          });
        } else {
          void get().loadBootstrap();
        }
      } else if (e.type === 'channel:created' || e.type === 'channel:rotated' || e.type === 'community:roles_updated') {
        void get().loadBootstrap();
      }
    });
  },
}));
