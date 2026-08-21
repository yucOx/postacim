import { create } from 'zustand';
import { api, ApiError, restoreToken, setToken } from '../api/client';
import type { AuthedUser } from '../api/types';
import { b64, unb64 } from '../crypto/bytes';
import { deriveKeys, newKdfSaltHex } from '../crypto/argon2';
import { generateIdentity, openIdentityBlob, sealIdentityBlob } from '../crypto/identity';
import { sodiumReady } from '../crypto/sodium';

// KEK lives for the tab's lifetime only — reload skips the password prompt,
// a new tab asks for it once.
const KEK_STORAGE_KEY = 'pgv_kek';

const saveKek = (kek: Uint8Array): void => sessionStorage.setItem(KEK_STORAGE_KEY, b64(kek));
const loadKek = (): Uint8Array | null => {
  const s = sessionStorage.getItem(KEK_STORAGE_KEY);
  return s ? unb64(s) : null;
};
const clearKek = (): void => sessionStorage.removeItem(KEK_STORAGE_KEY);

interface AuthState {
  status: 'loading' | 'anonymous' | 'authed';
  user: { id: string; nick: string } | null;
  publicKey: Uint8Array | null;
  privateKey: Uint8Array | null;
  kek: Uint8Array | null;
  register: (nick: string, password: string) => Promise<void>;
  login: (nick: string, password: string) => Promise<void>;
  changePassword: (oldPassword: string, newPassword: string) => Promise<void>;
  logout: () => Promise<void>;
  restore: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  status: 'loading',
  user: null,
  publicKey: null,
  privateKey: null,
  kek: null,

  register: async (nick, password) => {
    await sodiumReady;
    const kdfSalt = newKdfSaltHex();
    const { authMaterial, kek } = await deriveKeys(password, kdfSalt);
    const identity = generateIdentity();
    const res = await api<{ token: string; user: { id: string; nick: string } }>(
      '/auth/register',
      {
        method: 'POST',
        body: {
          nick,
          kdf_salt: kdfSalt,
          auth_material: b64(authMaterial),
          public_key: b64(identity.publicKey),
          key_blob: sealIdentityBlob(identity.privateKey, kek),
        },
      },
    );
    setToken(res.token);
    saveKek(kek);
    set({
      status: 'authed',
      user: res.user,
      publicKey: identity.publicKey,
      privateKey: identity.privateKey,
      kek,
    });
  },

  login: async (nick, password) => {
    await sodiumReady;
    const params = await api<{ kdf_salt: string }>(
      `/auth/kdf-params?nick=${encodeURIComponent(nick)}`,
    );
    const { authMaterial, kek } = await deriveKeys(password, params.kdf_salt);
    const res = await api<{ token: string; user: AuthedUser }>('/auth/login', {
      method: 'POST',
      body: { nick, auth_material: b64(authMaterial) },
    });
    const publicKey = unb64(res.user.public_key);
    let privateKey: Uint8Array;
    try {
      privateKey = openIdentityBlob(res.user.key_blob, kek);
    } catch {
      throw new ApiError(401, 'şifre hatalı');
    }
    setToken(res.token);
    saveKek(kek);
    set({
      status: 'authed',
      user: { id: res.user.id, nick: res.user.nick },
      publicKey,
      privateKey,
      kek,
    });
  },

  // Password change re-wraps the identity blob under the new KEK. Channel keys
  // are untouched: they are sealed to the X25519 identity, not the password.
  changePassword: async (oldPassword, newPassword) => {
    await sodiumReady;
    const nick = get().user?.nick;
    const { publicKey, privateKey } = get();
    if (!nick || !publicKey || !privateKey) throw new Error('giriş yapılmamış');
    const params = await api<{ kdf_salt: string }>(
      `/auth/kdf-params?nick=${encodeURIComponent(nick)}`,
    );
    const old = await deriveKeys(oldPassword, params.kdf_salt);
    const newSalt = newKdfSaltHex();
    const next = await deriveKeys(newPassword, newSalt);
    await api('/auth/password', {
      method: 'POST',
      body: {
        old_auth_material: b64(old.authMaterial),
        new_kdf_salt: newSalt,
        new_auth_material: b64(next.authMaterial),
        new_key_blob: sealIdentityBlob(privateKey, next.kek),
      },
    });
    saveKek(next.kek);
    set({ kek: next.kek });
  },

  logout: async () => {
    await api('/auth/logout', { method: 'POST' }).catch(() => {});
    setToken(null);
    clearKek();
    set({ status: 'anonymous', user: null, publicKey: null, privateKey: null, kek: null });
  },

  restore: async () => {
    const token = restoreToken();
    const kek = loadKek();
    if (!token || !kek) {
      set({ status: 'anonymous' });
      return;
    }
    try {
      await sodiumReady;
      const res = await api<{ user: AuthedUser }>('/auth/me');
      const privateKey = openIdentityBlob(res.user.key_blob, kek);
      set({
        status: 'authed',
        user: { id: res.user.id, nick: res.user.nick },
        publicKey: unb64(res.user.public_key),
        privateKey,
        kek,
      });
    } catch {
      setToken(null);
      clearKek();
      set({ status: 'anonymous' });
    }
  },
}));
