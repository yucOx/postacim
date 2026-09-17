// Faz 5c — v4 DH adım parametresi yönetimi, tüm scope'lar (dm/gdm/ch).
// 5b'de dmChatStore içinde yaşayan mantık kanal/gdm ile paylaşılacak şekilde
// genellendi: pencere (M=100/T=24h) ve per-sender ephemeral disiplini AYNI
// (spec: docs/faz5-dh-ratchet-design.md §4).
// Faz 7: per-cihaz namespace — authStore.deviceId geçirilir (eski blob
// → null = primary alias, geriye uyumlu).
import type { DhSendParams, MsgScope } from '../crypto/message';
import { dhAnchor, loadDhStep, newDhEphemeral, nextDhStep, saveDhStep, shouldDhStep } from '../crypto/dhratchet';
import { useAppStore } from './appStore';
import { useAuthStore } from './authStore';

// adım ephemeral'ları — YALNIZ bellek (localStorage'a secret yazılmaz);
// sayfa yenilenince ephemeral kaybolur → sonraki mesaj yeni DH adımı açar (FS).
const ephCache = new Map<string, { publicKey: Uint8Array; privateKey: Uint8Array }>();

// 1:1 DM: karşı tarafın published kimlik X25519 anahtarı yerine, sıralı
// (ben, peer) çiftinden türetilen deterministik DH çapası kullanılır
// (Faz 5b hotfix v2). Kanal/gdm: epok anahtarından türetilen grup DH çapası
// (dhAnchor) — her üye aynı çifti türetir, v4 her zaman üretilebilir;
// v3'e düşüş gerekmez.

// DM çapa çifti — gönderim (dhParamsFor) ve okuma (dmChatStore.toDisplay)
// AYNI yardımcıyı kullanır. Kendi mesajımızda sender_id = ben olduğundan
// okuma tarafı çifti asla [ben, ben] olmamalı; peer, DM üyeliğinden gelir
// (ilk hotfix'te [me, sender] hesaplanmış, kendi mesajları açılamamıştı).
export function dmAnchorIds(channelId: string): [string, string] | null {
  const me = useAuthStore.getState().user?.id;
  const peerId = useAppStore.getState().dms.find((d) => d.id === channelId)?.peer.id;
  return me && peerId ? ([me, peerId].sort() as [string, string]) : null;
}

export async function dhParamsFor(
  channelId: string,
  kind: MsgScope,
  version: number,
  key: Uint8Array,
  index: number,
): Promise<DhSendParams | undefined> {
  const deviceId = useAuthStore.getState().deviceId;
  if (kind === 'dm') {
    const sorted = dmAnchorIds(channelId);
    if (!sorted) return undefined;
    const anchor = dhAnchor('dm', key, sorted);
    const eph = stepEph(channelId, version, index, deviceId);
    return { ...eph, peerStaticPub: anchor.publicKey };
  }
  const anchor = dhAnchor(kind, key);
  const eph = stepEph(channelId, version, index, deviceId);
  return { ...eph, peerStaticPub: anchor.publicKey };
}

// adım kararı: state yok / pencere doldu / ephemeral kayıp → yeni adım
function stepEph(
  channelId: string,
  version: number,
  index: number,
  deviceId: Uint8Array | null,
): { dhPriv: Uint8Array; dhPub: Uint8Array; dhStep: number; stepBase: number } {
  const didStr = deviceId ? deviceIdToB64(deviceId) : '';
  const ck = `${channelId}.${version}.${didStr || 'primary'}`;
  const now = Date.now();
  let step = loadDhStep(channelId, version, didStr);
  let eph = ephCache.get(ck);
  if (shouldDhStep(step, index, now, !!eph)) {
    step = nextDhStep(step?.j ?? -1, index, now);
    saveDhStep(channelId, version, step, didStr);
    eph = newDhEphemeral();
    ephCache.set(ck, eph);
  }
  return { dhPriv: eph!.privateKey, dhPub: eph!.publicKey, dhStep: step!.j, stepBase: step!.base };
}

// 16B device UUID → URL-safe base64 (localStorage anahtarında kullanılır)
function deviceIdToB64(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/[+/=]/g, '_');
}
