import { create } from 'zustand';
import { Room, RoomEvent, ExternalE2EEKeyProvider, ScreenSharePresets, VideoPresets } from 'livekit-client';
import type { LocalParticipant, TrackPublishOptions, VideoCaptureOptions } from 'livekit-client';
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
  /** selected publish quality (kalite seçici); persisted in localStorage */
  quality: CallQuality;
  setQuality: (q: CallQuality) => void;
  /** quality the currently published screen share was started with */
  screenQuality: CallQuality | null;
  error: string | null;
  /** channelId -> participants (sidebar presence, from WS voice:update) */
  presence: Record<string, VoiceParticipant[]>;
  /** 1:1 DM call state; shares `room` (one call at a time) */
  callState: CallState | null;
  isDmCall: boolean;
  /** call window minimized to the corner — chat stays fully usable underneath */
  pip: boolean;
  setPip: (v: boolean) => void;
  /** PiP corner position, in px from top-left. Persisted so it sticks next time. */
  pipPos: { x: number; y: number };
  setPipPos: (p: { x: number; y: number }) => void;
  join: (channelId: string) => Promise<void>;
  leave: () => Promise<void>;
  toggleMic: () => Promise<void>;
  toggleCam: () => Promise<void>;
  toggleScreen: () => Promise<void>;
  startDmCall: (dmId: string, video?: boolean) => Promise<void>;
  acceptIncoming: () => Promise<void>;
  declineIncoming: () => Promise<void>;
  cancelCall: () => Promise<void>;
  wire: () => void;
}

const PIP_POS_KEY = 'postacim.pipPos';
const PIP_DEFAULT = { x: -1, y: -1 } as const; // -1 → "snap to bottom-right" in the widget

function loadPipPos(): { x: number; y: number } {
  try {
    const raw = localStorage.getItem(PIP_POS_KEY);
    if (!raw) return { x: PIP_DEFAULT.x, y: PIP_DEFAULT.y };
    const parsed = JSON.parse(raw) as { x?: number; y?: number };
    if (typeof parsed.x === 'number' && typeof parsed.y === 'number') {
      return { x: parsed.x, y: parsed.y };
    }
  } catch {
    // ignore — fall through
  }
  return { x: PIP_DEFAULT.x, y: PIP_DEFAULT.y };
}

export type CallQuality = 'hizli' | 'dengeli' | 'yuksek';

const QUALITY_KEY = 'postacim.voiceQuality';

function loadQuality(): CallQuality {
  try {
    const raw = localStorage.getItem(QUALITY_KEY);
    if (raw === 'hizli' || raw === 'dengeli' || raw === 'yuksek') return raw;
  } catch {
    // ignore — fall through to default
  }
  return 'dengeli';
}

/** Publish presets per quality tier. Simulcast is on by default; combined with
 *  adaptiveStream + dynacast on the room this is the fast-transfer path: the SFU
 *  forwards each receiver only the layer its bandwidth supports, and unused
 *  layers are not published at all. */
const qualityTiers: Record<
  CallQuality,
  { camCapture: VideoCaptureOptions; camPublish: TrackPublishOptions; screenPublish: TrackPublishOptions }
> = {
  // hızlı: small + framerate-first — encoder sheds resolution before frames
  hizli: {
    camCapture: { resolution: VideoPresets.h360.resolution },
    camPublish: { videoEncoding: VideoPresets.h360.encoding, degradationPreference: 'maintain-framerate' },
    screenPublish: { screenShareEncoding: ScreenSharePresets.h720fps15.encoding, degradationPreference: 'maintain-framerate' },
  },
  dengeli: {
    camCapture: { resolution: VideoPresets.h720.resolution },
    camPublish: { videoEncoding: VideoPresets.h720.encoding },
    screenPublish: { screenShareEncoding: ScreenSharePresets.h1080fps15.encoding },
  },
  // yüksek: resolution-first — encoder keeps pixels, drops frames if squeezed
  yuksek: {
    camCapture: { resolution: VideoPresets.h1080.resolution },
    camPublish: { videoEncoding: VideoPresets.h1080.encoding, degradationPreference: 'maintain-resolution' },
    screenPublish: { screenShareEncoding: ScreenSharePresets.h1080fps30.encoding, degradationPreference: 'maintain-resolution' },
  },
};

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
  // adaptiveStream + dynacast: receivers auto-switch to the simulcast layer their
  // bandwidth supports and unused layers stop being published — fastest transfer
  const room = new Room({ adaptiveStream: true, dynacast: true, encryption: { keyProvider, worker } });
  room.on(RoomEvent.EncryptionError, () => {
    useVoiceStore.setState({ error: 'E2EE hatası: anahtarlar uyuşmuyor' });
  });
  room.on(RoomEvent.Disconnected, onDisconnected);
  await keyProvider.setKey(key.slice().buffer as ArrayBuffer);
  await room.setE2EEEnabled(true);
  await room.connect(url, token);
  return { room, keyProvider };
}

export const useVoiceStore = create<VoiceState>((set, get) => {
  // full teardown: disconnect any live room and clear every call flag so the
  // next join / startDmCall / acceptIncoming never collides with stale state
  const teardownAll = (keepCallState = false): void => {
    const st = get();
    if (st.joinedChannelId && !st.isDmCall) {
      wsSend({ type: 'voice_state', channel_id: st.joinedChannelId, state: 'left' });
    }
    cleanup(st.room);
    set({
      room: null,
      keyProvider: null,
      joinedChannelId: null,
      micOn: false,
      camOn: false,
      screenOn: false,
      isDmCall: false,
      pip: false,
      callState: keepCallState ? st.callState : null,
    });
  };

  return {
  joinedChannelId: null,
  room: null,
  keyProvider: null,
  micOn: false,
  camOn: false,
  screenOn: false,
  quality: loadQuality(),
  screenQuality: null,
  error: null,
  presence: {},
  callState: null,
  isDmCall: false,
  pip: false,
  pipPos: loadPipPos(),

  setQuality: (q) => {
    try {
      localStorage.setItem(QUALITY_KEY, q);
    } catch {
      // private mode / quota — ignore, still update state
    }
    set({ quality: q });
  },

  setPip: (v) => set({ pip: v }),
  setPipPos: (p) => {
    try {
      localStorage.setItem('postacim.pipPos', JSON.stringify(p));
    } catch {
      // private mode / quota — ignore, still update state
    }
    set({ pipPos: p });
  },

  join: async (channelId) => {
    if (get().joinedChannelId === channelId && !get().isDmCall) return;
    // leave any current call first (fully clears room + flags)
    teardownAll();

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
          useVoiceStore.setState({ room: null, keyProvider: null, joinedChannelId: null, micOn: false, camOn: false, screenOn: false, isDmCall: false, callState: null, pip: false });
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
    set({ room: null, keyProvider: null, joinedChannelId: null, micOn: false, camOn: false, screenOn: false, isDmCall: false, callState: null, pip: false });
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
    const q = qualityTiers[get().quality];
    await (room.localParticipant as LocalParticipant).setCameraEnabled(
      next,
      next ? q.camCapture : undefined,
      next ? q.camPublish : undefined,
    );
    set({ camOn: next });
  },

  toggleScreen: async () => {
    const room = get().room;
    if (!room) return;
    const next = !get().screenOn;
    const q = get().quality;
    await room.localParticipant.setScreenShareEnabled(
      next,
      undefined,
      next ? qualityTiers[q].screenPublish : undefined,
    );
    set({ screenOn: next, screenQuality: next ? q : null });
  },

  // DM call: join the room, then ring. Media path identical to community calls
  // (same LiveKit E2EE machinery, DM channel key as the shared key). When video
  // is requested the camera opens before the ring so the callee sees the caller.
  startDmCall: async (dmId, video) => {
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
      // fresh start: tear down any previous room/community channel first
      teardownAll();
      const { url, token } = await api<VoiceTokenResponse>(`/dms/${dmId}/call-token`, { method: 'POST' });
      const onDisconnected = (): void => {
        const st = useVoiceStore.getState();
        if (st.room === room) {
          useVoiceStore.setState({ room: null, keyProvider: null, joinedChannelId: null, micOn: false, camOn: false, screenOn: false, isDmCall: false, callState: null, pip: false });
        }
      };
      const { room, keyProvider } = await connectRoom(key, url, token, onDisconnected);
      wsSend({ type: 'call:ring', channel_id: dmId });
      // open camera first so the callee can see the caller immediately on accept
      let camOpened = false;
      if (video) {
        const q = qualityTiers[get().quality];
        try {
          await (room.localParticipant as LocalParticipant).setCameraEnabled(true, q.camCapture, q.camPublish);
          camOpened = true;
        } catch {
          // permission denied or no camera — fall back to voice only
        }
      }
      set({
        room,
        keyProvider,
        joinedChannelId: dmId,
        micOn: false,
        camOn: camOpened,
        screenOn: false,
        isDmCall: true,
        callState: { phase: 'ringing', channelId: dmId, fromNick: video ? 'görüntülü arama' : undefined },
      });
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
      // tear down any previous room (community channel etc.) but keep callState
      // so a failed connect can be retried from the incoming banner
      teardownAll(true);
      const { url, token } = await api<VoiceTokenResponse>(`/dms/${call.channelId}/call-token`, { method: 'POST' });
      const onDisconnected = (): void => {
        const st = useVoiceStore.getState();
        if (st.room === room) {
          useVoiceStore.setState({ room: null, keyProvider: null, joinedChannelId: null, micOn: false, camOn: false, screenOn: false, isDmCall: false, callState: null, pip: false });
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
    set({ room: null, keyProvider: null, joinedChannelId: null, micOn: false, camOn: false, screenOn: false, isDmCall: false, callState: null, pip: false });
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
        if (call && call.phase !== 'ended') {
          // busy (ringing/active/incoming) → auto-decline the new one.
          // a leftover 'ended' state must NOT block the next call.
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
          set({ room: null, keyProvider: null, joinedChannelId: null, micOn: false, camOn: false, screenOn: false, isDmCall: false, pip: false, callState: { phase: 'ended', channelId: call.channelId, note: 'reddedildi' } });
          // no 3s lock — the "ara" button reads phase and is enabled in 'ended' too
        }
      } else if (e.type === 'call:cancelled') {
        const call = get().callState;
        if (call && call.channelId === e.channel_id && call.phase === 'incoming') {
          set({ callState: null });
        }
      } else if (e.type === 'call:ended') {
        // the other side hung up (or their socket dropped). tear the call down
        // immediately so the "ara" button comes back the moment we get the event.
        const call = get().callState;
        const reason = (e as { reason?: string }).reason ?? 'bitti';
        if (call && call.channelId === e.channel_id) {
          cleanup(get().room);
          set({
            room: null,
            keyProvider: null,
            joinedChannelId: null,
            micOn: false,
            camOn: false,
            screenOn: false,
            isDmCall: false,
            pip: false,
            callState: { phase: 'ended', channelId: call.channelId, note: reason },
          });
        }
      }
    });
  },
  };
});
