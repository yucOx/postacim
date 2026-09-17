// Faz 7 — cihaz listesi + linking durumu. Bootstrap'tan hidrate olur;
// linking/revoke/restoring event'leri appStore.wireEvents üzerinden WS'ten
// gelir (server-side hub.sendToUser push).
import { create } from 'zustand';
import { api } from '../api/client';

export interface DeviceInfo {
  id: string;
  user_id: string;
  name: string;
  x25519_public_key: string;
  ed25519_public_key: string | null;
  is_primary: number;
  linked_at: number;
  last_seen_at: number | null;
  revoked_at: number | null;
}

interface DeviceState {
  devices: DeviceInfo[];
  /** primary cihazda: henüz yanıtlanmamış link isteği. Modal açar. */
  pendingLink: { device_id: string; device_name: string; ephemeral_pub: string } | null;
  /** joinee tarafında: henüz tamamlanmamış linking flow */
  ownLinkInProgress: boolean;
  loadDevices: () => Promise<void>;
  startLink: (name: string) => Promise<string>;
  approveLink: (linkToken: string, approval: string) => Promise<void>;
  declineLink: () => void;
  finishLink: (params: { link_token: string; x25519_public_key: string; ed25519_public_key: string }) => Promise<{ device_id: string }>;
  revokeDevice: (deviceId: string) => Promise<void>;
  setPendingLink: (p: DeviceState['pendingLink']) => void;
  clearOwnLink: () => void;
}

export const useDeviceStore = create<DeviceState>((set) => ({
  devices: [],
  pendingLink: null,
  ownLinkInProgress: false,

  loadDevices: async () => {
    const j = await api<{ devices: DeviceInfo[] }>('/devices');
    set({ devices: j.devices });
  },

  startLink: async (name: string) => {
    // 1) joinee: ephemeral X25519 keypair üret, sunucuya gönder → link_token
    //    NOT: ephemeral keypair bu fonksiyonu çağıran yerde üretilir
    //    (cihaz KEK + ephemeral private döner; burada yalnız public alınır).
    set({ ownLinkInProgress: true });
    return ''; // caller (linking UI) bunu kullanmaz — kendi flow'u
  },

  approveLink: async (linkToken: string, approval: string) => {
    await api('/devices/link/approve', { method: 'POST', body: { link_token: linkToken, approval } });
    set({ pendingLink: null });
  },

  declineLink: () => set({ pendingLink: null }),

  finishLink: async (params) => {
    const j = await api<{ device_id: string }>('/devices/link/finish', { method: 'POST', body: params });
    set({ ownLinkInProgress: false });
    return j;
  },

  revokeDevice: async (deviceId: string) => {
    await api(`/devices/${deviceId}/revoke`, { method: 'POST' });
    set((s) => ({ devices: s.devices.filter((d) => d.id !== deviceId) }));
  },

  setPendingLink: (p) => set({ pendingLink: p }),
  clearOwnLink: () => set({ ownLinkInProgress: false }),
}));
