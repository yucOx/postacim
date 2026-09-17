import { create } from 'zustand';
import { Room, RoomEvent, Track, ExternalE2EEKeyProvider, ScreenSharePresets, VideoPresets } from 'livekit-client';
import type { LocalParticipant, TrackPublishOptions, VideoCaptureOptions } from 'livekit-client';
import { api } from '../api/client';
import type { VoiceTokenResponse } from '../api/types';
import { useAppStore } from './appStore';
import { useAuthStore } from './authStore';
import { unwrapMyKey } from '../crypto/identity';
import { dhVoiceKeyAnchor, dhVoiceKeyDm } from '../crypto/dhratchet';
import { unb64 } from '../crypto/bytes';
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
  /** the community voice channel the user manually left — VoiceRoom's
   *  auto-join effect must not rejoin it until an explicit join clears it */
  leftChannelId: string | null;
  room: Room | null;
  keyProvider: ExternalE2EEKeyProvider | null;
  micOn: boolean;
  camOn: boolean;
  screenOn: boolean;
  /** master output volume 0..1 */
  volume: number;
  /** deafened / muted incoming audio */
  deafened: boolean;
  setVolume: (v: number) => void;
  toggleDeafen: () => void;
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
  /** pinned = the mini call widget floats above modals/menus too. Persisted. */
  pipPinned: boolean;
  setPipPinned: (v: boolean) => void;
  join: (channelId: string) => Promise<void>;
  leave: () => Promise<void>;
  toggleMic: () => Promise<void>;
  toggleCam: () => Promise<void>;
  toggleScreen: () => Promise<void>;
  /** Discord Go Live akışı: diyaloğa girilen ayrıntılarla yayın başlat */
  startScreen: (opts: ShareOpts) => Promise<void>;
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

const PIP_PINNED_KEY = 'postacim.voicePipPinned';

function loadPipPinned(): boolean {
  try {
    return localStorage.getItem(PIP_PINNED_KEY) === '1';
  } catch {
    return false;
  }
}

export type CallQuality = 'hizli' | 'dengeli' | 'yuksek';

/** Detaylı yayın diyaloğunun seçimleri (Discord Go Live benzeri). surface,
 *  tarayıcının kaynak seçim ekranını ilgili kategoriye ön seçer — kaynak yine
 *  tarayıcıda seçilir (web'de pencereler listelenemez). */
export interface ShareOpts {
  /** capture genişliği — 1280 (720p) gibi */
  w: number;
  /** capture yüksekliği — 720, 1080, 1440… */
  h: number;
  fps: 15 | 30 | 60;
  /** sekme/sistem sesini de yayınla */
  audio: boolean;
  /** kaynak ipucu: tüm ekran / pencere / sekme */
  surface: 'monitor' | 'window' | 'browser';
}

/** [yükseklik][fps] → maxBitrate; diyalogdaki çözünürlük × fps ikilileri */
const SHARE_BITRATES: Record<number, Record<number, number>> = {
  360: { 15: 500_000, 30: 800_000, 60: 1_200_000 },
  480: { 15: 800_000, 30: 1_200_000, 60: 1_800_000 },
  720: { 15: 1_500_000, 30: 2_500_000, 60: 4_000_000 },
  1080: { 15: 2_500_000, 30: 4_000_000, 60: 6_000_000 },
  1440: { 15: 4_000_000, 30: 6_000_000, 60: 9_000_000 },
};

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
  // hızlı: small + framerate-first — encoder sheds resolution before frames.
  // Ekran paylaşımı hep VP9: metin/UI içeriği VP8'e göre ~yarı bitratete aynı
  // netlik (E2EE codec-agnostik — SFrame paketlemeden önce şifreler). Kamera
  // VP8 kalır: browser VP9 simulcast desteği zayıf.
  hizli: {
    camCapture: { resolution: VideoPresets.h360.resolution },
    camPublish: { videoEncoding: VideoPresets.h360.encoding, degradationPreference: 'maintain-framerate' },
    screenPublish: { screenShareEncoding: ScreenSharePresets.h720fps15.encoding, videoCodec: 'vp9', degradationPreference: 'maintain-framerate' },
  },
  dengeli: {
    camCapture: { resolution: VideoPresets.h720.resolution },
    camPublish: { videoEncoding: VideoPresets.h720.encoding },
    screenPublish: { screenShareEncoding: ScreenSharePresets.h1080fps15.encoding, videoCodec: 'vp9' },
  },
  // yüksek: resolution-first — encoder keeps pixels, drops frames if squeezed.
  // TEST AŞAMASI: kamera 1080p bilinçli kapalı — dengeli ile aynı kamera
  // preseti, fark yalnız ekran paylaşımında (1080p30). Kapasite oturunca
  // camCapture/camPublish VideoPresets.h1080'e döner.
  yuksek: {
    camCapture: { resolution: VideoPresets.h720.resolution },
    camPublish: { videoEncoding: VideoPresets.h720.encoding, degradationPreference: 'maintain-resolution' },
    screenPublish: { screenShareEncoding: ScreenSharePresets.h1080fps30.encoding, videoCodec: 'vp9', degradationPreference: 'maintain-resolution' },
  },
};

// encoder ipucu: ekran = 'detail' (kare at, netliği koru), kamera = 'motion'
// (akıcılık koru). Publish bittikten sonra track'in mediaStreamTrack'ine
// yazılır — encoder'a ücretsiz yönlendirme.
function hintTrack(src: Track.Source): void {
  const st = useVoiceStore.getState();
  const pub = st.room?.localParticipant.getTrackPublication(src);
  const mst = pub?.track?.mediaStreamTrack;
  if (mst) mst.contentHint = src === Track.Source.ScreenShare ? 'detail' : 'motion';
}

const cleanup = (room: Room | null): void => {
  if (!room) return;
  try {
    room.disconnect();
  } catch {
    // already gone
  }
};

// Faz 5d — SFrame anahtarı artık v4 DH zincirinden türetilir (spec §7):
// kanal sesi epok DH çapasına, DM araması iki tarafın statik kimlik DH'ine
// bağlı. Epok başına sabit (arama başında pin); epok rekey'inde channel:rotated
// yolu yeni anahtarı setKey eder. DM'de karşı tarafın kimlik anahtarı
// bulunamazsa ESKİ türetim (ham epok anahtarı) — eski istemciyle uyumlu tek
// durum; aksi halde türetim her iki tarafta deterministik ve aynıdır.
async function sframeKey(raw: Uint8Array, scope: 'ch' | 'dm', peerId?: string): Promise<Uint8Array> {
  if (scope === 'dm' && peerId) {
    const pubOf = (s: ReturnType<typeof useAppStore.getState>): string | undefined =>
      s.publicKeys[peerId] ?? s.friends.find((f) => f.id === peerId)?.public_key;
    let peerPub = pubOf(useAppStore.getState());
    if (!peerPub) {
      await useAppStore.getState().loadBootstrap();
      peerPub = pubOf(useAppStore.getState());
    }
    const { privateKey } = useAuthStore.getState();
    if (peerPub && privateKey) {
      try {
        return dhVoiceKeyDm(raw, privateKey, unb64(peerPub));
      } catch {
        // tüm-sıfır DH çıktısı (libsodium reddi) — eski türetimde kal
      }
    }
    return raw;
  }
  return dhVoiceKeyAnchor(raw);
}

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
  const room = new Room({
    adaptiveStream: true,
    dynacast: true,
    encryption: { keyProvider, worker },
    // 2 vCPU/3 GB VPS için uplink sınırı (docs/NETWORKING.md §10). Server
    // tarafı v1.x bu alanları kabul etmiyor; client-side cap uyguluyoruz
    // (manipüle edilebilir ama gizlilik için sorun değil — SFrame zaten
    // içeriği şifreli, sadece SFU CPU'su için). 1.5 Mbps = 720p VP8 + 128kbps
    // Opus; 4K gönderen kullanıcı encoder'ı 1.5 Mbps'ye sıkıştırır.
    publishDefaults: {
      videoEncoding: { maxBitrate: 1_500_000 },
      screenShareEncoding: { maxBitrate: 1_500_000 },
    },
  });
  room.on(RoomEvent.EncryptionError, () => {
    useVoiceStore.setState({ error: 'E2EE hatası: anahtarlar uyuşmuyor' });
  });
  room.on(RoomEvent.Disconnected, onDisconnected);
  try {
    await keyProvider.setKey(key.slice().buffer as ArrayBuffer);
    await room.setE2EEEnabled(true);
    await room.connect(url, token);
  } catch (err) {
    // a failed attempt must not leak its half-connected room + worker
    cleanup(room);
    throw err;
  }
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
  leftChannelId: null,
  room: null,
  keyProvider: null,
  micOn: false,
  camOn: false,
  screenOn: false,
  volume: 1,
  deafened: false,
  setVolume: (v) => set({ volume: Math.max(0, Math.min(1, v)), deafened: false }),
  toggleDeafen: () => set((s) => ({ deafened: !s.deafened })),
  quality: loadQuality(),
  screenQuality: null,
  error: null,
  presence: {},
  callState: null,
  isDmCall: false,
  pip: false,
  pipPos: loadPipPos(),
  pipPinned: loadPipPinned(),

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

  setPipPinned: (v) => {
    try {
      localStorage.setItem(PIP_PINNED_KEY, v ? '1' : '0');
    } catch {
      // private mode / quota — ignore, still update state
    }
    set({ pipPinned: v });
  },

  join: async (channelId) => {
    if (get().joinedChannelId === channelId && !get().isDmCall) return;
    // leave any current call first (fully clears room + flags)
    teardownAll();

    set({ error: null });
    try {
      // 1. channel key (E2EE kökü — SFU hiç görmez); SFrame anahtarı bunun
      //    DH zincirinden türetilir (Faz 5d)
      const app = useAppStore.getState();
      const key = await app.ensureChannelKey(channelId);
      const voiceKey = await sframeKey(key, 'ch');

      // 2. access token from our server
      const { url, token } = await api<VoiceTokenResponse>(`/channels/${channelId}/voice-token`, {
        method: 'POST',
      });

      // "could not establish pc connection": livekit gives the RTCPeerConnection
      // 15s to reach CONNECTED, and ICE sometimes loses that race on an
      // otherwise-fine network (mDNS candidate lookups, TURN relay probing,
      // dead-interface candidate pairs). The second attempt is warm and fast —
      // retry instead of dead-ending the join.
      let lastErr: unknown = null;
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          const onDisconnected = (): void => {
            const st = useVoiceStore.getState();
            if (st.room === room) {
              if (st.joinedChannelId && !st.isDmCall) {
                wsSend({ type: 'voice_state', channel_id: st.joinedChannelId, state: 'left' });
              }
              useVoiceStore.setState({ room: null, keyProvider: null, joinedChannelId: null, micOn: false, camOn: false, screenOn: false, isDmCall: false, callState: null, pip: false });
            }
          };
          const { room, keyProvider } = await connectRoom(voiceKey, url, token, onDisconnected);
          wsSend({ type: 'voice_state', channel_id: channelId, state: 'joined' });
          set({ room, keyProvider, joinedChannelId: channelId, leftChannelId: null, micOn: false, camOn: false, isDmCall: false });
          return;
        } catch (err) {
          lastErr = err;
          if (attempt < 3) {
            set({ error: `bağlantı kuruluyor — yeniden deneniyor (${attempt + 1}/3)…` });
            await new Promise((r) => setTimeout(r, 1200 * attempt));
          }
        }
      }
      throw lastErr;
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
    set({
      room: null,
      keyProvider: null,
      joinedChannelId: null,
      // remember the manual leave — VoiceRoom's auto-join would otherwise
      // reconnect the user to the room they just hung up on
      leftChannelId: joinedChannelId && !isDmCall ? joinedChannelId : null,
      micOn: false,
      camOn: false,
      screenOn: false,
      isDmCall: false,
      callState: null,
      pip: false,
    });
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
    if (next) hintTrack(Track.Source.Camera);
    set({ camOn: next });
  },

  toggleScreen: async () => {
    const room = get().room;
    if (!room) return;
    const next = !get().screenOn;
    const q = get().quality;
    await room.localParticipant.setScreenShareEnabled(
      next,
      // sekme/sistem sesi de paylaşılabilir — izleyici sesi kısabilir/kapatabilir
      { audio: true },
      next ? qualityTiers[q].screenPublish : undefined,
    );
    if (next) hintTrack(Track.Source.ScreenShare);
    set({ screenOn: next, screenQuality: next ? q : null });
  },

  // detaylı diyaloğun seçimleriyle yayın başlat (Discord Go Live benzeri).
  // bitrate tablosu Discord'un Go Live hedeflerine yaklaşık eşlenir; yüksek
  // fps'te kare hızı korunur, statik içerikte çözünürlük.
  startScreen: async (opts) => {
    const room = get().room;
    if (!room) return;
    const bitrate = SHARE_BITRATES[opts.h]?.[opts.fps] ?? 2_500_000;
    try {
      await room.localParticipant.setScreenShareEnabled(
        true,
        {
          audio: opts.audio,
          resolution: { width: opts.w, height: opts.h, frameRate: opts.fps },
          video: { displaySurface: opts.surface },
          selfBrowserSurface: 'exclude',
          systemAudio: 'include',
        },
        {
          screenShareEncoding: { maxBitrate: bitrate, maxFramerate: opts.fps },
          videoCodec: 'vp9',
          degradationPreference: opts.fps >= 60 ? 'maintain-framerate' : 'maintain-resolution',
        },
      );
      hintTrack(Track.Source.ScreenShare);
      set({ screenOn: true, screenQuality: null });
    } catch (err) {
      set({ error: err instanceof Error ? `yayın başlatılamadı: ${err.message}` : 'yayın başlatılamadı' });
    }
  },

  // DM call: join the room, then ring. Media path identical to community calls
  // (same LiveKit E2EE machinery; SFrame key derived from the DM DH chain — 5d).
  // When video is requested the camera opens before the ring so the callee sees the caller.
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
      const peerId = app.dms.find((d) => d.id === dmId)?.peer.id;
      const voiceKey = await sframeKey(key, 'dm', peerId);
      // fresh start: tear down any previous room/community channel first
      teardownAll();
      const { url, token } = await api<VoiceTokenResponse>(`/dms/${dmId}/call-token`, { method: 'POST' });
      const onDisconnected = (): void => {
        const st = useVoiceStore.getState();
        if (st.room === room) {
          useVoiceStore.setState({ room: null, keyProvider: null, joinedChannelId: null, micOn: false, camOn: false, screenOn: false, isDmCall: false, callState: null, pip: false });
        }
      };
      const { room, keyProvider } = await connectRoom(voiceKey, url, token, onDisconnected);
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
      const peerId = app.dms.find((d) => d.id === call.channelId)?.peer.id;
      const voiceKey = await sframeKey(key, 'dm', peerId);
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
      const { room, keyProvider } = await connectRoom(voiceKey, url, token, onDisconnected);
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
        // live rekey: refresh epochs, then hand the new key to SFrame.
        // Faz 5d: SFrame anahtarı DH zincirinden türetildiği için rekey zincir
        // seed'i + çapayı da çevirir — atılan üye yeni ses anahtarını da türetemez.
        const channelId = e.channel_id as string;
        if (get().joinedChannelId === channelId && get().keyProvider) {
          void (async () => {
            try {
              await useAppStore.getState().loadBootstrap();
              const key = useAppStore.getState().currentKey(channelId);
              if (key) await get().keyProvider!.setKey((await sframeKey(key, 'ch')).slice().buffer as ArrayBuffer);
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
