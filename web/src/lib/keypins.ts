// TOFU (trust-on-first-use) pin store: remembers the first X25519 public key
// seen per user in localStorage so a malicious server swapping a key later is
// detectable. First-seen keys are stored automatically; a CHANGED key is never
// overwritten silently — the UI must call pinKey() only after the user
// explicitly accepts the new key.

const STORAGE_KEY = 'postacim.keypins.v1';

type PinMap = Record<string, string>; // userId -> base64 public key

function load(): PinMap {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as PinMap) : {};
  } catch {
    // corrupt JSON or blocked storage — degrade to "nothing pinned"
    return {};
  }
}

function save(pins: PinMap): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(pins));
  } catch {
    // private mode / quota exceeded — pinning silently degrades this session
  }
}

export type PinStatus = 'new' | 'same' | 'changed';

/** pure check — does not touch storage; 'changed' means pinned key differs */
export function checkPin(userId: string, publicKeyB64: string): PinStatus {
  const pinned = load()[userId];
  if (pinned === undefined) return 'new';
  return pinned === publicKeyB64 ? 'same' : 'changed';
}

/** store/overwrite a pin. For a 'changed' key, call only after explicit user consent. */
export function pinKey(userId: string, publicKeyB64: string): void {
  const pins = load();
  pins[userId] = publicKeyB64;
  save(pins);
}

/** TOFU helper for list rendering: auto-pins first sighting, flags changes */
export function ensurePinned(userId: string, publicKeyB64: string): PinStatus {
  const status = checkPin(userId, publicKeyB64);
  if (status === 'new') pinKey(userId, publicKeyB64);
  return status;
}
