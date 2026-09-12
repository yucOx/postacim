// Central incoming-message notifier: sweet chime (unless muted) + optional OS
// notification while the tab is hidden. The message body never leaves the app
// — the OS toast only names the sender and the room (E2EE privacy: plaintext
// in a system-level notification tray is a different threat surface).
import { playChime } from './sound';
import { useSettingsStore } from '../state/settingsStore';
import { useAppStore } from '../state/appStore';

/** jump to the room a notification was clicked on */
function openChannel(channelId: string): void {
  if (channelId.startsWith('dm_') || channelId.startsWith('gdm_')) {
    useAppStore.getState().openDmChat(channelId);
    return;
  }
  const app = useAppStore.getState();
  if (!app.communities.some((c) => c.channels.some((ch) => ch.id === channelId))) return;
  app.selectChannel(channelId);
  useAppStore.setState({ view: 'community', activeDmId: null });
}

export interface IncomingMessage {
  channelId: string;
  /** community the channel belongs to — drives the per-community mute */
  communityId?: string;
  /** e.g. "topluluk · #genel" or the peer nick */
  title: string;
  nick: string;
}

export function notifyIncomingMessage(m: IncomingMessage): void {
  const s = useSettingsStore.getState();
  const muted = !!m.communityId && s.mutedCommunities.includes(m.communityId);
  if (s.soundOn && !muted) playChime();

  if (
    s.desktopOn &&
    document.hidden &&
    typeof Notification !== 'undefined' &&
    Notification.permission === 'granted'
  ) {
    try {
      const n = new Notification(m.title, { body: `${m.nick}: yeni mesaj`, tag: m.channelId });
      n.onclick = (): void => {
        window.focus();
        openChannel(m.channelId);
      };
    } catch {
      // some platforms throw on malformed/duplicate tags — the chime already played
    }
  }
}