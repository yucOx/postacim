// İmza anahtarı defteri — resolveSignKeys, ingestSignKeys, getSignKeys.
// Kendi mesajımızı kendimiz decode edebilmek (sync beklemeden) ile başkaları
// için yalnız key_log'a güvenmek arasındaki ayrım burada sınanıyor.
import { describe, expect, it, beforeEach } from 'vitest';
import {
  getSignKeys,
  ingestSignKeys,
  resetSignKeys,
  resolveSignKeys,
} from './signkeys';
import { b64 } from '../crypto/bytes';

// 32B deterministik anahtar — her testte farklı içerik, kolay teşhis
const k = (seed: number): Uint8Array => {
  const a = new Uint8Array(32);
  a[0] = seed;
  return a;
};

beforeEach(() => {
  resetSignKeys();
});

describe('ingestSignKeys + getSignKeys', () => {
  it('yayınlanmış anahtarları kullanıcıya bağlar; bilinmeyen userId null döner', () => {
    ingestSignKeys([
      { id: 1, user_id: 'u1', sign_public_key: b64(k(1)) },
      { id: 2, user_id: 'u2', sign_public_key: b64(k(2)) },
    ]);
    const u1 = getSignKeys('u1');
    const u2 = getSignKeys('u2');
    const ghost = getSignKeys('u_unknown');
    expect(u1).not.toBeNull();
    expect(u1).toHaveLength(1);
    expect(u1![0]).toEqual(k(1));
    expect(u2![0]).toEqual(k(2));
    expect(ghost).toBeNull();
  });

  it('null sign_public_key atlanır — mevcut listeye dokunmaz', () => {
    ingestSignKeys([{ id: 1, user_id: 'u1', sign_public_key: null }]);
    expect(getSignKeys('u1')).toBeNull();
  });

  it('aynı anahtar ikinci kez eklenirse tekrar etmez', () => {
    ingestSignKeys([{ id: 1, user_id: 'u1', sign_public_key: b64(k(1)) }]);
    ingestSignKeys([{ id: 2, user_id: 'u1', sign_public_key: b64(k(1)) }]);
    expect(getSignKeys('u1')).toHaveLength(1);
  });

  it('key rotation: aynı kullanıcının iki farklı public key\'i dizi olarak döner', () => {
    ingestSignKeys([{ id: 1, user_id: 'u1', sign_public_key: b64(k(1)) }]);
    ingestSignKeys([{ id: 2, user_id: 'u1', sign_public_key: b64(k(2)) }]);
    const list = getSignKeys('u1')!;
    expect(list).toHaveLength(2);
    expect(list).toContainEqual(k(1));
    expect(list).toContainEqual(k(2));
  });
});

describe('resolveSignKeys — self short-circuit', () => {
  it('sync henüz boşken kendi mesajımız için RAM\'deki public döner (key yoksa null)', () => {
    // harita boş — syncKeyLog daha çalışmadı
    expect(getSignKeys('me')).toBeNull();
    // kendi userId'm + RAM'deki public → null değil, kendi key'im
    const got = resolveSignKeys('me', 'me', k(7));
    expect(got).toEqual([k(7)]);
  });

  it('self ama signPublicKey null ise null döner (anonim durum)', () => {
    const got = resolveSignKeys('me', 'me', null);
    expect(got).toBeNull();
  });

  it('userId eşleşmiyorsa RAM\'deki public YOK sayılır (impostor kabul edilmez)', () => {
    // bir saldırgan myUserId'yi bilse bile userId uyuşmazsa kendi anahtarını
    // başkasının adına kullandırtamaz
    const got = resolveSignKeys('u_victim', 'u_me', k(7));
    expect(got).toBeNull();
  });

  it('başka biri sync edilmişse onun defterdeki anahtarı döner', () => {
    ingestSignKeys([{ id: 1, user_id: 'u_other', sign_public_key: b64(k(2)) }]);
    const got = resolveSignKeys('u_other', 'u_me', k(7));
    expect(got).toEqual([k(2)]);
  });

  it('self + harita: ikisi birleştirilir, çift kayıt tekrarlanmaz', () => {
    // kurtarma sonrası yeni sign_public_key yayınlandı → hem RAM hem defter
    ingestSignKeys([{ id: 1, user_id: 'me', sign_public_key: b64(k(1)) }]);
    const got = resolveSignKeys('me', 'me', k(1));
    expect(got).toEqual([k(1)]);
  });

  it('self + harita: farklı iki anahtar (rotation) ikisi de döner', () => {
    ingestSignKeys([
      { id: 1, user_id: 'me', sign_public_key: b64(k(1)) },
      { id: 2, user_id: 'me', sign_public_key: b64(k(2)) },
    ]);
    const got = resolveSignKeys('me', 'me', k(1));
    expect(got).toHaveLength(2);
    expect(got).toContainEqual(k(1));
    expect(got).toContainEqual(k(2));
  });

  it('userId uyuşmuyor + harita boş → null (imzalı mesaj reddedilir)', () => {
    const got = resolveSignKeys('u_unknown', 'u_me', k(7));
    expect(got).toBeNull();
  });

  it('myUserId undefined → yalnız haritaya düşer', () => {
    ingestSignKeys([{ id: 1, user_id: 'u_other', sign_public_key: b64(k(2)) }]);
    const got = resolveSignKeys('u_other', undefined, k(7));
    expect(got).toEqual([k(2)]);
  });
});
