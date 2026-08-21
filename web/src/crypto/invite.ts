import { sodium } from './sodium';
import { b64, unb64 } from './bytes';

const b64url = (u8: Uint8Array): string =>
  b64(u8).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64url = (s: string): Uint8Array => {
  let t = s.replace(/-/g, '+').replace(/_/g, '/');
  while (t.length % 4) t += '=';
  return unb64(t);
};

/** Open invite: link carries the ephemeral private half (fragment — never sent to server) */
export function buildInviteLink(code: string, ephPriv?: Uint8Array): string {
  const base = `${location.origin}${location.pathname}#/davet/${code}`;
  return ephPriv ? `${base}/${b64url(ephPriv)}` : base;
}

export interface ParsedInvite {
  code: string;
  ephPriv: Uint8Array | null;
}

export function parseInviteLink(link: string): ParsedInvite | null {
  const m = link
    .trim()
    .match(/#\/davet\/([A-Za-z0-9]+)(?:\/([A-Za-z0-9_-]+))?/);
  if (!m) return null;
  return { code: m[1]!, ephPriv: m[2] ? unb64url(m[2]) : null };
}

/** Sealed boxes were sealed to the ephemeral pub; derive pub from priv to open. */
export function unsealWithEphemeral(sealedKeyB64: string, ephPriv: Uint8Array): Uint8Array {
  const ephPub = sodium.crypto_scalarmult_base(ephPriv);
  return sodium.crypto_box_seal_open(unb64(sealedKeyB64), ephPub, ephPriv);
}
