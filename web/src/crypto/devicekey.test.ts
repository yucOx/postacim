import { beforeEach, describe, expect, it, vi } from 'vitest';
import { sodium, sodiumReady } from './sodium';
import { b64, concat, randomBytes, unb64 } from './bytes';
import { sealIdentityBlob } from './identity';
import {
  declineDeviceOffer,
  deviceOfferDeclined,
  deriveDeviceKek,
  enrollDeviceUnlock,
  hasDeviceUnlock,
  loadDeviceRecord,
  openDeviceBlob,
  refreshDeviceUnlockAm,
  removeDeviceUnlockRecord,
  sealDeviceBlob,
  unlockWithPasskey,
  type DevicePayload,
  type WebAuthnAgent,
} from './devicekey';

await sodiumReady;

// --- sahte WebAuthn: PRF = generichash(salt || secret) — gerçek donanım gibi
// secret dışarıdan okunamaz, yalnızca create/assert çıktısında görünür.
class FakeAgent implements WebAuthnAgent {
  private secret = randomBytes(32);
  assertCount = 0;
  enrolled = false;
  cancelAssert = false; // passkey silindi / kullanıcı vazgeçti

  private prf(salt: Uint8Array): Uint8Array {
    return sodium.crypto_generichash(32, concat(salt, this.secret));
  }

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async create(
    prfSalt: Uint8Array,
  ): Promise<{ credentialId: Uint8Array; prf: Uint8Array }> {
    this.enrolled = true;
    return { credentialId: randomBytes(16), prf: this.prf(prfSalt) };
  }

  async assert(prfSalt: Uint8Array): Promise<{ credentialId: Uint8Array; prf: Uint8Array }> {
    this.assertCount++;
    if (!this.enrolled || this.cancelAssert) throw new Error('passkey yok');
    return { credentialId: randomBytes(16), prf: this.prf(prfSalt) };
  }
}

// --- sahte IndexedDB: devicekey'nin kullandığı minimal yüzey ---
function stubIDB(): void {
  let store: Map<string, unknown> | null = null; // upgradeneeded ile yaratılır
  const fire = (rq: { onsuccess: (() => void) | null }): void =>
    queueMicrotask(() => rq.onsuccess?.());
  const db = {
    objectStoreNames: { contains: () => store !== null },
    createObjectStore: () => {
      store = new Map();
    },
    transaction: () => ({
      objectStore: () => ({
        get: (key: string) => {
          const rq = { result: store?.get(key) ?? undefined, onsuccess: null };
          fire(rq);
          return rq;
        },
        put: (value: unknown, key: string) => {
          store!.set(key, value);
          const rq = { result: undefined, onsuccess: null };
          fire(rq);
          return rq;
        },
        delete: (key: string) => {
          store!.delete(key);
          const rq = { result: undefined, onsuccess: null };
          fire(rq);
          return rq;
        },
      }),
    }),
  };
  vi.stubGlobal('indexedDB', {
    open: () => {
      const rq: {
        result: unknown;
        onsuccess: (() => void) | null;
        onupgradeneeded: (() => void) | null;
      } = { result: db, onsuccess: null, onupgradeneeded: null };
      queueMicrotask(() => {
        if (!store) rq.onupgradeneeded?.(); // contains() burada false döner
        rq.onsuccess?.();
      });
      return rq;
    },
  });
}

beforeEach(() => {
  const ls = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => ls.get(k) ?? null,
    setItem: (k: string, v: string) => void ls.set(k, v),
    removeItem: (k: string) => void ls.delete(k),
  });
  stubIDB();
});

const payload = (): DevicePayload => ({ am: b64(randomBytes(32)), pk: b64(randomBytes(32)) });

describe('cihaz KEK türetimi', () => {
  it('PRF çıktısından deterministik 32B; farklı PRF → farklı KEK', () => {
    const prf = randomBytes(32);
    expect(deriveDeviceKek(prf)).toEqual(deriveDeviceKek(prf));
    expect(deriveDeviceKek(prf)).toHaveLength(32);
    expect(b64(deriveDeviceKek(prf))).not.toBe(b64(deriveDeviceKek(randomBytes(32))));
  });
});

describe('device blob seal/open', () => {
  it('roundtrip', () => {
    const p = payload();
    const kek = deriveDeviceKek(randomBytes(32));
    expect(openDeviceBlob(sealDeviceBlob(p, kek), kek)).toEqual(p);
  });
  it("yanlış cihaz KEK'i reddeder", () => {
    const sealed = sealDeviceBlob(payload(), deriveDeviceKek(randomBytes(32)));
    expect(() => openDeviceBlob(sealed, deriveDeviceKek(randomBytes(32)))).toThrow();
  });
  it('AAD bağlıdır — identity blob device blobu gibi açılmaz', () => {
    const kek = deriveDeviceKek(randomBytes(32));
    const identitySealed = sealIdentityBlob(randomBytes(32), kek);
    expect(() => openDeviceBlob(identitySealed, kek)).toThrow();
  });
  it('kurcalanmış blob reddedilir', () => {
    const kek = deriveDeviceKek(randomBytes(32));
    const raw = unb64(sealDeviceBlob(payload(), kek));
    raw[0] ^= 1;
    expect(() => openDeviceBlob(b64(raw), kek)).toThrow();
  });
});

describe('kayıt → passkey ile açılış (sahte agent + sahte IDB)', () => {
  const user = { id: 'u-1', nick: 'guvercin' };

  it('enroll sonrası unlock aynı private key + auth material verir', async () => {
    const agent = new FakeAgent();
    const am = randomBytes(32);
    const pk = randomBytes(32);
    await enrollDeviceUnlock(agent, user, am, pk);
    expect(await hasDeviceUnlock()).toBe(true);
    const rec = await loadDeviceRecord();
    expect(rec?.nick).toBe('guvercin');
    expect(rec?.prfSalt).toHaveLength(44); // b64(32B)
    const u = await unlockWithPasskey(agent);
    expect(u?.nick).toBe('guvercin');
    expect(u?.authMaterial).toBe(b64(am));
    expect(u?.privateKey).toEqual(pk);
  });

  it('kayıt yoksa null — agent hiç çağrılmaz', async () => {
    const agent = new FakeAgent();
    expect(await unlockWithPasskey(agent)).toBeNull();
    expect(agent.assertCount).toBe(0);
  });

  it('passkey silinmişse / vazgeçilmişse null — hata değil', async () => {
    const agent = new FakeAgent();
    await enrollDeviceUnlock(agent, user, randomBytes(32), randomBytes(32));
    agent.cancelAssert = true;
    expect(await unlockWithPasskey(agent)).toBeNull();
  });

  it('başka passkey (farklı PRF) blobu açamaz — null', async () => {
    const agent = new FakeAgent();
    await enrollDeviceUnlock(agent, user, randomBytes(32), randomBytes(32));
    expect(await unlockWithPasskey(new FakeAgent())).toBeNull();
  });

  it('kayıt silme: remove sonrası kayıt yok', async () => {
    const agent = new FakeAgent();
    await enrollDeviceUnlock(agent, user, randomBytes(32), randomBytes(32));
    await removeDeviceUnlockRecord();
    expect(await hasDeviceUnlock()).toBe(false);
    expect(await unlockWithPasskey(agent)).toBeNull();
  });
});

describe('şifre değişikliği — auth material tazeleme', () => {
  const user = { id: 'u-1', nick: 'guvercin' };
  it('refresh sonrası unlock yeni material verir', async () => {
    const agent = new FakeAgent();
    await enrollDeviceUnlock(agent, user, randomBytes(32), randomBytes(32));
    const newAm = b64(randomBytes(32));
    await refreshDeviceUnlockAm(agent, newAm);
    const u = await unlockWithPasskey(agent);
    expect(u?.authMaterial).toBe(newAm);
  });
  it('kayıt yoksa no-op, assert çağrılmaz', async () => {
    const agent = new FakeAgent();
    await refreshDeviceUnlockAm(agent, b64(randomBytes(32)));
    expect(agent.assertCount).toBe(0);
  });
  it('prompt başarısızsa kayıt eski material ile kalır', async () => {
    const agent = new FakeAgent();
    const am = randomBytes(32);
    await enrollDeviceUnlock(agent, user, am, randomBytes(32));
    agent.cancelAssert = true;
    await refreshDeviceUnlockAm(agent, b64(randomBytes(32)));
    agent.cancelAssert = false;
    const u = await unlockWithPasskey(agent);
    expect(u?.authMaterial).toBe(b64(am));
  });
});

describe('teklif bayrağı', () => {
  it('varsayılan yok; reddedilince kalıcı', () => {
    expect(deviceOfferDeclined()).toBe(false);
    declineDeviceOffer();
    expect(deviceOfferDeclined()).toBe(true);
  });
});