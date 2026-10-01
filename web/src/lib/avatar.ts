// Client-side avatar pipeline. Goal: any reasonable input → tiny data URL so
// the server never stores anything close to a real photo (3-8KB target).

const MAX_SIDE = 64;
const QUALITY = 0.5;
const MAX_BYTES = 14_000; // server hard cap is 16KB; leave headroom for base64

export interface ProcessedAvatar {
  dataUrl: string;
  bytes: number;
}

export async function processAvatarFile(file: File | Blob): Promise<ProcessedAvatar> {
  if (!file.type.startsWith('image/')) {
    throw new Error('sadece resim dosyaları');
  }
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas =
    typeof OffscreenCanvas !== 'undefined'
      ? new OffscreenCanvas(w, h)
      : (() => {
          const c = document.createElement('canvas');
          c.width = w;
          c.height = h;
          return c;
        })();
  const ctx = canvas.getContext('2d') as
    | CanvasRenderingContext2D
    | OffscreenCanvasRenderingContext2D
    | null;
  if (!ctx) throw new Error('canvas yok');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close?.();
  // Prefer JPEG (smallest). Fall back to WebP if the browser refuses canvas.toBlob for it.
  const blob: Blob = await canvasToBlob(canvas, 'image/jpeg', QUALITY);
  if (blob.size > MAX_BYTES) {
    // last-ditch shrink: re-encode at lower quality / smaller size
    const smaller = await canvasToBlob(canvas, 'image/jpeg', 0.35);
    return finalize(smaller);
  }
  return finalize(blob);
}

function canvasToBlob(canvas: OffscreenCanvas | HTMLCanvasElement, type: string, quality: number): Promise<Blob> {
  if ('convertToBlob' in canvas) return canvas.convertToBlob({ type, quality });
  return new Promise((resolve, reject) => {
    (canvas as HTMLCanvasElement).toBlob(
      (b) => (b ? resolve(b) : reject(new Error('toBlob başarısız'))),
      type,
      quality,
    );
  });
}

function finalize(blob: Blob): Promise<ProcessedAvatar> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = (): void => reject(new Error('okuma hatası'));
    reader.onload = (): void => {
      const dataUrl = reader.result as string;
      resolve({ dataUrl, bytes: blob.size });
    };
    reader.readAsDataURL(blob);
  });
}

const avatarCache = new Map<string, string>(); // userId -> dataUrl | '' (miss)
/** fetch another user's avatar by id. cached for the session. */
export async function fetchAvatar(userId: string): Promise<string | null> {
  if (avatarCache.has(userId)) {
    const cached = avatarCache.get(userId)!;
    return cached === '' ? null : cached;
  }
  try {
    const res = await fetch(`/api/users/${userId}/avatar`, { credentials: 'same-origin' });
    if (res.status === 204) {
      avatarCache.set(userId, '');
      return null;
    }
    if (!res.ok) return null;
    const blob = await res.blob();
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = (): void => resolve(r.result as string);
      r.onerror = (): void => reject(new Error('okuma hatası'));
      r.readAsDataURL(blob);
    });
    avatarCache.set(userId, dataUrl);
    return dataUrl;
  } catch {
    return null;
  }
}

export function invalidateAvatar(userId: string): void {
  avatarCache.delete(userId);
}

// Community profile photo — same fetch model as user avatars, but the cache
// key carries the server's avatar_updated_at so a re-upload (new ?v=) is
// fetched instead of served stale from the session cache.
const communityAvatarCache = new Map<string, string>(); // `${id}@${v}` -> dataUrl | '' (miss)
export async function fetchCommunityAvatar(communityId: string, version: number): Promise<string | null> {
  const key = `${communityId}@${version}`;
  if (communityAvatarCache.has(key)) {
    const cached = communityAvatarCache.get(key)!;
    return cached === '' ? null : cached;
  }
  try {
    const res = await fetch(`/api/communities/${communityId}/avatar?v=${version}`, {
      credentials: 'same-origin',
    });
    if (res.status === 204) {
      communityAvatarCache.set(key, '');
      return null;
    }
    if (!res.ok) return null;
    const blob = await res.blob();
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = (): void => resolve(r.result as string);
      r.onerror = (): void => reject(new Error('okuma hatası'));
      r.readAsDataURL(blob);
    });
    communityAvatarCache.set(key, dataUrl);
    return dataUrl;
  } catch {
    return null;
  }
}

/** drop the community's cached entries (any version) — next fetch goes to the
 *  server. Called after a successful upload/clear so the local UI flips
 *  immediately even before bootstrap refreshes avatar_updated_at. */
export function invalidateCommunityAvatar(communityId: string): void {
  for (const k of communityAvatarCache.keys()) {
    if (k.startsWith(`${communityId}@`)) communityAvatarCache.delete(k);
  }
}
