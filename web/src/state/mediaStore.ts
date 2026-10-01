// Mikrofon / kamera / hoparlör cihaz seçimi. Cihaz listesi tarayıcıdan
// gelir (izin verilince etiketler görünür), seçim localStorage'da tutulur
// ve bir sonraki join'de capture constraint'ine yazılır. Arama sırasında
// seçim değişirse voiceStore.switchDevice canlı geçiş yapar.
import { create } from 'zustand';
import { Room } from 'livekit-client';

export type DeviceKind = 'audioinput' | 'videoinput' | 'audiooutput';

export interface DeviceOption {
  deviceId: string;
  label: string;
  kind: DeviceKind;
}

const KEY = 'pgv_media_devices';

interface Persisted {
  mic: string;
  cam: string;
  speaker: string;
}

function load(): Persisted {
  const empty: Persisted = { mic: '', cam: '', speaker: '' };
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Persisted>;
    return {
      mic: typeof raw.mic === 'string' ? raw.mic : '',
      cam: typeof raw.cam === 'string' ? raw.cam : '',
      speaker: typeof raw.speaker === 'string' ? raw.speaker : '',
    };
  } catch {
    return empty;
  }
}

function persist(v: Persisted): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(v));
  } catch {
    // private mode / quota — session-only
  }
}

/** Hoparlör seçimi setSinkId ile yapılır; desteklemeyen tarayıcılarda
 *  liste boş döner ve hoparlör satırı gizlenir. */
export const speakerSupported = (): boolean =>
  typeof HTMLMediaElement !== 'undefined' &&
  typeof HTMLMediaElement.prototype.setSinkId === 'function';

interface MediaState {
  devices: Record<DeviceKind, DeviceOption[]>;
  /** deviceId per kind — '' = sistem varsayılanı */
  selected: Persisted;
  /** izin isteyen ilk sayımda listeler boş gelir; bu bayrak UI'a "erişilemiyor" */
  permissionDenied: boolean;
  loadDevices: () => Promise<void>;
  select: (kind: DeviceKind, deviceId: string) => void;
  activeId: (kind: DeviceKind) => string;
}

export const useMediaStore = create<MediaState>((set, get) => ({
  devices: { audioinput: [], videoinput: [], audiooutput: [] },
  selected: load(),
  permissionDenied: false,

  loadDevices: async () => {
    try {
      // requestPermissions: izin yoksa etiketler boş gelir ve kullanıcı
      // hangi mikrofonu seçtiğini göremez — bu yüzden önce izin iste
      const kinds: DeviceKind[] = ['audioinput', 'videoinput'];
      if (speakerSupported()) kinds.push('audiooutput');
      const out: Record<DeviceKind, DeviceOption[]> = { audioinput: [], videoinput: [], audiooutput: [] };
      for (const kind of kinds) {
        const list = await Room.getLocalDevices(kind, true);
        out[kind] = list.map((d) => ({ deviceId: d.deviceId, label: d.label || d.deviceId, kind }));
      }
      set({ devices: out, permissionDenied: false });
    } catch {
      set({ permissionDenied: true });
    }
  },

  select: (kind, deviceId) => {
    const selected = { ...get().selected, ...keyFor(kind, deviceId) };
    persist(selected);
    set({ selected });
  },

  activeId: (kind) => get().selected[keyName(kind)] ?? '',
}));

function keyName(kind: DeviceKind): keyof Persisted {
  return kind === 'audioinput' ? 'mic' : kind === 'videoinput' ? 'cam' : 'speaker';
}

function keyFor(kind: DeviceKind, deviceId: string): Partial<Persisted> {
  return { [keyName(kind)]: deviceId };
}

/** Tarayıcının varsayılan cihazının id'si. Kullanıcı "varsayılan"a
 *  döndüğünde track'i canlı olarak bu cihaza geri almak için gerekir —
 *  switchActiveDevice boş id kabul etmez. */
export function systemDefaultId(kind: DeviceKind): string {
  const rows = useMediaStore.getState().devices[kind];
  return rows.find((d) => d.deviceId === 'default')?.deviceId ?? rows[0]?.deviceId ?? '';
}
