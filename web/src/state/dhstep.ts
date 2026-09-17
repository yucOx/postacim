// Faz 5c — v4 DH adım parametresi yönetimi, tüm scope'lar (dm/gdm/ch).
// 5b'de dmChatStore içinde yaşayan mantık kanal/gdm ile paylaşılacak şekilde
// genellendi: pencere (M=100/T=24h) ve per-sender ephemeral disiplini AYNI
// (spec: docs/faz5-dh-ratchet-design.md §4).
import type { DhSendParams, MsgScope } from '../crypto/message';
import { dhAnchor, loadDhStep, newDhEphemeral, nextDhStep, saveDhStep, shouldDhStep } from '../crypto/dhratchet';
import { unb64 } from '../crypto/bytes';
import { useAppStore } from './appStore';

// adım ephemeral'ları — YALNIZ bellek (localStorage'a secret yazılmaz);
// sayfa yenilenince ephemeral kaybolur → sonraki mesaj yeni DH adımı açar (FS).
const ephCache = new Map<string, { publicKey: Uint8Array; privateKey: Uint8Array }>();

// 1:1 DM: karşı tarafın published kimlik X25519 anahtarı DH çıktısını belirler;
// anahtar yoksa v3'e düşülür (imzalı simetrik ratchet).
// Kanal/gdm: epok anahtarından türetilen grup DH çapası (dhAnchor) — her üye
// aynı çifti türetir, v4 her zaman üretilebilir; v3'e düşüş gerekmez.
export async function dhParamsFor(
  channelId: string,
  kind: MsgScope,
  version: number,
  key: Uint8Array,
  index: number,
): Promise<DhSendParams | undefined> {
  if (kind === 'dm') {
    const peerId = useAppStore.getState().dms.find((d) => d.id === channelId)?.peer.id;
    if (!peerId) return undefined;
    const peerPubOf = (): string | undefined => {
      const app = useAppStore.getState();
      return app.publicKeys[peerId] ?? app.friends.find((f) => f.id === peerId)?.public_key;
    };
    let peerPub = peerPubOf();
    if (!peerPub) {
      await useAppStore.getState().loadBootstrap();
      peerPub = peerPubOf();
    }
    if (!peerPub) return undefined;
    const eph = stepEph(channelId, version, index);
    return { ...eph, peerStaticPub: unb64(peerPub) };
  }
  const anchor = dhAnchor(key);
  const eph = stepEph(channelId, version, index);
  return { ...eph, peerStaticPub: anchor.publicKey };
}

// adım kararı: state yok / pencere doldu / ephemeral kayıp → yeni adım
function stepEph(
  channelId: string,
  version: number,
  index: number,
): { dhPriv: Uint8Array; dhPub: Uint8Array; dhStep: number; stepBase: number } {
  const ck = `${channelId}.${version}`;
  const now = Date.now();
  let step = loadDhStep(channelId, version);
  let eph = ephCache.get(ck);
  if (shouldDhStep(step, index, now, !!eph)) {
    step = nextDhStep(step?.j ?? -1, index, now);
    saveDhStep(channelId, version, step);
    eph = newDhEphemeral();
    ephCache.set(ck, eph);
  }
  return { dhPriv: eph!.privateKey, dhPub: eph!.publicKey, dhStep: step!.j, stepBase: step!.base };
}
