import type { WebSocket } from 'ws';
import { db } from '../db.js';

export interface HubClient {
  userId: string;
  nick: string;
  communities: Set<string>;
  alive: boolean;
}

// community -> channel -> userId -> nick; in-memory, rebuilt from live sockets.
// LiveKit stays the source of truth for actual call state; this drives sidebar UI.
type VoiceMap = Map<string, Map<string, Map<string, string>>>;

class Hub {
  private clients = new Map<WebSocket, HubClient>();
  private voice: VoiceMap = new Map();

  register(ws: WebSocket, user: { id: string; nick: string }): void {
    const communities = new Set(
      (
        db.prepare('SELECT community_id FROM members WHERE user_id = ?').all(user.id) as {
          community_id: string;
        }[]
      ).map((r) => r.community_id),
    );
    this.clients.set(ws, { userId: user.id, nick: user.nick, communities, alive: true });
  }

  unregister(ws: WebSocket): void {
    const client = this.clients.get(ws);
    this.clients.delete(ws);
    if (!client) return;
    // drop the user's voice presence entries; each affected channel broadcasts
    for (const [communityId, byChannel] of this.voice) {
      for (const [channelId, users] of byChannel) {
        if (users.delete(client.userId)) {
          this.broadcastVoice(communityId, channelId);
        }
      }
    }
  }

  markAlive(ws: WebSocket): void {
    const c = this.clients.get(ws);
    if (c) c.alive = true;
  }

  sweep(): WebSocket[] {
    const dead: WebSocket[] = [];
    for (const [ws] of this.clients) {
      const c = this.clients.get(ws)!;
      if (!c.alive) dead.push(ws);
      else {
        c.alive = false;
        ws.ping();
      }
    }
    for (const ws of dead) ws.terminate();
    return dead;
  }

  joinCommunity(userId: string, communityId: string): void {
    for (const c of this.clients.values()) {
      if (c.userId === userId) c.communities.add(communityId);
    }
  }

  leaveCommunity(userId: string, communityId: string): void {
    for (const c of this.clients.values()) {
      if (c.userId === userId) c.communities.delete(communityId);
    }
  }

  broadcast(communityId: string, payload: unknown): void {
    const data = JSON.stringify(payload);
    for (const [ws, c] of this.clients) {
      if (c.communities.has(communityId) && ws.readyState === ws.OPEN) ws.send(data);
    }
  }

  setVoice(userId: string, nick: string, communityId: string, channelId: string, joined: boolean): void {
    let byChannel = this.voice.get(communityId);
    if (!byChannel) {
      byChannel = new Map();
      this.voice.set(communityId, byChannel);
    }
    let users = byChannel.get(channelId);
    if (!users) {
      users = new Map();
      byChannel.set(channelId, users);
    }
    if (joined) users.set(userId, nick);
    else users.delete(userId);
    if (users.size === 0) byChannel.delete(channelId);
    if (byChannel.size === 0) this.voice.delete(communityId);
    this.broadcastVoice(communityId, channelId);
  }

  private broadcastVoice(communityId: string, channelId: string): void {
    const users = this.voice.get(communityId)?.get(channelId);
    const participants = users
      ? Array.from(users.entries()).map(([user_id, nick]) => ({ user_id, nick }))
      : [];
    this.broadcast(communityId, {
      type: 'voice:update',
      community_id: communityId,
      channel_id: channelId,
      participants,
    });
  }
}

export const hub = new Hub();
