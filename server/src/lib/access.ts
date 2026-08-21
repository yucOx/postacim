import { db } from '../db.js';

export interface CommunityRow {
  id: string;
  name: string;
  owner_id: string;
}

export interface ChannelRow {
  id: string;
  community_id: string;
  name: string;
  type: 'text' | 'voice';
  key_version: number;
}

export function memberRole(communityId: string, userId: string): 'owner' | 'member' | null {
  const row = db
    .prepare('SELECT role FROM members WHERE community_id = ? AND user_id = ?')
    .get(communityId, userId) as { role: 'owner' | 'member' } | undefined;
  return row?.role ?? null;
}

export function getCommunity(id: string): CommunityRow | undefined {
  return db.prepare('SELECT * FROM communities WHERE id = ?').get(id) as CommunityRow | undefined;
}

export function getChannel(id: string): ChannelRow | undefined {
  return db.prepare('SELECT * FROM channels WHERE id = ?').get(id) as ChannelRow | undefined;
}

export function communityChannels(communityId: string): ChannelRow[] {
  return db
    .prepare('SELECT * FROM channels WHERE community_id = ? ORDER BY created_at')
    .all(communityId) as ChannelRow[];
}

export function communityMembers(communityId: string): {
  id: string;
  nick: string;
  role: 'owner' | 'member';
  public_key: string;
}[] {
  return db
    .prepare(
      `SELECT u.id, u.nick, m.role, u.public_key
       FROM members m JOIN users u ON u.id = m.user_id
       WHERE m.community_id = ? ORDER BY m.joined_at`,
    )
    .all(communityId) as { id: string; nick: string; role: 'owner' | 'member'; public_key: string }[];
}
