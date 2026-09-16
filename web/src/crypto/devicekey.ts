// Cihaz kilidi — WebAuthn PRF extension.
//
// F5 sonrası şifre sormak yerine: kimlik anahtarı passkey'in PRF çıktısından
// türetilen cihaz KEK'i ile sarılır ve IndexedDB'ye yazılır. Tehdit modeli:
// PRF çıktısı passkey donanımında üretilir, JS'e yalnızca KULLANIM ANINDA
// verilir ve cihazda saklanmaz — zararlı JS (XSS) blob'u (i) kullanıcının
// aktif WebAuthn onayı olmadan edemez, (ii) çalıp başka cihazda açamaz.
// Şifre ve kurtarma akışları aynen durur; bu yalnızca opsiyonel hızlı geri
// dönüş. Server değişikliği yok — blob zaten server'da, cihaz ikinci sarmalıyor.

import { sodium } from './sodium';
import { b64, concat, randomBytes, unb64 } from './bytes';

// AAD: identity blob'undan ayrıştırma — yanlış katmandan açma denemesi poly1305'te düşer
const DEVICE_AAD = 'device-blob';
// crypto_kdf bağlamı — tam 8 bayt olmalı
const DEVICE_KEK_CTX = 'devkek01';

const DB_NAME = 'pgv-device';
const STORE = 'device';
const KEY = 'device';
const DECLINE_KEY = 'postaci.device-decline';

/** cihaz KEK'i ile sarılan yük — her ikisi de b64 */
export interface DevicePayload {
  /** şifre türevi auth material — cookie öldüğünde /auth/login için */
  am: string;
  /** X25519 private key */
  pk: string;
}

export interface DeviceRecord {
  nick: string;
  /** passkey credential id (b64) */
  credentialId: string;
  /** PRF salt (b64, 32B) — blob bu saltsiz çözülemez */
  prfSalt: string;
  /** nonce(24) || XChaCha20-Poly1305(payload) under cihaz KEK (b64) */
  blob: string;
}

export interface DeviceUnlock {
  nick: string;
  /** b64 — /auth/login body'sine doğrudan gider */
  authMaterial: string;
  privateKey: Uint8Array;
}

// --- WebAuthn arayüzü: gerçek tarayıcı impl'i + testlerde sahte impl ---

export interface WebAuthnAgent {
  /** platform authenticator var mı — yoksa "hatırla" teklifi hiç çıkmaz */
  isAvailable(): Promise<boolean>;
  /** passkey üret + PRF salt'ı değerlendir → PRF çıktısı (32B) */
  create(
    prfSalt: Uint8Array,
    nick: string,
    userId: string,
  ): Promise<{ credentialId: Uint8Array; prf: Uint8Array }>;
  /**
   * Passkey doğrula + PRF değerlendir. Passkey silinmişse, kullanıcı
   * vazgeçmişse ya da PRF desteklenmiyorsa throw eder.
   * allowCredentials boş → resident key, nick gerekmez.
   */
  assert(prfSalt: Uint8Array): Promise<{ credentialId: Uint8Array; prf: Uint8Array }>;
}

const rpId = (): string => location.hostname;

// WebAuthn BufferSource'ları Uint8Array<ArrayBuffer> ister; libsodium/b64
// dönüşleri ArrayBufferLike ürettiği için taze kopyaya sararız.
const buf = (src: Uint8Array): Uint8Array<ArrayBuffer> => {
  const out = new Uint8Array(new ArrayBuffer(src.length));
  out.set(src);
  return out;
};
const u8 = (src: ArrayBuffer | ArrayBufferView): Uint8Array<ArrayBuffer> => {
  if (src instanceof Uint8Array) return buf(src);
  return buf(
    src instanceof ArrayBuffer
      ? new Uint8Array(src)
      : new Uint8Array(src.buffer, src.byteOffset, src.byteLength),
  );
};

/** tarayıcı impl'i — credentials.get() yalnızca kullanıcı onayıyla PRF verir */
export const browserWebAuthn: WebAuthnAgent = {
  async isAvailable() {
    const pkc = (
      globalThis as { PublicKeyCredential?: { isUserVerifyingPlatformAuthenticatorAvailable(): Promise<boolean> } }
    ).PublicKeyCredential;
    if (!pkc?.isUserVerifyingPlatformAuthenticatorAvailable) return false;
    try {
      return await pkc.isUserVerifyingPlatformAuthenticatorAvailable();
    } catch {
      return false;
    }
  },

  async create(prfSalt, nick, userId) {
    const cred = (await navigator.credentials.create({
      publicKey: {
        challenge: buf(randomBytes(32)),
        rp: { name: 'postacim', id: rpId() },
        user: { id: buf(new TextEncoder().encode(userId)), name: nick, displayName: nick },
        pubKeyCredParams: [
          { type: 'public-key', alg: -7 },
          { type: 'public-key', alg: -257 },
        ],
        authenticatorSelection: { residentKey: 'required', userVerification: 'preferred' },
        extensions: { prf: { eval: { first: buf(prfSalt) } } },
      },
    })) as PublicKeyCredential;
    return { credentialId: u8(cred.rawId), prf: await evalPrf(cred, prfSalt) };
  },

  async assert(prfSalt) {
    const assertion = (await navigator.credentials.get({
      publicKey: {
        challenge: buf(randomBytes(32)),
        rpId: rpId(),
        userVerification: 'preferred',
        extensions: { prf: { eval: { first: buf(prfSalt) } } },
      },
    })) as PublicKeyCredential;
    const first = assertion.getClientExtensionResults().prf?.results?.first;
    if (!first) throw new Error('PRF desteklenmiyor');
    return { credentialId: u8(assertion.rawId), prf: u8(first) };
  },
};

// Bazı tarayıcılar üretim sırasında yalnızca "enabled" bildirir, değer vermez —
// o zaman ilk doğrulamada değerlendir.
async function evalPrf(cred: PublicKeyCredential, prfSalt: Uint8Array): Promise<Uint8Array> {
  const prf = cred.getClientExtensionResults().prf;
  if (prf?.results?.first) return u8(prf.results.first);
  if (!prf?.enabled) throw new Error('PRF desteklenmiyor');
  const assertion = (await navigator.credentials.get({
    publicKey: {
      challenge: buf(randomBytes(32)),
      rpId: rpId(),
      allowCredentials: [{ type: 'public-key', id: u8(cred.rawId) }],
      userVerification: 'preferred',
      extensions: { prf: { eval: { first: buf(prfSalt) } } },
    },
  })) as PublicKeyCredential;
  const first = assertion.getClientExtensionResults().prf?.results?.first;
  if (!first) throw new Error('PRF desteklenmiyor');
  return u8(first);
}

// --- türetim + sarma ---

/** Cihaz KEK'i PRF çıktısından türetilir; PRF çıktısı saklanmaz — her açılışta yeniden istenir. */
export function deriveDeviceKek(prfOutput: Uint8Array): Uint8Array {
  return sodium.crypto_kdf_derive_from_key(32, 1, DEVICE_KEK_CTX, prfOutput);
}

export function sealDeviceBlob(payload: DevicePayload, deviceKek: Uint8Array): string {
  const nonce = sodium.randombytes_buf(24);
  const ct = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
    new TextEncoder().encode(JSON.stringify(payload)),
    DEVICE_AAD,
    null,
    nonce,
    deviceKek,
  );
  return b64(concat(nonce, ct));
}

/** Yanlış cihaz KEK'i (başka passkey / PRF) veya AAD → throw. */
export function openDeviceBlob(sealedB64: string, deviceKek: Uint8Array): DevicePayload {
  const raw = unb64(sealedB64);
  const pt = sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(
    null,
    raw.slice(24),
    DEVICE_AAD,
    raw.slice(0, 24),
    deviceKek,
  );
  return JSON.parse(new TextDecoder().decode(pt)) as DevicePayload;
}

// --- IndexedDB: tek kayıtlık cihaz kilidi deposu ---

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const rq = indexedDB.open(DB_NAME, 1);
    rq.onupgradeneeded = () => {
      if (!rq.result.objectStoreNames.contains(STORE)) rq.result.createObjectStore(STORE);
    };
    rq.onsuccess = () => resolve(rq.result);
    rq.onerror = () => reject(rq.error);
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDb();
  return await new Promise<T>((resolve, reject) => {
    const rq = fn(db.transaction(STORE, mode).objectStore(STORE));
    rq.onsuccess = () => resolve(rq.result);
    rq.onerror = () => reject(rq.error);
  });
}

/** IDB yok/bozuk → cihaz kilidi yok sayılır; şifre akışı devam eder. */
export async function loadDeviceRecord(): Promise<DeviceRecord | null> {
  try {
    const rec = await withStore('readonly', (s) => s.get(KEY) as IDBRequest<DeviceRecord | undefined>);
    return rec ?? null;
  } catch {
    return null;
  }
}

export async function hasDeviceUnlock(): Promise<boolean> {
  return (await loadDeviceRecord()) !== null;
}

async function saveDeviceRecord(rec: DeviceRecord): Promise<void> {
  await withStore('readwrite', (s) => s.put(rec, KEY));
}

export async function removeDeviceUnlockRecord(): Promise<void> {
  try {
    await withStore('readwrite', (s) => s.delete(KEY));
  } catch {
    // silinemiyorsa kayıt kullanılmaya devam eder — ölümcül değil
  }
}

// --- teklif bayrağı: "bir kez sor" — reddedilen cihazda bir daha çıkma ---

export function deviceOfferDeclined(): boolean {
  try {
    return localStorage.getItem(DECLINE_KEY) === '1';
  } catch {
    return false;
  }
}

export function declineDeviceOffer(): void {
  try {
    localStorage.setItem(DECLINE_KEY, '1');
  } catch {
    // localStorage engelliyse teklif tekrar çıkabilir — zararsız
  }
}

// --- akışlar ---

export const deviceUnlockSupported = (): Promise<boolean> => browserWebAuthn.isAvailable();

/** "bu cihazda hatırla": passkey üret → cihaz KEK'i ile sar → IDB'ye yaz. */
export async function enrollDeviceUnlock(
  agent: WebAuthnAgent,
  user: { id: string; nick: string },
  authMaterial: Uint8Array,
  privateKey: Uint8Array,
): Promise<void> {
  const prfSalt = randomBytes(32);
  const { credentialId, prf } = await agent.create(prfSalt, user.nick, user.id);
  const deviceKek = deriveDeviceKek(prf);
  const blob = sealDeviceBlob({ am: b64(authMaterial), pk: b64(privateKey) }, deviceKek);
  await saveDeviceRecord({ nick: user.nick, credentialId: b64(credentialId), prfSalt: b64(prfSalt), blob });
}

/**
 * Passkey ile aç. Kayıt yoksa null; passkey silinmişse / kullanıcı vazgeçmişse /
 * PRF desteklenmiyorsa da null — hata gösterilmez, şifre akışına düşülür.
 */
export async function unlockWithPasskey(
  agent: WebAuthnAgent = browserWebAuthn,
): Promise<DeviceUnlock | null> {
  const rec = await loadDeviceRecord();
  if (!rec) return null;
  try {
    const { prf } = await agent.assert(unb64(rec.prfSalt));
    const payload = openDeviceBlob(rec.blob, deriveDeviceKek(prf));
    return { nick: rec.nick, authMaterial: payload.am, privateKey: unb64(payload.pk) };
  } catch {
    return null;
  }
}

/**
 * Şifre değişince eski auth_material ölür — kayıt varsa yükü yeniden sar.
 * Passkey promptu başarısız olursa kayıt eski haliyle kalır: bir sonraki
 * açılışta sunucu reddeder ve şifre akışına sessizce düşülür.
 */
export async function refreshDeviceUnlockAm(agent: WebAuthnAgent, newAm: string): Promise<void> {
  const rec = await loadDeviceRecord();
  if (!rec) return;
  try {
    const { prf } = await agent.assert(unb64(rec.prfSalt));
    const deviceKek = deriveDeviceKek(prf);
    const payload = openDeviceBlob(rec.blob, deviceKek);
    payload.am = newAm;
    await saveDeviceRecord({ ...rec, blob: sealDeviceBlob(payload, deviceKek) });
  } catch {
    // sessiz — bkz. üstteki yorum
  }
}