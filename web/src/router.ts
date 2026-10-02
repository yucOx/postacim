import { parseInviteLink } from './crypto/invite';

export type RouteTarget =
  | { view: 'dm'; dmId: string }
  | { view: 'community'; channelId: string }
  | null;

// invite links own the hash (#/davet/<code>[/<key>]) — routing never touches one

/** "nasıl çalışır?" anlatım sayfasının slug'ı — README'den doğrudan
 *  linklenebilir (auth gerektirmez, giriş yapmış kullanıcıda da açılır) */
export const HOW_IT_WORKS_ROUTE = '#/nasil-calisir';

export function isHowItWorksRoute(hash: string): boolean {
  return hash.replace(/^#\/?/, '') === 'nasil-calisir';
}

/** current location.hash → in-app route; null = default (mektuplar home) */
export function readRoute(): RouteTarget {
  if (parseInviteLink(location.hash)) return null;
  const h = location.hash.replace(/^#\/?/, '');
  if (h.startsWith('dm/')) {
    const dmId = decodeURIComponent(h.slice(3));
    return dmId ? { view: 'dm', dmId } : null;
  }
  if (h.startsWith('ch/')) {
    const channelId = decodeURIComponent(h.slice(3));
    return channelId ? { view: 'community', channelId } : null;
  }
  return null;
}

/** mirror the current view into the hash so F5 lands in the same spot;
 *  replaceState — no history spam, no hashchange loop */
export function writeRoute(view: 'community' | 'dm', dmId: string | null, channelId: string | null): void {
  if (parseInviteLink(location.hash)) return;
  // anlatım sayfası açıkken hash'i ezme — kapatınca mevcut view döner
  if (isHowItWorksRoute(location.hash)) return;
  const hash =
    view === 'dm' && dmId ? `#/dm/${encodeURIComponent(dmId)}` : view === 'community' && channelId ? `#/ch/${encodeURIComponent(channelId)}` : '';
  if (location.hash === hash) return;
  history.replaceState(null, '', hash || location.pathname + location.search);
}