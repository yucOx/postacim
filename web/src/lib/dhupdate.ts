// Faz 5c — self-update duyurusu: doğrulama + TOFU pin (spec: docs/faz5-dh-ratchet-design.md §6).
// Ele geçirilen cihazın yerine geçmek isteyen kurban, YENİ bir DH public'ini
// Ed25519 imzalı duyuruyla yayınlar (WS dh_update relay — sunucu opak geçirir).
// Alıcı: kanonu ayrıştırır, imzayı anahtar defterindeki Ed25519 anahtarıyla
// doğrular, geçerliyse (kanal, gönderen) başına son duyuruyu pin'ler.
// UI metni yok — kayıt sessiz tutulur; kullanım Faz 6 gossip'ine bağlanır.
import { b64, unb64 } from '../crypto/bytes';
import { DH_UPDATE_DOMAIN, encodeDhUpdate, verifyDhUpdate } from '../crypto/dhratchet';
import { sodium } from '../crypto/sodium';

const SIG_LEN = 64;
const PUB_LEN = 32;
const enc = new TextEncoder();

export interface DhUpdateNotice {
  channelId: string;
  version: number;
  dhPub: Uint8Array;
  /** doğrulanmış kanon + imza — relay gövdesi (b64) */
  payloadB64: string;
}

export type IngestResult = 'ok' | 'malformed' | 'unknown-sender' | 'bad-signature';

/**
 * Faz 5d — hangi ingest sonucu güvenlik bandı tetikler? Yalnız 'bad-signature':
 * doğru boyutlu ama defter anahtarıyla doğrulanamayan duyuru = gerçek kriptografik
 * çelişki adayı. 'malformed' (boyut/b64 çöpü) ve 'unknown-sender' (defter kaydı
 * henüz senkronlanmamış) bant tetiklemez — herkesin duyurabileceği çöp frame'ler
 * kırmızı güvenlik uyarısını spam'e çevirmesin (dürüst takas: tam sessiz red).
 */
export function bandFromIngest(r: IngestResult): 'bad-signature' | null {
  return r === 'bad-signature' ? 'bad-signature' : null;
}

// TOFU pin: (kanal, gönderen) → son geçerli duyuru; localStorage'da sır yok
// (public key + epok numarası) — keypins.ts deseni, sır taşımaz
const STORE_KEY = 'pgv.dhupdates.v1';
type PinMap = Record<string, Record<string, { version: number; pub: string }>>;

function loadPins(): PinMap {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    return raw ? (JSON.parse(raw) as PinMap) : {};
  } catch {
    return {};
  }
}

/** kanonu ayrıştır + imzayı göndericinin defter anahtarlarıyla doğrula */
export function verifyNotice(
  channelId: string,
  payloadB64: string,
  signPublicKeys: Uint8Array[] | null,
): DhUpdateNotice | null {
  const payload = unb64(payloadB64);
  const domain = enc.encode(DH_UPDATE_DOMAIN);
  const ch = enc.encode(channelId);
  // kanon: domain ‖ utf8(channel_id) ‖ u32LE(version) ‖ dh_pub(32) ‖ imza(64)
  if (payload.length !== domain.length + ch.length + 4 + PUB_LEN + SIG_LEN) return null;
  for (let i = 0; i < domain.length; i++) {
    if (payload[i] !== domain[i]) return null;
  }
  for (let i = 0; i < ch.length; i++) {
    if (payload[domain.length + i] !== ch[i]) return null; // frame kanalıyla uyuşmalı
  }
  const canonical = payload.slice(0, payload.length - SIG_LEN);
  const sig = payload.slice(payload.length - SIG_LEN);
  const dhPub = canonical.slice(canonical.length - PUB_LEN);
  const version = new DataView(canonical.buffer, canonical.byteOffset + domain.length + ch.length, 4).getUint32(0, true);
  if (!signPublicKeys || signPublicKeys.length === 0) return null;
  const ok = signPublicKeys.some((pk) => verifyDhUpdate(canonical, sig, pk));
  if (!ok) return null;
  return { channelId, version, dhPub, payloadB64 };
}

/**
 * WS `dh_update` frame gövdesini işler: doğrular, pin'ler.
 * 'bad-signature' / 'malformed' duyuruları sessizce reddedilir — negatif
 * senaryo (yanlış Ed25519) testle sabitlidir.
 */
export function ingestDhUpdate(
  from: string,
  channelId: string,
  payloadB64: string,
  signPublicKeys: Uint8Array[] | null,
): IngestResult {
  let payload: Uint8Array;
  try {
    payload = unb64(payloadB64);
  } catch {
    return 'malformed';
  }
  const notice = verifyNotice(channelId, payloadB64, signPublicKeys);
  if (!signPublicKeys || signPublicKeys.length === 0) return 'unknown-sender';
  if (!notice) {
    // biçim mi imza mı — ayrım yalnız geri dönüş değeri için
    const size = enc.encode(DH_UPDATE_DOMAIN).length + enc.encode(channelId).length + 4 + PUB_LEN + SIG_LEN;
    return payload.length === size ? 'bad-signature' : 'malformed';
  }
  try {
    const pins = loadPins();
    const bySender = pins[channelId] ?? {};
    bySender[from] = { version: notice.version, pub: b64(notice.dhPub) };
    pins[channelId] = bySender;
    localStorage.setItem(STORE_KEY, JSON.stringify(pins));
  } catch {
    // storage kapalı — doğrulama yine 'ok', pin bu oturumda düşmez
  }
  return 'ok';
}

/** testler için: pin deposunu sıfırla */
export function resetDhUpdatePins(): void {
  try {
    localStorage.removeItem(STORE_KEY);
  } catch {
    // yoksay
  }
}

// gönderici tarafı: payload = b64(encodeDhUpdate(channel, version, pub) ‖ Ed25519 imza)
export function encodeDhUpdatePayload(
  channelId: string,
  version: number,
  dhPub: Uint8Array,
  signPrivateKey: Uint8Array,
): string {
  const canonical = encodeDhUpdate(channelId, version, dhPub);
  const sig = sodium.crypto_sign_detached(canonical, signPrivateKey);
  const payload = new Uint8Array(canonical.length + sig.length);
  payload.set(canonical, 0);
  payload.set(sig, canonical.length);
  return b64(payload);
}
