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

interface DmCallRow {
  channelId: string;
  userA: string;
  userB: string;
}

// === 2 vCPU/3 GB optimizasyonu (docs/NETWORKING.md) ===
// 50 kişilik odada birisi mesaj yazınca 49 send() syscall = context
// switch. 16 ms tick penceresinde topla → 1 send (frame + merge) ≈ %30
// daha az CPU. Tradeoff: oyuncu hissi hassas olan oyun oynamıyoruz,
// 16 ms fark edilmez; mesaj 1-2 frame kayıyor (Discord/Slack benzeri).
const BROADCAST_TICK_MS = 16;

class Hub {
  private clients = new Map<WebSocket, HubClient>();
  private voice: VoiceMap = new Map();
  // active 1:1 DM calls keyed by dm channel id; mirrors voice above but for DMs.
  // needed so a peer dropping their socket cleanly notifies the other side.
  private dmCalls = new Map<string, DmCallRow>();
  // outgoing frame queue, deduped by ws → JSON string. Cleared each tick.
  private outboundFrames = new Map<WebSocket, string>();
  private batcher: NodeJS.Timeout | null = null;

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
    // a DM-call peer just dropped — end the call for the other side too
    this.endDmCallFor(client.userId, 'peer_disconnected');
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
      if (c.communities.has(communityId) && ws.readyState === ws.OPEN) this.enqueue(ws, data);
    }
  }

  /** to every socket of one user regardless of room membership */
  sendToUser(userId: string, payload: unknown): void {
    this.sendToUsers([userId], payload);
  }

  sendToUsers(userIds: string[], payload: unknown): void {
    const set = new Set(userIds);
    const data = JSON.stringify(payload);
    for (const [ws, c] of this.clients) {
      if (set.has(c.userId) && ws.readyState === ws.OPEN) this.enqueue(ws, data);
    }
  }

  /** Dedup + batch: aynı frame string'i aynı socket'te 1 kere tutulur;
   *  flush BROADCAST_TICK_MS tick'inde olur. İlk enqueue setTimeout kurar,
   *  sonrakiler noop — son aktiviteden 16 ms sonra trailing flush. */
  private enqueue(ws: WebSocket, data: string): void {
    this.outboundFrames.set(ws, data);
    if (this.batcher) return;
    this.batcher = setTimeout(() => this.flush(), BROADCAST_TICK_MS);
  }

  private flush(): void {
    this.batcher = null;
    for (const [ws, data] of this.outboundFrames) {
      if (ws.readyState === ws.OPEN) ws.send(data);
    }
    this.outboundFrames.clear();
  }

  /** mark a DM call as active between two users. notify the other side when one drops. */
  addDmCall(channelId: string, userA: string, userB: string): void {
    this.dmCalls.set(channelId, { channelId, userA, userB });
  }

  /** user is leaving the call (or just disconnected) — end it for the peer too. */
  endDmCallFor(userId: string, reason: string): void {
    for (const [channelId, call] of this.dmCalls) {
      if (call.userA !== userId && call.userB !== userId) continue;
      const peer = call.userA === userId ? call.userB : call.userA;
      this.sendToUser(peer, { type: 'call:ended', channel_id: channelId, reason });
      this.dmCalls.delete(channelId);
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

  // --- /api/stats sayaçları (kapasite takibi) ---
  openSockets(): number {
    return this.clients.size;
  }

  voicePeers(): number {
    let n = 0;
    for (const byChannel of this.voice.values()) for (const users of byChannel.values()) n += users.size;
    return n;
  }

  dmCallCount(): number {
    return this.dmCalls.size;
  }
}

export const hub = new Hub();
