import { create } from 'zustand';
import { Room, RoomEvent, ExternalE2EEKeyProvider } from 'livekit-client';
import type { LocalParticipant } from 'livekit-client';
import { api } from '../api/client';
import type { VoiceTokenResponse } from '../api/types';
import { useAppStore } from './appStore';
import { onServerEvent, wsSend } from '../ws/socket';
// official subpath export; ?worker&inline bundles the SFrame worker into the app
import E2EEWorker from 'livekit-client/e2ee-worker?worker&inline';

export interface VoiceParticipant {
  user_id: string;
  nick: string;
}

interface VoiceState {
  joinedChannelId: string | null;
  room: Room | null;
  micOn: boolean;
  camOn: boolean;
  error: string | null;
  /** channelId -> participants (sidebar presence, from WS voice:update) */
  presence: Record<string, VoiceParticipant[]>;
  join: (channelId: string) => Promise<void>;
  leave: () => Promise<void>;
  toggleMic: () => Promise<void>;
  toggleCam: () => Promise<void>;
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

export const useVoiceStore = create<VoiceState>((set, get) => ({
  joinedChannelId: null,
  room: null,
  micOn: false,
  camOn: false,
  error: null,
  presence: {},

  join: async (channelId) => {
    if (get().joinedChannelId === channelId) return;
    // leave any current call first
    const prev = get().room;
    const prevChannel = get().joinedChannelId;
    if (prev) {
      if (prevChannel) wsSend({ type: 'voice_state', channel_id: prevChannel, state: 'left' });
      cleanup(prev);
      set({ room: null, joinedChannelId: null, micOn: false, camOn: false });
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

      // 3. Room with SFrame E2EE + shared key
      const keyProvider = new ExternalE2EEKeyProvider();
      const worker = new E2EEWorker();
      const room = new Room({ encryption: { keyProvider, worker } });
      room.on(RoomEvent.EncryptionError, () => {
        set({ error: 'E2EE hatası: anahtarlar uyuşmuyor' });
      });
      room.on(RoomEvent.Disconnected, () => {
        if (get().room === room) {
          if (get().joinedChannelId) {
            wsSend({ type: 'voice_state', channel_id: get().joinedChannelId, state: 'left' });
          }
          set({ room: null, joinedChannelId: null, micOn: false, camOn: false });
        }
      });
      // setKey: random bytes → ArrayBuffer → HKDF path (all clients here are livekit-client)
      await keyProvider.setKey(key.slice().buffer as ArrayBuffer);
      await room.setE2EEEnabled(true);
      await room.connect(url, token);
      wsSend({ type: 'voice_state', channel_id: channelId, state: 'joined' });
      set({ room, joinedChannelId: channelId, micOn: false, camOn: false });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'bağlanılamadı' });
      throw err;
    }
  },

  leave: async () => {
    const { room, joinedChannelId } = get();
    if (joinedChannelId) wsSend({ type: 'voice_state', channel_id: joinedChannelId, state: 'left' });
    cleanup(room);
    set({ room: null, joinedChannelId: null, micOn: false, camOn: false });
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

  wire: () => {
    onServerEvent((e) => {
      if (e.type === 'voice:update') {
        const channelId = e.channel_id as string;
        const participants = (e.participants as VoiceParticipant[]) ?? [];
        set((s) => ({ presence: { ...s.presence, [channelId]: participants } }));
      }
    });
  },
}));
