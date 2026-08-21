import { create } from 'zustand';
import { Room, RoomEvent, ExternalE2EEKeyProvider } from 'livekit-client';
import type { LocalParticipant } from 'livekit-client';
import { api } from '../api/client';
import type { VoiceTokenResponse } from '../api/types';
import { useAppStore } from './appStore';
import { useAuthStore } from './authStore';
import { unwrapMyKey } from '../crypto/identity';
import { onServerEvent, wsSend } from '../ws/socket';
// official subpath export; ?worker&inline bundles the SFrame worker into the app
import E2EEWorker from 'livekit-client/e2ee-worker?worker&inline';

export interface VoiceParticipant {
  user_id: string;
  nick: string;
}

export interface CallState {
  phase: 'ringing' | 'incoming' | 'active' | 'ended';
  channelId: string;
  fromNick?: string;
  note?: string;
}

interface VoiceState {
  joinedChannelId: string | null;
  room: Room | null;
  keyProvider: ExternalE2EEKeyProvider | null;
  micOn: boolean;
  camOn: boolean;
  screenOn: boolean;
  error: string | null;
  /** channelId -> participants (sidebar presence, from WS voice:update) */
  presence: Record<string, VoiceParticipant[]>;
  /** 1:1 DM call state; shares `room` (one call at a time) */
  callState: CallState | null;
  isDmCall: boolean;
  join: (channelId: string) => Promise<void>;
  leave: () => Promise<void>;
  toggleMic: () => Promise<void>;
  toggleCam: () => Promise<void>;
  toggleScreen: () => Promise<void>;
  startDmCall: (dmId: string) => Promise<void>;
  acceptIncoming: () => Promise<void>;
  declineIncoming: () => Promise<void>;
  cancelCall: () => Promise<void>;
  wire: () => void;
}

const cleanup = (room: Room | null): void => {
  if (!room) return;
  try {
    room.disconnect();
  } catch {
    // already gone
  }
};

// shared LiveKit+E2EE room builder for community channels and DM calls
async function connectRoom(
  key: Uint8Array,
  url: string,
  token: string,
  onDisconnected: () => void,
): Promise<{ room: Room; keyProvider: ExternalE2EEKeyProvider }> {
  const keyProvider = new ExternalE2EEKeyProvider();
  const worker = new E2EEWorker();
  const room = new Room({ encryption: { keyProvider, worker } });
  room.on(RoomEvent.EncryptionError, () => {
    useVoiceStore.setState({ error: 'E2EE hatası: anahtarlar uyuşmuyor' });
  });
  room.on(RoomEvent.Disconnected, onDisconnected);
  await keyProvider.setKey(key.slice().buffer as ArrayBuffer);
  await room.setE2EEEnabled(true);
  await room.connect(url, token);
  return { room, keyProvider };
}

export const useVoiceStore = create<VoiceState>((set, get) => ({
  joinedChannelId: null,
  room: null,
  keyProvider: null,
  micOn: false,
  camOn: false,
  screenOn: false,
  error: null,
  presence: {},
  callState: null,
  isDmCall: false,

  join: async (channelId) => {
    if (get().joinedChannelId === channelId && !get().isDmCall) return;
    // leave any current call first
    const prev = get().room;
    const prevChannel = get().joinedChannelId;
    if (prev) {
      if (prevChannel && !get().isDmCall) {
        wsSend({ type: 'voice_state', channel_id: prevChannel, state: 'left' });
      }
      cleanup(prev);
      set({ room: null, keyProvider: null, joinedChannelId: null, micOn: false, camOn: false, screenOn: false, isDmCall: false, callState: null });
    }

    set({ error: null });
    try {
      // 1. channel key (this is the E2EE key — SFU never sees it)
      const app = useAppStore.getState();
      const key = await app.ensureChannelKey(channelId);

      // 2. access token from our server
      const { url, token } = await api<VoiceTokenResponse>(`/channels/${channelId}/voice-token`, {
        method: 'POST',
      });

      const onDisconnected = (): void => {
        const st = useVoiceStore.getState();
        if (st.room === room) {
          if (st.joinedChannelId && !st.isDmCall) {
            wsSend({ type: 'voice_state', channel_id: st.joinedChannelId, state: 'left' });
          }
          useVoiceStore.setState({ room: null, keyProvider: null, joinedChannelId: null, micOn: false, camOn: false, screenOn: false, isDmCall: false, callState: null });
        }
      };
      const { room, keyProvider } = await connectRoom(key, url, token, onDisconnected);
      wsSend({ type: 'voice_state', channel_id: channelId, state: 'joined' });
      set({ room, keyProvider, joinedChannelId: channelId, micOn: false, camOn: false, isDmCall: false });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'bağlanılamadı' });
      throw err;
    }
  },

  leave: async () => {
    const { room, joinedChannelId, isDmCall, callState } = get();
    if (joinedChannelId && !isDmCall) {
      wsSend({ type: 'voice_state', channel_id: joinedChannelId, state: 'left' });
    }
    if (isDmCall && callState) {
      wsSend({ type: 'call:cancel', channel_id: callState.channelId });
    }
    cleanup(room);
    set({ room: null, keyProvider: null, joinedChannelId: null, micOn: false, camOn: false, screenOn: false, isDmCall: false, callState: null });
  },

  toggleMic: async () => {
    const room = get().room;
    if (!room) return;
    const next = !get().micOn;
    await (room.localParticipant as LocalParticipant).setMicrophoneEnabled(next);
    set({ micOn: next });
  },

  toggleCam: async () => {
    const room = get().room;
    if (!room) return;
    const next = !get().camOn;
    await (room.localParticipant as LocalParticipant).setCameraEnabled(next);
    set({ camOn: next });
  },

  toggleScreen: async () => {
    const room = get().room;
    if (!room) return;
    const next = !get().screenOn;
    await room.localParticipant.setScreenShareEnabled(next);
    set({ screenOn: next });
  },

  // DM call: join the room, then ring. Media path identical to community calls
  // (same LiveKit E2EE machinery, DM channel key as the shared key).
  startDmCall: async (dmId) => {
    if (get().isDmCall && get().callState?.channelId === dmId) return;
    set({ error: null });
    try {
      const app = useAppStore.getState();
      let key: Uint8Array | undefined = app.dmChannelKeys[dmId]?.[app.dms.find((d) => d.id === dmId)?.key_version ?? 1];
      if (!key) {
        // DM opened by peer first — fetch + unwrap our copy
        await app.loadBootstrap();
        const fresh = useAppStore.getState();
        const dm = fresh.dms.find((d) => d.id === dmId);
        key = dm ? fresh.dmChannelKeys[dmId]?.[dm.key_version] : undefined;
        if (!key) {
          const res = await api<{ key_version: number; wrapped_key: string }>(`/dms/${dmId}/my-key`, {
            method: 'POST',
          });
          const { publicKey, privateKey } = useAuthStore.getState();
          if (!publicKey || !privateKey) throw new Error('kimlik yok');
          key = unwrapMyKey(res.wrapped_key, publicKey, privateKey);
        }
      }
      if (!key) throw new Error('DM anahtarı yok');
      const prev = get().room;
      if (prev) cleanup(prev);
      const { url, token } = await api<VoiceTokenResponse>(`/dms/${dmId}/call-token`, { method: 'POST' });
      const onDisconnected = (): void => {
        const st = useVoiceStore.getState();
        if (st.room === room) {
          useVoiceStore.setState({ room: null, keyProvider: null, joinedChannelId: null, micOn: false, camOn: false, screenOn: false, isDmCall: false, callState: null });
        }
      };
      const { room, keyProvider } = await connectRoom(key, url, token, onDisconnected);
      wsSend({ type: 'call:ring', channel_id: dmId });
      set({ room, keyProvider, joinedChannelId: dmId, micOn: false, camOn: false, isDmCall: true, callState: { phase: 'ringing', channelId: dmId } });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'aranamadı' });
      throw err;
    }
  },

  acceptIncoming: async () => {
    const call = get().callState;
    if (!call || call.phase !== 'incoming') return;
    try {
      wsSend({ type: 'call:accept', channel_id: call.channelId });
      const app = useAppStore.getState();
      let key: Uint8Array | undefined = app.dmChannelKeys[call.channelId]?.[app.dms.find((d) => d.id === call.channelId)?.key_version ?? 1];
      if (!key) {
        await app.loadBootstrap();
        const fresh = useAppStore.getState();
        const dm = fresh.dms.find((d) => d.id === call.channelId);
        key = dm ? fresh.dmChannelKeys[call.channelId]?.[dm.key_version] : undefined;
        if (!key) throw new Error('DM anahtarı yok');
      }
      if (!key) throw new Error('DM anahtarı yok');
      const prev = get().room;
      if (prev) cleanup(prev);
      const { url, token } = await api<VoiceTokenResponse>(`/dms/${call.channelId}/call-token`, { method: 'POST' });
      const onDisconnected = (): void => {
        const st = useVoiceStore.getState();
        if (st.room === room) {
          useVoiceStore.setState({ room: null, keyProvider: null, joinedChannelId: null, micOn: false, camOn: false, screenOn: false, isDmCall: false, callState: null });
        }
      };
      const { room, keyProvider } = await connectRoom(key, url, token, onDisconnected);
      set({ room, keyProvider, joinedChannelId: call.channelId, micOn: false, camOn: false, isDmCall: true, callState: { phase: 'active', channelId: call.channelId } });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'bağlanılamadı' });
      throw err;
    }
  },

  declineIncoming: async () => {
    const call = get().callState;
    if (!call || call.phase !== 'incoming') return;
    wsSend({ type: 'call:decline', channel_id: call.channelId });
    set({ callState: null });
  },

  cancelCall: async () => {
    const { callState, room } = get();
    if (callState && callState.phase === 'ringing') {
      wsSend({ type: 'call:cancel', channel_id: callState.channelId });
    }
    cleanup(room);
    set({ room: null, keyProvider: null, joinedChannelId: null, micOn: false, camOn: false, screenOn: false, isDmCall: false, callState: null });
  },

  wire: () => {
    onServerEvent((e) => {
      if (e.type === 'voice:update') {
        const channelId = e.channel_id as string;
        const participants = (e.participants as VoiceParticipant[]) ?? [];
        set((s) => ({ presence: { ...s.presence, [channelId]: participants } }));
      } else if (e.type === 'channel:rotated') {
        // live rekey: refresh epochs, then hand the new key to SFrame
        const channelId = e.channel_id as string;
        if (get().joinedChannelId === channelId && get().keyProvider) {
          void (async () => {
            try {
              await useAppStore.getState().loadBootstrap();
              const key = useAppStore.getState().currentKey(channelId);
              if (key) await get().keyProvider!.setKey(key.slice().buffer as ArrayBuffer);
            } catch {
              // stay on old key; user can rejoin
            }
          })();
        }
      } else if (e.type === 'call:incoming') {
        const call = get().callState;
        if (call) {
          // busy → auto-decline the new one
          wsSend({ type: 'call:decline', channel_id: e.channel_id as string });
          return;
        }
        set({
          callState: {
            phase: 'incoming',
            channelId: e.channel_id as string,
            fromNick: (e.from as { nick?: string } | undefined)?.nick ?? '?',
          },
        });
      } else if (e.type === 'call:accepted') {
        const call = get().callState;
        if (call && call.channelId === e.channel_id && call.phase === 'ringing') {
          set({ callState: { ...call, phase: 'active' } });
        }
      } else if (e.type === 'call:declined') {
        const call = get().callState;
        if (call && call.channelId === e.channel_id) {
          cleanup(get().room);
          set({ room: null, keyProvider: null, joinedChannelId: null, micOn: false, camOn: false, screenOn: false, isDmCall: false, callState: { phase: 'ended', channelId: call.channelId, note: 'reddedildi' } });
          setTimeout(() => {
            const st = get().callState;
            if (st?.phase === 'ended') set({ callState: null });
          }, 3000);
        }
      } else if (e.type === 'call:cancelled') {
        const call = get().callState;
        if (call && call.channelId === e.channel_id && call.phase === 'incoming') {
          set({ callState: null });
        }
      }
    });
  },
}));
