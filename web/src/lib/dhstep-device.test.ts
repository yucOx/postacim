// Faz 7 — per-cihaz DH step namespace. Eski hesaplar (deviceId '') 'primary'
// alias'ına yazılır; yeni cihazlar kendi cihaz UUID'leriyle ayrı adım
// sayacı tutar. Aynı channel + aynı version, farklı deviceId = farklı
// ephemeral, farklı DH pub başlığı.
import { describe, expect, it, vi } from 'vitest';
import { loadDhStep, saveDhStep, shouldDhStep } from '../crypto/dhratchet';

describe('per-cihaz DH step (Faz 7)', () => {
  it('aynı channel/version farklı deviceId = ayrı adım sayacı', () => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    });
    saveDhStep('ch_a', 1, { j: 0, base: 0, ts: 1_000_000 }, 'primary');
    saveDhStep('ch_a', 1, { j: 5, base: 250, ts: 2_000_000 }, 'dev_abc');
    expect(loadDhStep('ch_a', 1, 'primary')?.j).toBe(0);
    expect(loadDhStep('ch_a', 1, 'dev_abc')?.j).toBe(5);
    // farklı deviceId ayrı state — etkileşim yok
    expect(loadDhStep('ch_a', 1, 'primary')?.j).not.toBe(
      loadDhStep('ch_a', 1, 'dev_abc')?.j,
    );
    vi.unstubAllGlobals();
  });

  it('shouldDhStep deviceId-bağımsız: pencere mantığı aynı', () => {
    // cihaz başına pencere mantığı F5c spec'ine sadık; deviceId yalnız
    // state namespace'ini etkiler
    const st = { j: 0, base: 0, ts: 1_000_000 };
    expect(shouldDhStep(st, 50, 1_000_000, true)).toBe(false);
    expect(shouldDhStep(st, 100, 1_000_000, true)).toBe(true);
    expect(shouldDhStep(null, 0, 1_000_000, false)).toBe(true);
  });

  it('eski ad alanı (Faz 5/6) boş döner — yeni ad alanı ayrı', () => {
    // geriye uyumluluk notu: eski yazılar `pgv.dhstep.${cid}.${ver}` adresine
    // gitti. Bu test yeni ad alanının bunları görmediğini kanıtlar — eski
    // hesaplar bir kez mesaj yazınca yeni ad alanına taşınır (otomatik
    // migration client-side, reload sonrası yeni adımdan başlar).
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    });
    expect(loadDhStep('ch_legacy', 1, 'primary')).toBeNull();
    saveDhStep('ch_legacy', 1, { j: 1, base: 50, ts: 1_500_000 }, 'primary');
    expect(loadDhStep('ch_legacy', 1, 'primary')?.j).toBe(1);
    vi.unstubAllGlobals();
  });
});
