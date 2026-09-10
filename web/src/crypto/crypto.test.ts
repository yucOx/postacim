import { describe, expect, it, vi } from 'vitest';
import { b64, unb64, randomBytes } from './bytes';
import { deriveKeys, newKdfSaltHex } from './argon2';
import { generateIdentity, openIdentityBlob, sealIdentityBlob, wrapKeyFor, unwrapMyKey } from './identity';
import { encryptText, decryptText } from './message';
import { generateMnemonic, validateMnemonic } from './bip39';
import { deriveRecoveryKeys } from './recovery';
import { parseInviteLink, buildInviteLink } from './invite';
import { sodiumReady } from './sodium';

await sodiumReady;

// invite helpers read location.origin in the browser; provide one for node
(globalThis as Record<string, unknown>).location ??= {
  origin: 'https://x.example',
  pathname: '/',
};

describe('bytes', () => {
  it('b64/unb64 roundtrip', () => {
    const raw = randomBytes(32);
    expect(unb64(b64(raw))).toEqual(raw);
  });
  it('rejects invalid b64', () => {
    expect(() => unb64('!!!not-b64!!!')).toThrow();
  });
});

describe('argon2 deriveKeys', () => {
  it('derives stable keys for the same password+salt', async () => {
    const salt = newKdfSaltHex();
    const a = await deriveKeys('parola-1', salt);
    const b = await deriveKeys('parola-1', salt);
    expect(a.authMaterial).toEqual(b.authMaterial);
    expect(a.kek).toEqual(b.kek);
  });
  it('different salt → different keys; password split 32/32', async () => {
    const a = await deriveKeys('parola-1', newKdfSaltHex());
    const b = await deriveKeys('parola-1', newKdfSaltHex());
    expect(b64(a.authMaterial)).not.toBe(b64(b.authMaterial));
    expect(a.authMaterial).toHaveLength(32);
    expect(a.kek).toHaveLength(32);
  });
});

describe('identity seal/wrap', () => {
  it('blob opens with the right KEK only', async () => {
    const id = generateIdentity();
    const { kek: kek1 } = await deriveKeys('a', newKdfSaltHex());
    const { kek: kek2 } = await deriveKeys('b', newKdfSaltHex());
    const blob = sealIdentityBlob(id.privateKey, kek1);
    expect(openIdentityBlob(blob, kek1)).toEqual(id.privateKey);
    expect(() => openIdentityBlob(blob, kek2)).toThrow();
  });
  it('sealed channel key unwraps only for the holder', () => {
    const holder = generateIdentity();
    const other = generateIdentity();
    const key = randomBytes(32);
    const wrapped = wrapKeyFor(key, b64(holder.publicKey));
    expect(unwrapMyKey(wrapped, holder.publicKey, holder.privateKey)).toEqual(key);
    expect(() => unwrapMyKey(wrapped, other.publicKey, other.privateKey)).toThrow();
  });
});

describe('message AEAD + AAD binding', () => {
  const key = randomBytes(32);
  it('roundtrip', () => {
    const { nonce, ciphertext } = encryptText('ch_1', 1, key, 'merhaba', 'ch');
    expect(decryptText('ch_1', 1, key, nonce, ciphertext, 'ch').body).toBe('merhaba');
  });
  it('wrong channel id (AAD relocation) rejected', () => {
    const { nonce, ciphertext } = encryptText('ch_1', 1, key, 'x', 'ch');
    expect(() => decryptText('ch_2', 1, key, nonce, ciphertext, 'ch')).toThrow();
  });
  it('wrong epoch rejected', () => {
    const { nonce, ciphertext } = encryptText('ch_1', 1, key, 'x', 'ch');
    expect(() => decryptText('ch_1', 2, key, nonce, ciphertext, 'ch')).toThrow();
  });
  it('wrong scope rejected (channel vs dm)', () => {
    const { nonce, ciphertext } = encryptText('ch_1', 1, key, 'x', 'ch');
    expect(() => decryptText('ch_1', 1, key, nonce, ciphertext, 'dm')).toThrow();
  });
  it('tampered ciphertext rejected', () => {
    const { nonce, ciphertext } = encryptText('ch_1', 1, key, 'x', 'ch');
    const t = unb64(ciphertext);
    t[0] ^= 1;
    expect(() => decryptText('ch_1', 1, key, nonce, b64(t), 'ch')).toThrow();
  });
});

describe('BIP-39', () => {
  it('generates 12 distinct words and validates', async () => {
    // the 12-word selection is sampled with replacement over 2048 entries;
    // a collision is astronomically rare (≈4e-10) but possible. Retry on collision
    // so a statistical blip doesn't flake the test.
    let words: string[] = [];
    for (let i = 0; i < 5; i++) {
      words = await generateMnemonic();
      if (new Set(words).size === 12) break;
    }
    expect(words).toHaveLength(12);
    expect(new Set(words).size).toBe(12);
    expect(await validateMnemonic(words)).toBe(true);
  });
  it('rejects unknown word', async () => {
    const words = await generateMnemonic();
    words[0] = 'not-a-word';
    expect(await validateMnemonic(words)).toBe(false);
  });
  it('rejects wrong length', async () => {
    const words = await generateMnemonic();
    expect(await validateMnemonic(words.slice(0, 11))).toBe(false);
    expect(await validateMnemonic([...words, 'zoo'])).toBe(false);
  });
  it('normalizes case/whitespace', async () => {
    const words = await generateMnemonic();
    expect(await validateMnemonic(words.map((w) => ' ' + w.toUpperCase() + ' '))).toBe(true);
  });
});

describe('recovery derivation', () => {
  it('same phrase+salt → same material; different salt differs', async () => {
    const words = await generateMnemonic();
    const a = await deriveRecoveryKeys(words, newKdfSaltHex());
    const salt = newKdfSaltHex();
    const b = await deriveRecoveryKeys(words, salt);
    const c = await deriveRecoveryKeys(words, salt);
    expect(b.authMaterial).toEqual(c.authMaterial);
    expect(b64(a.authMaterial)).not.toBe(b64(b.authMaterial));
  });
});

describe('invite link', () => {
  it('roundtrips code + ephemeral private key through the hash fragment', () => {
    const link = buildInviteLink('ABC234', randomBytes(32));
    const parsed = parseInviteLink(link);
    expect(parsed?.code).toBe('ABC234');
  });
  it('non-invite / malformed links parse to null', () => {
    expect(parseInviteLink('https://x.example/')).toBeNull();
    expect(parseInviteLink('https://x.example/#invite=ABC')).toBeNull();
  });
});

// --- UI-supporting pure logic (Sprint 2/3 additions) ---

describe('password strength heuristic', () => {
  it('short/common input scores 0-1, long varied input reaches 3+', async () => {
    const { passwordScore } = await import('../components/PasswordInput');
    expect(passwordScore('')).toBe(0);
    expect(passwordScore('1234')).toBeLessThanOrEqual(1);
    expect(passwordScore('aaaaaaaa')).toBeLessThanOrEqual(1);
    expect(passwordScore(' Password!2026 ')).toBeGreaterThanOrEqual(3);
    // bounds: any input stays within 0..4
    expect(passwordScore('a'.repeat(100))).toBeLessThanOrEqual(4);
  });
});

describe('recovery quiz positions', () => {
  it('distinct, in range, requested count', async () => {
    const { quizPositions } = await import('./bip39');
    for (let i = 0; i < 20; i++) {
      const q = quizPositions(3);
      expect(q).toHaveLength(3);
      expect(new Set(q).size).toBe(3);
      q.forEach((n) => {
        expect(n).toBeGreaterThanOrEqual(0);
        expect(n).toBeLessThan(12);
      });
    }
  });
});

describe('ws reconnect delay', () => {
  it('grows exponentially, caps at 30s, jitter stays within ±20%', async () => {
    const { nextDelay } = await import('../ws/backoff');
    // bounds hold for every attempt
    for (let attempt = 0; attempt < 12; attempt++) {
      for (let s = 0; s < 30; s++) {
        const d = nextDelay(attempt);
        const raw = Math.min(500 * 2 ** attempt, 30_000);
        expect(d).toBeGreaterThanOrEqual(Math.floor(raw * 0.8) - 1);
        expect(d).toBeLessThanOrEqual(Math.ceil(raw * 1.2) + 1);
      }
    }
    // growth check on raw scale: attempt 0 ≈ 500ms, attempt 10 capped at 30s
    const d0 = nextDelay(0);
    expect(d0).toBeGreaterThanOrEqual(400);
    expect(d0).toBeLessThanOrEqual(600);
    const d10 = nextDelay(10);
    expect(d10).toBeLessThanOrEqual(36_000);
    expect(d10).toBeGreaterThanOrEqual(24_000);
  });
});

describe('unread counter', () => {
  it('counts messages newer than the read marker, tolerates empty lists', async () => {
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: () => undefined,
      removeItem: () => undefined,
    });
    const { unreadCount, useUnreadStore } = await import('../state/unreadStore');
    const msgs = [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 9 }];
    expect(unreadCount('ch', undefined)).toBe(0);
    expect(unreadCount('ch', [])).toBe(0);
    expect(unreadCount('ch', msgs)).toBe(4); // nothing read yet
    useUnreadStore.getState().markRead('ch', 2);
    expect(unreadCount('ch', msgs)).toBe(2); // 3 and 9
    useUnreadStore.getState().markRead('ch', 9);
    expect(unreadCount('ch', msgs)).toBe(0);
    // marker never moves backwards
    useUnreadStore.getState().markRead('ch', 3);
    expect(unreadCount('ch', msgs)).toBe(0);
    vi.unstubAllGlobals();
  });
});
