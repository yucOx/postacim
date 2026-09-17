export interface AuthedUser {
  id: string;
  nick: string;
  public_key: string;
  key_blob: string;
  /** unix ms of the last avatar upload; null when none. drives cache busting */
  avatar_updated_at?: number | null;
}

export interface BootstrapCommunity {
  id: string;
  name: string;
  role: 'owner' | 'admin' | 'member';
  members: { id: string; nick: string; role: 'owner' | 'admin' | 'member' }[];
  channels: {
    id: string;
    name: string;
    type: 'text' | 'voice';
    key_version: number;
    /** frozen after a member removal until staff rotate the key */
    needs_rekey: boolean;
    my_wrapped_key: string | null;
  }[];
  pending_join_requests: number;
  has_join_password: boolean;
}

export interface ChatMessage {
  id: number;
  channel_id: string;
  sender_id: string;
  nick: string;
  /** gönderen kullanıcının Ed25519 imza public key (b64); sunucu users
   *  tablosundan çekip döner. Kendi mesajımız için RAM'de de var (KDF),
   *  ama yeni login sonrası RAM boşken server'dan gelen fallback
   *  çözer (Faz 1 hotfix). */
  sender_sign_key?: string | null;
  key_version: number;
  nonce: string;
  ciphertext: string;
  sent_at: number;
  /** client-generated AAD binding (replay hardening); null on legacy rows */
  client_id?: string | null;
  sent_at_client?: number | null;
  /** tombstone: deleted for everyone — server sends 1/0, nonce/ciphertext are null */
  deleted?: boolean | number;
  /** reply target (same channel); reply_nick = target sender's nick (plaintext metadata) */
  reply_to?: number | null;
  reply_nick?: string | null;
  /** kaybolan mesaj TTL'i (ms epoch); null = kapalı — sunucu metadata'sı, AAD dışı */
  expires_at?: number | null;
  /** grouped reactions as served by history GET; [] when none */
  reactions?: { emoji: string; count: number; me: boolean }[];
}

export interface VoiceTokenResponse {
  url: string;
  token: string;
}
