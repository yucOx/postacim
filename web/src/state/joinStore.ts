import { create } from 'zustand';
import { api } from '../api/client';
import { useAuthStore } from './authStore';
import { useAppStore } from './appStore';
import { b64 } from '../crypto/bytes';
import { deriveKeys } from '../crypto/argon2';
import { sodiumReady } from '../crypto/sodium';
import { unsealWithEphemeral } from '../crypto/invite';
import { openJoinKey } from '../crypto/joinpw';
import { unwrapMyKey, wrapKeyFor } from '../crypto/identity';

export interface SealedChannelKey {
  channel_id: string;
  key_version: number;
  wrapped_key: string;
}

interface RedeemInfo {
  community: { id: string; name: string };
  requires_password: boolean;
  join_kdf_salt?: string;
  wrapped_keys?: SealedChannelKey[];
}

interface JoinState {
  status: 'idle' | 'loading' | 'needs_password' | 'ready' | 'joining' | 'joined';
  error: string | null;
  communityName: string | null;
  joinSalt: string | null;
  code: string | null;
  ephPriv: Uint8Array | null;
  sealedKeys: SealedChannelKey[] | null;
  keys: { channel_id: string; key_version: number; key: Uint8Array }[] | null;
  start: (code: string, ephPriv: Uint8Array | null) => Promise<void>;
  submitPassword: (password: string) => Promise<void>;
  complete: () => Promise<void>;
  reset: () => void;
}

function unwrapSealed(
  sealed: SealedChannelKey[],
  ephPriv: Uint8Array | null,
): { channel_id: string; key_version: number; key: Uint8Array }[] {
  const { publicKey, privateKey } = useAuthStore.getState();
  if (!publicKey || !privateKey) throw new Error('kimlik yok');
  // open invite → ephemeral half from the link; targeted invite → own identity
  return sealed.map((s) => ({
    channel_id: s.channel_id,
    key_version: s.key_version,
    key: ephPriv
      ? unsealWithEphemeral(s.wrapped_key, ephPriv)
      : unwrapMyKey(s.wrapped_key, publicKey, privateKey),
  }));
}

export const useJoinStore = create<JoinState>((set, get) => ({
  status: 'idle',
  error: null,
  communityName: null,
  joinSalt: null,
  code: null,
  ephPriv: null,
  sealedKeys: null,
  keys: null,

  start: async (code, ephPriv) => {
    await sodiumReady;
    set({ status: 'loading', error: null, code, ephPriv, sealedKeys: null, keys: null, communityName: null });
    try {
      const info = await api<RedeemInfo>(`/invites/${encodeURIComponent(code)}`);
      if (info.requires_password) {
        set({
          status: 'needs_password',
          communityName: info.community.name,
          joinSalt: info.join_kdf_salt ?? null,
          sealedKeys: [],
        });
        return;
      }
      set({ communityName: info.community.name, sealedKeys: info.wrapped_keys ?? [], status: 'ready' });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'davet okunamadı', status: 'idle' });
    }
  },

  // Password gate: derive proof + JW, exchange proof for the JW-sealed keys.
  submitPassword: async (password) => {
    const { code, joinSalt } = get();
    if (!code || !joinSalt) return;
    set({ error: null });
    try {
      const { authMaterial, kek } = await deriveKeys(password, joinSalt);
      const res = await api<{ community: { id: string; name: string }; wrapped_keys: SealedChannelKey[] }>(
        `/invites/${encodeURIComponent(code)}/redeem-password`,
        { method: 'POST', body: { auth_material: b64(authMaterial) } },
      );
      const keys = res.wrapped_keys.map((w) => ({
        channel_id: w.channel_id,
        key_version: w.key_version,
        key: openJoinKey(w.wrapped_key, kek),
      }));
      set({ keys, communityName: res.community.name, status: 'ready' });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'şifre doğrulanamadı' });
    }
  },

  complete: async () => {
    const { code, sealedKeys, ephPriv } = get();
    if (!code || !sealedKeys?.length) return;
    set({ status: 'joining', error: null });
    try {
      const keys = get().keys ?? unwrapSealed(sealedKeys, ephPriv);
      set({ keys });
      const { publicKey } = useAuthStore.getState();
      if (!publicKey) throw new Error('kimlik yok');
      await api(`/invites/${encodeURIComponent(code)}/complete`, {
        method: 'POST',
        body: {
          wrapped_keys: keys.map((k) => ({
            channel_id: k.channel_id,
            key_version: k.key_version,
            wrapped_key: wrapKeyFor(k.key, b64(publicKey)),
          })),
        },
      });
      // seed own key epochs so history decrypts immediately
      const app = useAppStore.getState();
      let epochs = app.channelKeys;
      for (const k of keys) {
        epochs = {
          ...epochs,
          [k.channel_id]: { ...(epochs[k.channel_id] ?? {}), [k.key_version]: k.key },
        };
      }
      useAppStore.setState({ channelKeys: epochs });
      await app.loadBootstrap();
      set({ status: 'joined' });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'katılım tamamlanamadı', status: 'ready' });
    }
  },

  reset: () =>
    set({
      status: 'idle',
      error: null,
      communityName: null,
      joinSalt: null,
      code: null,
      ephPriv: null,
      sealedKeys: null,
      keys: null,
    }),
}));
