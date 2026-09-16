// Shared validation — kept in one place so client and server rules never drift.
export const NICK_REGEX = /^[a-zA-Z0-9_.-]{3,24}$/;

// base64 (standard alphabet) string of at most `maxBytes` decoded bytes
const b64Schema = (minLen: number, maxLen: number) => ({
  type: 'string',
  minLength: minLen,
  maxLength: maxLen,
  pattern: '^[A-Za-z0-9+/]+={0,2}$',
});

export const registerSchema = {
  type: 'object',
  required: ['nick', 'kdf_salt', 'auth_material', 'public_key', 'key_blob'],
  additionalProperties: false,
  properties: {
    nick: { type: 'string', pattern: NICK_REGEX.source },
    kdf_salt: { type: 'string', minLength: 32, maxLength: 32, pattern: '^[0-9a-f]{32}$' },
    auth_material: b64Schema(44, 44),
    public_key: b64Schema(44, 44),
    // Ed25519 imza anahtarı (gönderen atfı) — bu özellikten önceki istemciler
    // göndermez; sonradan POST /keys/sign ile yayınlanır
    sign_public_key: { type: 'string', minLength: 44, maxLength: 44 },
    key_blob: b64Schema(48, 1024),
    // optional: required only when the server has TURNSTILE_SECRET (enforced in
    // the route — schemas can't express "required iff env")
    turnstile_token: { type: 'string', minLength: 1, maxLength: 2048 },
    recovery: {
      type: 'object',
      required: ['kdf_salt', 'auth_material', 'blob'],
      additionalProperties: false,
      properties: {
        kdf_salt: { type: 'string', minLength: 32, maxLength: 32, pattern: '^[0-9a-f]{32}$' },
        auth_material: b64Schema(44, 44),
        blob: b64Schema(48, 1024),
      },
    },
  },
} as const;

export const loginSchema = {
  type: 'object',
  required: ['nick', 'auth_material'],
  additionalProperties: false,
  properties: {
    nick: { type: 'string', minLength: 3, maxLength: 24 },
    auth_material: b64Schema(44, 44),
    turnstile_token: { type: 'string', minLength: 1, maxLength: 2048 },
  },
} as const;
