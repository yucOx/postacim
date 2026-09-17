// Faz 7 — v3 kimlik blob'u (device_id ile). Geriye uyumluluk: v1/v2
// hâlâ açılır, deviceId null döner.
import { describe, expect, it } from 'vitest';
import {
  generateDeviceId,
  generateIdentity,
  generateSignIdentity,
  openIdentityBlob,
  sealIdentityBlob,
} from './identity';
import { sodiumReady } from './sodium';

await sodiumReady;

describe('v3 kimlik blob (Faz 7 — device_id)', () => {
  it('seal + open: v3 device_id korunur', () => {
    const id = generateIdentity();
    const sign = generateSignIdentity();
    const did = generateDeviceId();
    const blob = sealIdentityBlob(id.privateKey, new Uint8Array(32), sign.signPrivateKey, did);
    const opened = openIdentityBlob(blob, new Uint8Array(32));
    expect(opened.privateKey).toEqual(id.privateKey);
    expect(opened.signPrivateKey).toEqual(sign.signPrivateKey);
    expect(opened.deviceId).toEqual(did);
  });

  it('v2 blob hâlâ açılır — deviceId null (geriye uyumluluk)', () => {
    const id = generateIdentity();
    const sign = generateSignIdentity();
    const blob = sealIdentityBlob(id.privateKey, new Uint8Array(32), sign.signPrivateKey);
    const opened = openIdentityBlob(blob, new Uint8Array(32));
    expect(opened.privateKey).toEqual(id.privateKey);
    expect(opened.signPrivateKey).toEqual(sign.signPrivateKey);
    expect(opened.deviceId).toBeNull();
  });

  it('v1 blob hâlâ açılır — signPrivateKey + deviceId null', () => {
    const id = generateIdentity();
    const blob = sealIdentityBlob(id.privateKey, new Uint8Array(32));
    const opened = openIdentityBlob(blob, new Uint8Array(32));
    expect(opened.privateKey).toEqual(id.privateKey);
    expect(opened.signPrivateKey).toBeNull();
    expect(opened.deviceId).toBeNull();
  });

  it('yanlış KEK reddi (poly1305)', () => {
    const id = generateIdentity();
    const sign = generateSignIdentity();
    const did = generateDeviceId();
    const blob = sealIdentityBlob(id.privateKey, new Uint8Array(32).fill(7), sign.signPrivateKey, did);
    expect(() => openIdentityBlob(blob, new Uint8Array(32).fill(8))).toThrow();
  });
});
