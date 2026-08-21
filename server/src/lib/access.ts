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
  /** 1 = a member was removed and the channel awaits a rekey before it can be
   *  written to or handed out again (the removed user still holds the raw key) */
  needs_rekey: number;
}

export type Role = 'owner' | 'admin' | 'member';

/** any channel of the community still awaiting a rekey? */
export function communityNeedsRekey(communityId: string): boolean {
  return !!db.prepare('SELECT 1 FROM channels WHERE community_id = ? AND needs_rekey = 1').get(communityId);
}

export function memberRole(communityId: string, userId: string): Role | null {
  const row = db
    .prepare('SELECT role FROM members WHERE community_id = ? AND user_id = ?')
    .get(communityId, userId) as { role: Role } | undefined;
  return row?.role ?? null;
}

/** owner or admin — the two roles allowed to manage members/invites */
export const isStaff = (role: Role | null): boolean => role === 'owner' || role === 'admin';

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
  role: Role;
  public_key: string;
}[] {
  return db
    .prepare(
      `SELECT u.id, u.nick, m.role, u.public_key
       FROM members m JOIN users u ON u.id = m.user_id
       WHERE m.community_id = ? ORDER BY m.joined_at`,
    )
    .all(communityId) as { id: string; nick: string; role: Role; public_key: string }[];
}
