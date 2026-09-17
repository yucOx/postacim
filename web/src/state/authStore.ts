import { create } from 'zustand';
import { api, ApiError } from '../api/client';
import type { AuthedUser } from '../api/types';
import { b64, unb64 } from '../crypto/bytes';
import { deriveKeys, newKdfSaltHex } from '../crypto/argon2';
import { deriveRecoveryKeys } from '../crypto/recovery';
import {
  generateDeviceId,
  generateIdentity,
  generateSignIdentity,
  openIdentityBlob,
  sealIdentityBlob,
  signPublicKeyFromPrivate,
} from '../crypto/identity';
import {
  browserWebAuthn,
  declineDeviceOffer,
  enrollDeviceUnlock as enrollDeviceUnlockRecord,
  refreshDeviceUnlockAm,
  removeDeviceUnlockRecord,
  unlockWithPasskey,
  type DeviceUnlock,
} from '../crypto/devicekey';
import { sodiumReady } from '../crypto/sodium';

// shared tail of login / reauthenticate / restore: unwrap key_blob under the
// fresh KEK. A wrong password throws here, before any authed state is set.
function authedPatch(user: AuthedUser, kek: Uint8Array, am: Uint8Array | null) {
  const publicKey = unb64(user.public_key);
  let privateKey: Uint8Array;
  let signPrivateKey: Uint8Array | null;
  let deviceId: Uint8Array | null;
  try {
    const opened = openIdentityBlob(user.key_blob, kek);
    privateKey = opened.privateKey;
    signPrivateKey = opened.signPrivateKey;
    deviceId = opened.deviceId;
  } catch {
    throw new ApiError(401, 'şifre hatalı');
  }
  return {
    status: 'authed' as const,
    user: {
      id: user.id,
      nick: user.nick,
      avatar_updated_at: user.avatar_updated_at ?? null,
    },
    publicKey,
    privateKey,
    signPublicKey: signPrivateKey ? signPublicKeyFromPrivate(signPrivateKey) : null,
    signPrivateKey,
    deviceId,
    kek,
    authMaterial: am,
  };
}

// passkey açılışının ortak kuyruğu — private key cihaz blob'undan gelir.
// kek null: şifre değiştirme / kurtarma şifreden yeniden türettiği için
// bu akış KEK'siz de çalışır; KEK'i RAM'de tutmama kararımız da bozulmaz.
function deviceAuthedPatch(user: AuthedUser, u: DeviceUnlock) {
  return {
    status: 'authed' as const,
    user: {
      id: user.id,
      nick: user.nick,
      avatar_updated_at: user.avatar_updated_at ?? null,
    },
    publicKey: unb64(user.public_key),
    privateKey: u.privateKey,
    signPublicKey: u.signPrivateKey ? signPublicKeyFromPrivate(u.signPrivateKey) : null,
    signPrivateKey: u.signPrivateKey,
    deviceId: u.deviceId,
    kek: null,
    authMaterial: unb64(u.authMaterial),
  };
}

interface AuthState {
  // needs_password: session cookie alive but the KEK died with the old tab
  status: 'loading' | 'anonymous' | 'needs_password' | 'authed';
  user: { id: string; nick: string; avatar_updated_at: number | null } | null;
  publicKey: Uint8Array | null;
  privateKey: Uint8Array | null;
  /** Ed25519 gönderen-atfı anahtarları — v1 blob/cihaz kaydı yoksa null,
   *  ensureSignIdentity üretip yayınlar */
  signPublicKey: Uint8Array | null;
  signPrivateKey: Uint8Array | null;
  /** Faz 7: 16B device UUID (v3 blob). v1/v2 blob'lu hesaplar null → primary
   *  alias (per-cihaz DH step state + fingerprint namespace). */
  deviceId: Uint8Array | null;
  kek: Uint8Array | null;
  // şifre türevi auth material — RAM'de, kek ile aynı ömür. Cihaz kilidi
  // kurulurken blob'a sarılmak için lazım; asla plaintext persist edilmez.
  authMaterial: Uint8Array | null;
  register: (
    nick: string,
    password: string,
    recoveryWords?: string[],
    turnstileToken?: string,
  ) => Promise<void>;
  login: (nick: string, password: string, turnstileToken?: string) => Promise<void>;
  /** imza anahtarı eksikse üret + /keys/sign ile yayınla (key_blob v2 rewrap
   *  KEK varken yapılır; cihaz kilidi yolu yalnız yayınlar, sk cihaz blob'unda) */
  ensureSignIdentity: () => Promise<void>;
  /** login ekranındaki "passkey ile aç" butonu — başarısızsa false, hata gösterilmez */
  unlockWithDevice: (turnstileToken?: string) => Promise<boolean>;
  /** "bu cihazda hatırla" — passkey üret + kimliği cihaz KEK'i ile sar */
  enrollDeviceUnlock: () => Promise<void>;
  /** profil: cihaz kilidini kaldır — teklif de bir daha çıkmaz */
  removeDeviceUnlock: () => Promise<void>;
  reauthenticate: (password: string) => Promise<void>;
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
  signPublicKey: null,
  signPrivateKey: null,
  deviceId: null,
  kek: null,
  authMaterial: null,

  register: async (nick, password, recoveryWords, turnstileToken) => {
    await sodiumReady;
    const kdfSalt = newKdfSaltHex();
    const { authMaterial, kek } = await deriveKeys(password, kdfSalt);
    const identity = generateIdentity();
    const sign = generateSignIdentity();
    const deviceId = generateDeviceId();
    // second wrap of the identity under the recovery phrase — losing the
    // password no longer loses the account (v2 payload: imza anahtarı da içinde)
    let recovery: { kdf_salt: string; auth_material: string; blob: string } | undefined;
    if (recoveryWords?.length === 12) {
      const recSalt = newKdfSaltHex();
      const rec = await deriveRecoveryKeys(recoveryWords, recSalt);
      recovery = {
        kdf_salt: recSalt,
        auth_material: b64(rec.authMaterial),
        blob: sealIdentityBlob(identity.privateKey, rec.kek, sign.signPrivateKey, deviceId),
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
          sign_public_key: b64(sign.signPublicKey),
          device_id: b64(deviceId), // Faz 7: cihaz tekil kimliği
          key_blob: sealIdentityBlob(identity.privateKey, kek, sign.signPrivateKey, deviceId),
          ...(recovery ? { recovery } : {}),
          ...(turnstileToken ? { turnstile_token: turnstileToken } : {}),
        },
      },
    );
    set({
      status: 'authed',
      user: { id: res.user.id, nick: res.user.nick, avatar_updated_at: null },
      publicKey: identity.publicKey,
      privateKey: identity.privateKey,
      signPublicKey: sign.signPublicKey,
      signPrivateKey: sign.signPrivateKey,
      deviceId,
      kek,
      authMaterial,
    });
  },

  ensureSignIdentity: async () => {
    const s = get();
    if (!s.user || s.signPrivateKey || !s.privateKey || !s.authMaterial) return;
    const sign = generateSignIdentity();
    const body: Record<string, string> = {
      sign_public_key: b64(sign.signPublicKey),
      auth_material: b64(s.authMaterial),
    };
    // KEK hâlâ RAM'deyse key_blob v3'e yeniden sarılır — imza private key +
    // deviceId birlikte; cihaz kilidi yolu bunu atlar (sk cihaz blob'una
    // enroll ile girer).
    if (s.kek) {
      body.key_blob = sealIdentityBlob(
        s.privateKey,
        s.kek,
        sign.signPrivateKey,
        s.deviceId ?? undefined,
      );
    }
    await api('/keys/sign', { method: 'POST', body });
    set({ signPublicKey: sign.signPublicKey, signPrivateKey: sign.signPrivateKey });
  },

  login: async (nick, password, turnstileToken) => {
    await sodiumReady;
    const params = await api<{ kdf_salt: string }>(
      `/auth/kdf-params?nick=${encodeURIComponent(nick)}`,
    );
    const { authMaterial, kek } = await deriveKeys(password, params.kdf_salt);
    const res = await api<{ token: string; user: AuthedUser }>('/auth/login', {
      method: 'POST',
      body: {
        nick,
        auth_material: b64(authMaterial),
        ...(turnstileToken ? { turnstile_token: turnstileToken } : {}),
      },
    });
    set(authedPatch(res.user, kek, authMaterial));
    await get().ensureSignIdentity();
  },

  // passkey ile aç (login ekranı butonu). Cihaz blob'u çözülünce iki yol:
  // cookie canlıysa (needs_password) /auth/me + kayıttaki private key; cookie
  // ölüyse kayıttaki auth_material ile /auth/login. Başarısızlıkta false —
  // kullanıcı şifresiyle her zaman girebilir, hata gösterilmez.
  unlockWithDevice: async (turnstileToken) => {
    await sodiumReady;
    const u = await unlockWithPasskey();
    if (!u) return false;
    if (get().status === 'needs_password') {
      const me = await api<{ user: AuthedUser }>('/auth/me');
      set(deviceAuthedPatch(me.user, u));
      await get().ensureSignIdentity();
      return true;
    }
    const res = await api<{ token: string; user: AuthedUser }>('/auth/login', {
      method: 'POST',
      body: {
        nick: u.nick,
        auth_material: u.authMaterial,
        ...(turnstileToken ? { turnstile_token: turnstileToken } : {}),
      },
    });
    set(deviceAuthedPatch(res.user, u));
    await get().ensureSignIdentity();
    return true;
  },

  enrollDeviceUnlock: async () => {
    await sodiumReady;
    const { user, privateKey, signPrivateKey, deviceId, authMaterial } = get();
    if (!user || !privateKey || !authMaterial) throw new Error('giriş yapılmamış');
    await enrollDeviceUnlockRecord(
      browserWebAuthn,
      user,
      authMaterial,
      privateKey,
      signPrivateKey,
      deviceId,
    );
  },

  removeDeviceUnlock: async () => {
    await removeDeviceUnlockRecord();
    // kullanıcı bilinçli kaldırdı — tekrar teklif etme
    declineDeviceOffer();
  },

  // needs_password path: the cookie session is still valid, only this tab's
  // KEK is gone. Re-derive it from the password and unwrap the same key_blob;
  // no new login, so nothing server-side changes on a wrong password.
  reauthenticate: async (password) => {
    await sodiumReady;
    const nick = get().user?.nick;
    if (!nick) throw new Error('giriş yapılmamış');
    const params = await api<{ kdf_salt: string }>(
      `/auth/kdf-params?nick=${encodeURIComponent(nick)}`,
    );
    const { kek, authMaterial } = await deriveKeys(password, params.kdf_salt);
    const me = await api<{ user: AuthedUser }>('/auth/me');
    set(authedPatch(me.user, kek, authMaterial));
    await get().ensureSignIdentity();
  },

  // Password change re-wraps the identity blob under the new KEK. Channel keys
  // are untouched: they are sealed to the X25519 identity, not the password.
  changePassword: async (oldPassword, newPassword) => {
    await sodiumReady;
    const nick = get().user?.nick;
    const { publicKey, privateKey, signPrivateKey, deviceId } = get();
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
        new_key_blob: sealIdentityBlob(
          privateKey,
          next.kek,
          signPrivateKey ?? undefined,
          deviceId ?? undefined,
        ),
      },
    });
    set({ kek: next.kek, authMaterial: next.authMaterial });
    // cihaz kilidi kaydındaki eski auth_material ölür — varsa yeniden sar
    await refreshDeviceUnlockAm(browserWebAuthn, b64(next.authMaterial));
  },

  // attach a recovery phrase to a logged-in account (old accounts)
  setupRecovery: async (recoveryWords) => {
    await sodiumReady;
    const { privateKey, signPrivateKey, deviceId } = get();
    if (!privateKey) throw new Error('giriş yapılmamış');
    if (recoveryWords.length !== 12) throw new Error('ifade 12 kelime olmalı');
    const recSalt = newKdfSaltHex();
    const rec = await deriveRecoveryKeys(recoveryWords, recSalt);
    await api('/auth/recovery', {
      method: 'POST',
      body: {
        kdf_salt: recSalt,
        auth_material: b64(rec.authMaterial),
        blob: sealIdentityBlob(
          privateKey,
          rec.kek,
          signPrivateKey ?? undefined,
          deviceId ?? undefined,
        ),
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
    const opened = openIdentityBlob(unlock.recovery_blob, rec.kek);
    const privateKey = opened.privateKey;
    // v1/v2 kurtarma blob'u imza anahtarı + deviceId taşımaz; yeni cihaz
    // kimliği üretilir (cihazı bu cihazla sınırlar — kullanıcı diğer
    // cihazlarını linking ile ekleyebilir).
    const deviceId = opened.deviceId ?? generateDeviceId();
    const newSalt = newKdfSaltHex();
    const next = await deriveKeys(newPassword, newSalt);
    const res = await api<{ token: string; user: AuthedUser }>('/auth/recover/finish', {
      method: 'POST',
      body: {
        nick,
        recovery_auth_material: proof,
        new_kdf_salt: newSalt,
        new_auth_material: b64(next.authMaterial),
        new_key_blob: sealIdentityBlob(privateKey, next.kek, undefined, deviceId),
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
      signPublicKey: null,
      signPrivateKey: null,
      deviceId,
      kek: next.kek,
      authMaterial: next.authMaterial,
    });
    // v1 kurtarma blob'u imza anahtarını taşımaz → yeni imza kimliği üretilip
    // yayınlanır (deftere yeni satır düşer — key değişimi kanıtlı)
    await get().ensureSignIdentity();
    // şifre sıfırlandı: cihaz kilidi kaydındaki eski auth_material ölür
    await refreshDeviceUnlockAm(browserWebAuthn, b64(next.authMaterial));
  },

  logout: async () => {
    await api('/auth/logout', { method: 'POST' }).catch(() => {});
    // cihaz kilidi kaydı bilinçli olarak kalır — login ekranındaki passkey
    // butonu ona bağlı; RAM'deki anahtarlar temizlenir
    set({
      status: 'anonymous',
      user: null,
      publicKey: null,
      privateKey: null,
      signPublicKey: null,
      signPrivateKey: null,
      deviceId: null,
      kek: null,
      authMaterial: null,
    });
  },

  // The KEK never persists — a JS-readable copy would let a single XSS unwrap
  // the identity key. The httpOnly session cookie does outlive the tab, so
  // restore consults /auth/me: anonymous → login, KEK still in memory → in,
  // cookie alive without a KEK (reload) → password reprompt (needs_password).
  restore: async () => {
    let me: { user: AuthedUser };
    try {
      me = await api<{ user: AuthedUser }>('/auth/me');
    } catch {
      set({ status: 'anonymous' });
      return;
    }
    const { kek, authMaterial } = get();
    if (kek) {
      await sodiumReady;
      set(authedPatch(me.user, kek, authMaterial));
      await get().ensureSignIdentity();
      return;
    }
    // cihaz kilidi: kayıt VARSA passkey promptu çıkar — şifre SORULMAZ.
    // Passkey silinmişse / kullanıcı vazgeçmişse / PRF yoksa null döner
    // ve mevcut şifre akışı (needs_password) devralır, hata gösterilmez.
    await sodiumReady;
    const u = await unlockWithPasskey();
    if (u) {
      set(deviceAuthedPatch(me.user, u));
      await get().ensureSignIdentity();
      return;
    }
    set({
      status: 'needs_password',
      user: {
        id: me.user.id,
        nick: me.user.nick,
        avatar_updated_at: me.user.avatar_updated_at ?? null,
      },
    });
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
