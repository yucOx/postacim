// Client-side notification prefs — the server never learns them. Sound is on
// by default (it's local WebAudio); desktop notifications are opt-in because
// they need a browser permission.
import { create } from 'zustand';

const SOUND_KEY = 'pgv_sound';
const DESKTOP_KEY = 'pgv_desktop';
const MUTE_KEY = 'pgv_muted_coms';
const ASKED_KEY = 'pgv_desktop_asked';

function loadBool(key: string, dflt: boolean): boolean {
  try {
    const v = localStorage.getItem(key);
    return v === null ? dflt : v === '1';
  } catch {
    return dflt;
  }
}
function loadMuted(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(MUTE_KEY) ?? '[]') as unknown;
    return Array.isArray(v) ? (v as string[]) : [];
  } catch {
    return [];
  }
}

interface SettingsState {
  /** play a chime on incoming messages */
  soundOn: boolean;
  /** OS-level notifications (requires granted permission + a secure context) */
  desktopOn: boolean;
  /** per-community sound mute — the unread badges stay, only the sound stops */
  mutedCommunities: string[];
  /** the one-time startup prompt was shown (never nag again) */
  desktopAsked: boolean;
  toggleSound: () => void;
  enableDesktop: () => void;
  disableDesktop: () => void;
  markDesktopAsked: () => void;
  toggleCommunityMute: (communityId: string) => void;
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  soundOn: loadBool(SOUND_KEY, true),
  desktopOn: loadBool(DESKTOP_KEY, false),
  mutedCommunities: loadMuted(),
  desktopAsked: loadBool(ASKED_KEY, false),

  toggleSound: () => {
    const next = !get().soundOn;
    try {
      localStorage.setItem(SOUND_KEY, next ? '1' : '0');
    } catch {
      // private mode — session-only
    }
    set({ soundOn: next });
  },

  enableDesktop: () => {
    try {
      localStorage.setItem(DESKTOP_KEY, '1');
    } catch {
      // ignore
    }
    set({ desktopOn: true });
  },

  disableDesktop: () => {
    try {
      localStorage.setItem(DESKTOP_KEY, '0');
    } catch {
      // ignore
    }
    set({ desktopOn: false });
  },

  markDesktopAsked: () => {
    try {
      localStorage.setItem(ASKED_KEY, '1');
    } catch {
      // ignore
    }
    set({ desktopAsked: true });
  },

  toggleCommunityMute: (communityId) => {
    const cur = get().mutedCommunities;
    const next = cur.includes(communityId)
      ? cur.filter((id) => id !== communityId)
      : [...cur, communityId];
    try {
      localStorage.setItem(MUTE_KEY, JSON.stringify(next));
    } catch {
      // ignore
    }
    set({ mutedCommunities: next });
  },
}));