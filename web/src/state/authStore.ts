import { create } from 'zustand';
import { api, ApiError } from '../api/client';
import type { AuthedUser } from '../api/types';
import { b64, unb64 } from '../crypto/bytes';
import { deriveKeys, newKdfSaltHex } from '../crypto/argon2';
import { deriveRecoveryKeys } from '../crypto/recovery';
import { generateIdentity, openIdentityBlob, sealIdentityBlob } from '../crypto/identity';
import { sodiumReady } from '../crypto/sodium';

interface AuthState {
  status: 'loading' | 'anonymous' | 'authed';
  user: { id: string; nick: string; avatar_updated_at: number | null } | null;
  publicKey: Uint8Array | null;
  privateKey: Uint8Array | null;
  kek: Uint8Array | null;
  register: (nick: string, password: string, recoveryWords?: string[]) => Promise<void>;
  login: (nick: string, password: string) => Promise<void>;
  changePassword: (oldPassword: string, newPassword: string) => Promise<void>;
  setupRecovery: (recoveryWords: string[]) => Promise<void>;
  recoverLogin: (nick: string, recoveryWords: string[], newPassword: string) => Promise<void>;
  logout: () => Promise<void>;
  restore: () => Promise<void>;
  /** upload a processed avatar data URL; bumps the local timestamp. */
  setAvatar: (dataUrl: string) => Promise<void>;
  clearAvatar: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  status: 'loading',
  user: null,
  publicKey: null,
  privateKey: null,
  kek: null,

  register: async (nick, password, recoveryWords) => {
    await sodiumReady;
    const kdfSalt = newKdfSaltHex();
    const { authMaterial, kek } = await deriveKeys(password, kdfSalt);
    const identity = generateIdentity();
    // second wrap of the identity under the recovery phrase — losing the
    // password no longer loses the account
    let recovery: { kdf_salt: string; auth_material: string; blob: string } | undefined;
    if (recoveryWords?.length === 12) {
      const recSalt = newKdfSaltHex();
      const rec = await deriveRecoveryKeys(recoveryWords, recSalt);
      recovery = {
        kdf_salt: recSalt,
        auth_material: b64(rec.authMaterial),
        blob: sealIdentityBlob(identity.privateKey, rec.kek),
      };
    }
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
          ...(recovery ? { recovery } : {}),
        },
      },
    );
    set({
      status: 'authed',
      user: { id: res.user.id, nick: res.user.nick, avatar_updated_at: null },
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
    set({
      status: 'authed',
      user: {
        id: res.user.id,
        nick: res.user.nick,
        avatar_updated_at: res.user.avatar_updated_at ?? null,
      },
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
    set({ kek: next.kek });
  },

  // attach a recovery phrase to a logged-in account (old accounts)
  setupRecovery: async (recoveryWords) => {
    await sodiumReady;
    const { privateKey } = get();
    if (!privateKey) throw new Error('giriş yapılmamış');
    if (recoveryWords.length !== 12) throw new Error('ifade 12 kelime olmalı');
    const recSalt = newKdfSaltHex();
    const rec = await deriveRecoveryKeys(recoveryWords, recSalt);
    await api('/auth/recovery', {
      method: 'POST',
      body: {
        kdf_salt: recSalt,
        auth_material: b64(rec.authMaterial),
        blob: sealIdentityBlob(privateKey, rec.kek),
      },
    });
  },

  // "forgot password": phrase proves ownership; identity survives, password resets
  recoverLogin: async (nick, recoveryWords, newPassword) => {
    await sodiumReady;
    if (recoveryWords.length !== 12) throw new Error('ifade 12 kelime olmalı');
    // no local 404 branch: the server hands a pseudo-salt to unknown nicks and
    // fails at verify, so wrong nick / no phrase / wrong phrase are identical
    const params = await api<{ recovery_salt: string }>(
      `/auth/recovery-params?nick=${encodeURIComponent(nick)}`,
    );
    const rec = await deriveRecoveryKeys(recoveryWords, params.recovery_salt);
    const proof = b64(rec.authMaterial);
    const unlock = await api<{ recovery_blob: string; public_key: string }>(
      '/auth/recover/unlock',
      { method: 'POST', body: { nick, recovery_auth_material: proof } },
    );
    const privateKey = openIdentityBlob(unlock.recovery_blob, rec.kek);
    const newSalt = newKdfSaltHex();
    const next = await deriveKeys(newPassword, newSalt);
    const res = await api<{ token: string; user: AuthedUser }>('/auth/recover/finish', {
      method: 'POST',
      body: {
        nick,
        recovery_auth_material: proof,
        new_kdf_salt: newSalt,
        new_auth_material: b64(next.authMaterial),
        new_key_blob: sealIdentityBlob(privateKey, next.kek),
      },
    });
    set({
      status: 'authed',
      user: {
        id: res.user.id,
        nick: res.user.nick,
        avatar_updated_at: res.user.avatar_updated_at ?? null,
      },
      publicKey: unb64(res.user.public_key),
      privateKey,
      kek: next.kek,
    });
  },

  logout: async () => {
    await api('/auth/logout', { method: 'POST' }).catch(() => {});
    set({ status: 'anonymous', user: null, publicKey: null, privateKey: null, kek: null });
  },

  // no KEK persistence — reload = password reprompt; deliberate: a JS-readable
  // KEK would let a single XSS unwrap the identity key. Without a KEK the
  // server's key_blob cannot be opened, so /auth/me is pointless and boot goes
  // straight to anonymous.
  restore: async () => {
    set({ status: 'anonymous' });
  },

  setAvatar: async (dataUrl) => {
    await api('/users/me/avatar', { method: 'PATCH', body: { data_url: dataUrl } });
    set((s) => (s.user ? { user: { ...s.user, avatar_updated_at: Date.now() } } : s));
  },

  clearAvatar: async () => {
    await api('/users/me/avatar', { method: 'PATCH', body: { clear: true } });
    set((s) => (s.user ? { user: { ...s.user, avatar_updated_at: null } } : s));
  },
}));
