// Kaybolan mesajlar (disappearing messages) — sunucu tarafı TTL yardımcıları.
// TTL, göndericinin composer'dan seçtiği satır başına bir değerdir ve sunucu
// kolonunda (`expires_at`) düz metadata olarak yaşar: imza ve AAD kapsamı
// DIŞINDADIR (değişken metadata — kripto bağlamına bağlansaydı sunucu kolonu
// istemci kriptosuyla uyumsuz olurdu). Dürüst sınır: sunucu süreyi görebilir;
// erişim + ömür sınırlaması client-side render + saatlik janitor kombinasyonu
// ile sağlanır (README/PRIVACY "Bilinen sınırlar").
export const MAX_MESSAGE_TTL_MS = 30 * 86_400_000; // 30 gün — makul üst sınır

/** undefined = geçersiz (geçmiş, tavan üstü, tip yanlış); null = TTL kapalı */
export function parseExpiresAt(v: unknown, now: number): number | null | undefined {
  if (v === undefined || v === null) return null;
  if (
    typeof v !== 'number' ||
    !Number.isInteger(v) ||
    v <= now ||
    v > now + MAX_MESSAGE_TTL_MS
  ) {
    return undefined;
  }
  return v;
}

export const isExpired = (expiresAt: number | null | undefined, now: number): boolean =>
  expiresAt != null && expiresAt <= now;