import { useEffect, useState } from 'react';

// Kaybolan mesajlar — istemci tarafı TTL yardımcıları. Sunucu kolonu
// (expires_at) metadata'dır; erişim + ömür sınırı buradaki render süpürmesi
// + sunucu janitor'u kombinasyonuyla sağlanır (README "Bilinen sınırlar").

/** composer seçenekleri (saniye) — etiketler i18n 'ttl.*' anahtarlarında */
export const TTL_OPTIONS = [
  { seconds: 3_600, key: 'ttl.hour' },
  { seconds: 86_400, key: 'ttl.day' },
  { seconds: 604_800, key: 'ttl.week' },
] as const;

export const isExpired = (expiresAt: number | null | undefined, now: number): boolean =>
  expiresAt != null && expiresAt <= now;

export const futureExpiry = (seconds: number, now: number): number => now + seconds * 1000;

/** TTL'li mesaj varken 30 sn'de bir tick — süresi dolan satırlar tombstone'a
 *  döner; yoksa tick kurulmaz (boş re-render yok). */
export function useExpiryTick(hasTtl: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!hasTtl) return;
    const iv = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(iv);
  }, [hasTtl]);
  return now;
}