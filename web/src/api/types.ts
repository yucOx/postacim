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
  key_version: number;
  nonce: string;
  ciphertext: string;
  sent_at: number;
  /** client-generated AAD binding (replay hardening); null on legacy rows */
  client_id?: string | null;
  sent_at_client?: number | null;
}

export interface VoiceTokenResponse {
  url: string;
  token: string;
}
