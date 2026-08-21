import _sodium from 'libsodium-wrappers-sumo';

/** Resolves when libsodium WASM is loaded. Await before any sodium call. */
export const sodiumReady: Promise<void> = _sodium.ready;
export const sodium = _sodium;
