import { describe, expect, it } from 'vitest';
import { fingerprintPair, shortFingerprint } from './fingerprint';

const keyA = new Uint8Array(32).fill(0x00);
const keyB = new Uint8Array(32).fill(0x01);
const keyC = new Uint8Array(32).fill(0xff);

describe('fingerprintPair', () => {
  // known answer, computed independently: SHA-256 over 0x00*32 || 0x01*32
  // (already sorted), full digest mod 10^40
  const KNOWN = '74632 21564 06016 86687 05006 83227 20538 64435';

  it('matches the known vector for fixed keys', async () => {
    expect(await fingerprintPair(keyA, keyB)).toBe(KNOWN);
  });

  it('is order-invariant — both peers compute the same number', async () => {
    expect(await fingerprintPair(keyA, keyB)).toBe(await fingerprintPair(keyB, keyA));
    expect(await fingerprintPair(keyA, keyC)).toBe(await fingerprintPair(keyC, keyA));
  });

  it('renders 40 digits in 8 groups of 5', async () => {
    const fp = await fingerprintPair(keyA, keyC);
    expect(fp).toMatch(/^(\d{5} ){7}\d{5}$/);
    expect(fp.replace(/ /g, '')).toHaveLength(40);
  });

  it('is deterministic and key-sensitive', async () => {
    expect(await fingerprintPair(keyA, keyB)).toBe(await fingerprintPair(keyA, keyB));
    expect(await fingerprintPair(keyA, keyB)).not.toBe(await fingerprintPair(keyA, keyC));
  });
});

describe('shortFingerprint', () => {
  it('takes the first 16 hex chars of the key, grouped 4×4', () => {
    expect(shortFingerprint(keyA)).toBe('0000 0000 0000 0000');
    expect(shortFingerprint(keyC)).toBe('ffff ffff ffff ffff');
  });
  it('differs between keys and keeps the format', () => {
    const s = shortFingerprint(keyB);
    expect(s).toMatch(/^([0-9a-f]{4} ){3}[0-9a-f]{4}$/);
    expect(s).not.toBe(shortFingerprint(keyA));
  });
});
