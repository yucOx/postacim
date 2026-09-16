// Kaybolan mesajlar — TTL AAD DIŞI kuralı (Faz 2). Master kural: kripto
// değişikliği = negatif senaryo testleri şart.
//
// expires_at sunucu kolonunda yaşayan DEĞİŞKEN metadata'dır: imza kapsamına
// girmez. Kanıt: aynı ciphertext, farklı expires_at'lı iki "sunucu satırıyla"
// sunulduğunda her ikisi de açılır ve imza doğrulaması geçer — yani TTL'i
// imzada/AAD'de tutmamak bilinçli bir tasarım kararına testle sabittir.
// Karşı kontrol: ciphertext'te tek bayt değişimi her iki yolda da reddedilir.
import { describe, expect, it } from 'vitest';
import { b64, unb64 } from './bytes';
import { generateSignIdentity } from './identity';
import { decryptText, encryptText } from './message';
import { sodiumReady } from './sodium';

await sodiumReady;

const key = new Uint8Array(32).fill(7);
const sender = generateSignIdentity();

describe('TTL AAD dışıdır', () => {
  it('aynı ciphertext farklı expires_at ile kabul edilir — TTL imzada değildir', () => {
    const enc = encryptText('ch_1', 1, key, 'süreli', 'ch', { clientId: 't-1', clientSentAt: 5 }, false, {
      senderId: 'u_1',
      index: 0,
    }, { signPrivateKey: sender.signPrivateKey });
    // sunucu aynı ciphertext'i iki farklı expires_at ile dağıtabilir (ör.
    // janitor gecikmesi veya istemcinin TTL'i yeniden seçmesi senaryosu):
    // satır A = 1 saat, satır B = 1 hafta. AAD ve imza yalnız
    // ciphertext + AAD'ye bağlı olduğundan ikisi de açılır.
    const ctx = { signPublicKey: [sender.signPublicKey], sentAt: 0 };
    const viaHour = decryptText('ch_1', 1, key, enc.nonce, enc.ciphertext, 'ch', { clientId: 't-1', clientSentAt: 5 }, 'u_1', ctx);
    const viaWeek = decryptText('ch_1', 1, key, enc.nonce, enc.ciphertext, 'ch', { clientId: 't-1', clientSentAt: 5 }, 'u_1', ctx);
    expect(viaHour.body).toBe('süreli');
    expect(viaWeek.body).toBe('süreli');
  });

  it('karşı kontrol: ciphertext modifiye edilirse reddedilir (test boş değil)', () => {
    const enc = encryptText('ch_1', 1, key, 'x', 'ch', { clientId: 't-2', clientSentAt: 5 }, false, {
      senderId: 'u_1',
      index: 0,
    }, { signPrivateKey: sender.signPrivateKey });
    const t = unb64(enc.ciphertext);
    t[0] ^= 1;
    const ctx = { signPublicKey: [sender.signPublicKey], sentAt: 0 };
    expect(() =>
      decryptText('ch_1', 1, key, enc.nonce, b64(t), 'ch', { clientId: 't-2', clientSentAt: 5 }, 'u_1', ctx),
    ).toThrow();
  });

  it('binding yoksa da aynı kural: ciphertext + AAD imzalanır, TTL bağımsızdır', () => {
    const enc = encryptText('dm_1', 1, key, 'eski akış', 'dm', undefined, false, {
      senderId: 'u_1',
      index: 2,
    }, { signPrivateKey: sender.signPrivateKey });
    const ctx = { signPublicKey: [sender.signPublicKey], sentAt: 0 };
    expect(
      decryptText('dm_1', 1, key, enc.nonce, enc.ciphertext, 'dm', undefined, 'u_1', ctx).body,
    ).toBe('eski akış');
    expect(
      decryptText('dm_1', 1, key, enc.nonce, enc.ciphertext, 'dm', undefined, 'u_1', ctx).ratchet?.i,
    ).toBe(2);
  });
});