import { useAppStore } from '../state/appStore';
import { useAuthStore } from '../state/authStore';

/** user id → nick, resolved from everything bootstrap already knows.
 *  LiveKit identity is the user id; tiles use this for the name plate. */
export function nickFor(userId: string): string {
  if (userId === useAuthStore.getState().user?.id) {
    const me = useAuthStore.getState().user;
    if (me) return me.nick;
  }
  const app = useAppStore.getState();
  for (const c of app.communities) {
    const m = c.members.find((x) => x.id === userId);
    if (m) return m.nick;
  }
  for (const d of app.dms) if (d.peer.id === userId) return d.peer.nick;
  for (const g of app.gdms) {
    const m = g.members.find((x) => x.id === userId);
    if (m) return m.nick;
  }
  return userId;
}
