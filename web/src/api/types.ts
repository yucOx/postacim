export interface AuthedUser {
  id: string;
  nick: string;
  public_key: string;
  key_blob: string;
}

export interface BootstrapCommunity {
  id: string;
  name: string;
  role: 'owner' | 'member';
  members: { id: string; nick: string; role: 'owner' | 'member' }[];
  channels: {
    id: string;
    name: string;
    type: 'text' | 'voice';
    key_version: number;
    my_wrapped_key: string | null;
  }[];
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
}

export interface VoiceTokenResponse {
  url: string;
  token: string;
}
