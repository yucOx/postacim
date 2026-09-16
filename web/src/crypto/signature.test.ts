// Gönderen atfı — Ed25519 imzalı mesajlar (v3) doğrulama ve red senaryoları.
// Master kural: kripto değişikliği = negatif senaryo testleri şart.
import { describe, expect, it } from 'vitest';
import { b64, unb64, randomBytes } from './bytes';
import { generateSignIdentity } from './identity';
import { decryptText, encryptText, SIGN_CUTOVER_MS, type SigContext } from './message';
import { sodiumReady } from './sodium';

await sodiumReady;

const key = randomBytes(32);
const sender = generateSignIdentity();
const other = generateSignIdentity();

const sigCtx = (signPublicKey: Uint8Array[] | null, sentAt: number): SigContext => ({
  signPublicKey,
  sentAt,
});
const PRE_CUTOVER = SIGN_CUTOVER_MS - 60_000;
const POST_CUTOVER = SIGN_CUTOVER_MS + 60_000;

describe('v3 imzalı mesajlar', () => {
  it('imzalı mesaj doğru anahtarla açılır ve doğrulanır (ratchet dahil)', () => {
    const enc = encryptText('ch_1', 1, key, 'imzalı', 'ch', { clientId: 'c-1', clientSentAt: 5 }, false, {
      senderId: 'u_1',
      index: 3,
    }, { signPrivateKey: sender.signPrivateKey });
    const msg = decryptText('ch_1', 1, key, enc.nonce, enc.ciphertext, 'ch', { clientId: 'c-1', clientSentAt: 5 }, 'u_1', sigCtx([sender.signPublicKey], PRE_CUTOVER));
    expect(msg.body).toBe('imzalı');
    expect(msg.ratchet?.i).toBe(3);
  });

  it('sahte gönderici reddedilir — imza başka anahtara ait', () => {
    const enc = encryptText('ch_1', 1, key, 'x', 'ch', { clientId: 'c-2', clientSentAt: 5 }, false, {
      senderId: 'u_1',
      index: 0,
    }, { signPrivateKey: sender.signPrivateKey });
    // sunucu sender_id'yi u_2 yaptı: doğrulama u_2'nin anahtarıyla düşer
    expect(() =>
      decryptText('ch_1', 1, key, enc.nonce, enc.ciphertext, 'ch', { clientId: 'c-2', clientSentAt: 5 }, 'u_1', sigCtx([other.signPublicKey], PRE_CUTOVER)),
    ).toThrow();
  });

  it('modifiye ciphertext reddedilir — imza bayt değişimini yakalar', () => {
    const enc = encryptText('ch_1', 1, key, 'x', 'ch', { clientId: 'c-3', clientSentAt: 5 }, false, {
      senderId: 'u_1',
      index: 0,
    }, { signPrivateKey: sender.signPrivateKey });
    const t = unb64(enc.ciphertext);
    t[0] ^= 1;
    expect(() =>
      decryptText('ch_1', 1, key, enc.nonce, b64(t), 'ch', { clientId: 'c-3', clientSentAt: 5 }, 'u_1', sigCtx([sender.signPublicKey], PRE_CUTOVER)),
    ).toThrow();
  });

  it('AAD taşıma reddedilir — imza AAD\'ye bağlı, ciphertext başka kanala taşınamaz', () => {
    const enc = encryptText('ch_1', 1, key, 'x', 'ch', { clientId: 'c-4', clientSentAt: 5 }, false, {
      senderId: 'u_1',
      index: 0,
    }, { signPrivateKey: sender.signPrivateKey });
    // MAC farklı kanal için zaten düşer; imza da bağımsız olarak düşer
    expect(() =>
      decryptText('ch_2', 1, key, enc.nonce, enc.ciphertext, 'ch', { clientId: 'c-4', clientSentAt: 5 }, 'u_1', sigCtx([sender.signPublicKey], PRE_CUTOVER)),
    ).toThrow();
  });

  it('gönderenin imza anahtarı bilinmiyorsa imzalı mesaj reddedilir', () => {
    const enc = encryptText('ch_1', 1, key, 'x', 'ch', { clientId: 'c-5', clientSentAt: 5 }, false, {
      senderId: 'u_1',
      index: 0,
    }, { signPrivateKey: sender.signPrivateKey });
    expect(() =>
      decryptText('ch_1', 1, key, enc.nonce, enc.ciphertext, 'ch', { clientId: 'c-5', clientSentAt: 5 }, 'u_1', sigCtx(null, PRE_CUTOVER)),
    ).toThrow();
  });

  it('anahtar yenilenmesi: yayınlanmış herhangi biri doğrular', () => {
    const enc = encryptText('ch_1', 1, key, 'eski anahtarla', 'ch', { clientId: 'c-6', clientSentAt: 5 }, false, {
      senderId: 'u_1',
      index: 0,
    }, { signPrivateKey: sender.signPrivateKey });
    const msg = decryptText('ch_1', 1, key, enc.nonce, enc.ciphertext, 'ch', { clientId: 'c-6', clientSentAt: 5 }, 'u_1', sigCtx([other.signPublicKey, sender.signPublicKey], PRE_CUTOVER));
    expect(msg.body).toBe('eski anahtarla');
  });

  it('geçiş: cutover öncesi imzasız kabul, sonrası reddedilir', () => {
    const enc = encryptText('ch_1', 1, key, 'eski istemci', 'ch', { clientId: 'c-7', clientSentAt: 5 }, false, {
      senderId: 'u_1',
      index: 0,
    });
    expect(
      decryptText('ch_1', 1, key, enc.nonce, enc.ciphertext, 'ch', { clientId: 'c-7', clientSentAt: 5 }, 'u_1', sigCtx([sender.signPublicKey], PRE_CUTOVER)).body,
    ).toBe('eski istemci');
    expect(() =>
      decryptText('ch_1', 1, key, enc.nonce, enc.ciphertext, 'ch', { clientId: 'c-7', clientSentAt: 5 }, 'u_1', sigCtx([sender.signPublicKey], POST_CUTOVER)),
    ).toThrow();
  });

  it('sigCtx verilmezse eski davranış — imzasız koşulsuz kabul', () => {
    const enc = encryptText('ch_1', 1, key, 'bağlamsız', 'ch', { clientId: 'c-8', clientSentAt: 5 }, false, {
      senderId: 'u_1',
      index: 0,
    });
    expect(decryptText('ch_1', 1, key, enc.nonce, enc.ciphertext, 'ch', { clientId: 'c-8', clientSentAt: 5 }, 'u_1').body).toBe('bağlamsız');
  });

  it('imza baytları silinerek v2\'ye düşürme: cutover sonrası reddedilir', () => {
    const enc = encryptText('ch_1', 1, key, 'x', 'ch', { clientId: 'c-9', clientSentAt: 5 }, false, {
      senderId: 'u_1',
      index: 0,
    }, { signPrivateKey: sender.signPrivateKey });
    // imza düşürülünce mesaj imzasız v2'dir — cutover öncesi geçiş kuralına
    // göre kabul, SONRASI imzasız kabul edilmez (downgrade kapanır)
    const stripped = b64(unb64(enc.ciphertext).slice(0, -64));
    expect(
      decryptText('ch_1', 1, key, enc.nonce, stripped, 'ch', { clientId: 'c-9', clientSentAt: 5 }, 'u_1', sigCtx([sender.signPublicKey], PRE_CUTOVER)).body,
    ).toBe('x');
    expect(() =>
      decryptText('ch_1', 1, key, enc.nonce, stripped, 'ch', { clientId: 'c-9', clientSentAt: 5 }, 'u_1', sigCtx([sender.signPublicKey], POST_CUTOVER)),
    ).toThrow();
  });
});
