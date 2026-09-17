import { sodium } from './sodium';
import { b64 } from './bytes';

// --- Faz 5b: hafif çift-DH ratchet çekirdeği (spec: docs/faz5-dh-ratchet-design.md) ---
// Saf fonksiyonlar: zincir türetimi + pencere sayacı + self-update doğrulama.
// Kalıcı state YOKTUR — göndericinin ephemeral private'ı bellekte adım ömrü
// kadar yaşar, localStorage'da sır taşınmaz (yalnız {j, base, ts} sayacı).

// PCS-lite penceresi: M mesaj veya T süre (hangisi önce dolarsa) → yeni DH adımı.
// Değerlerin gerekçesi spec §4'te; değişiklik spec ile birlikte yapılır.
export const DH_STEP_MSGS = 100;
export const DH_STEP_TTL_MS = 24 * 60 * 60 * 1000;

// DH header: dh_pub (32) ‖ j (u32 LE) ‖ step_base (u32 LE) — plaintext taşınır
export const DH_HEADER_LEN = 40;

const enc = new TextEncoder();
const H = (data: Uint8Array): Uint8Array => sodium.crypto_generichash(32, data, null);

const le32 = (n: number): Uint8Array => {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, n, true);
  return out;
};
const readLe32 = (bytes: Uint8Array, offset: number): number =>
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset, true);

export interface DhStepState {
  /** DH adım sayacı — gönderici başına, monotonik artan (u32) */
  j: number;
  /** adımın başladığı global zincir index'i */
  base: number;
  /** adımın açılış zamanı (ms epoch) — T penceresi bunun üstünde */
  ts: number;
}

/** v2 ile aynı kök: H(epoch_key ‖ 'ratchet' ‖ sender_id) — tek tanım, iki yol */
export function chainSeed(epochKey: Uint8Array, senderId: string): Uint8Array {
  return H(new Uint8Array([...epochKey, ...enc.encode('ratchet'), ...enc.encode(senderId)]));
}

/** X25519 paylaşılan sırrı — tüm-sıfır çıktıda libsodium fırlatır (identity koruması) */
export function dhShared(priv: Uint8Array, pub: Uint8Array): Uint8Array {
  return sodium.crypto_scalarmult(priv, pub);
}

/** adım kökü: chain_seed + DH çıktısı + adım sayacı karışır (FS burada kapanır) */
export function dhStepRoot(seed: Uint8Array, dhOut: Uint8Array, j: number): Uint8Array {
  return H(new Uint8Array([...seed, ...enc.encode('dh'), ...le32(j), ...dhOut]));
}

// adım içi kök önbelleği: per step_root b64 → roots[l]. Bellekte; 32B/kök.
const stepCache = new Map<string, Uint8Array[]>();

/** adım içi l. mesajın AEAD anahtarı — 'step'/'msg' etiketleri v2 ile aynı */
export function dhMsgKey(stepRoot: Uint8Array, l: number): Uint8Array {
  const ck = b64(stepRoot);
  let roots = stepCache.get(ck);
  if (!roots) {
    roots = [stepRoot];
    stepCache.set(ck, roots);
  }
  for (let i = roots.length; i <= l; i++) {
    roots[i] = H(new Uint8Array([...roots[i - 1]!, ...enc.encode('step')]));
  }
  return H(new Uint8Array([...roots[l]!, ...enc.encode('msg')]));
}

/** taze adım ephemeral'ı — private yalnız bellekte; adım sonunda atılır */
export function newDhEphemeral(): { publicKey: Uint8Array; privateKey: Uint8Array } {
  const kp = sodium.crypto_box_keypair(); // X25519
  return { publicKey: kp.publicKey, privateKey: kp.privateKey };
}

export function encodeDhHeader(dhPub: Uint8Array, j: number, base: number): Uint8Array {
  const out = new Uint8Array(DH_HEADER_LEN);
  out.set(dhPub, 0);
  out.set(le32(j), 32);
  out.set(le32(base), 36);
  return out;
}

export interface DhHeader {
  dhPub: Uint8Array;
  j: number;
  base: number;
}

/** bozuk/kısa başlıkta null — çağıran v1/v2/v3 yollarına döner */
export function decodeDhHeader(bytes: Uint8Array): DhHeader | null {
  if (bytes.length < DH_HEADER_LEN) return null;
  return { dhPub: bytes.slice(0, 32), j: readLe32(bytes, 32), base: readLe32(bytes, 36) };
}

/** yeni adım zamanı: state yok / pencere doldu / ephemeral kayıp */
export function shouldDhStep(
  state: DhStepState | null,
  index: number,
  now: number,
  haveEphemeral: boolean,
): boolean {
  if (!state || !haveEphemeral) return true;
  return index - state.base >= DH_STEP_MSGS || now - state.ts >= DH_STEP_TTL_MS;
}

/** sonraki adım: j monotonik artar, base = adımın ilk mesajının index'i */
export function nextDhStep(lastJ: number, index: number, now: number): DhStepState {
  return { j: lastJ + 1, base: index, ts: now };
}

// --- gönderici adım sayacı (localStorage, sır değil) ---
const stepKey = (channelId: string, version: number): string => `pgv.dhstep.${channelId}.${version}`;

export function loadDhStep(channelId: string, version: number): DhStepState | null {
  const raw = localStorage.getItem(stepKey(channelId, version));
  if (!raw) return null;
  try {
    const p = JSON.parse(raw) as DhStepState;
    if (typeof p.j !== 'number' || typeof p.base !== 'number' || typeof p.ts !== 'number') return null;
    return p;
  } catch {
    return null;
  }
}

export function saveDhStep(channelId: string, version: number, state: DhStepState): void {
  localStorage.setItem(stepKey(channelId, version), JSON.stringify(state));
}

// --- self-update duyurusu (yalnız doğrulama yardımcıları — 5c canlı connect eder) ---
// Kanon: utf8('postacim/dh-update/v1') ‖ utf8(channel_id) ‖ u32LE(epoch_version) ‖ yeni_dh_pub.
// Dağıtım WS relay only — sunucu plaintext görmez (değişmez). Spec §6.
export const DH_UPDATE_DOMAIN = 'postacim/dh-update/v1';

export function encodeDhUpdate(channelId: string, version: number, dhPub: Uint8Array): Uint8Array {
  return new Uint8Array([
    ...enc.encode(DH_UPDATE_DOMAIN),
    ...enc.encode(channelId),
    ...le32(version),
    ...dhPub,
  ]);
}

/** imza göndericinin defterdeki Ed25519 public'iyle doğrulanır — aksi halde reddet */
export function verifyDhUpdate(payload: Uint8Array, sig: Uint8Array, signPublicKey: Uint8Array): boolean {
  try {
    return sodium.crypto_sign_verify_detached(sig, payload, signPublicKey);
  } catch {
    return false;
  }
}
