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

// Mobil tarayıcılar arka plana geçince presence WS'ini kapatır (OS radyo
// yönetimi / iOS ~30 sn) — ama LiveKit medya hattı (WebRTC + istemci
// keepalive) canlı kalabilir: ses odada akar, sidebar'da kullanıcı yok
// görünürdu. Discord gibi: WS düşünce kullanıcı anında düşürülmez; grace
// içinde geri bağlanırsa presence hiç sarsılmaz, gelmezse gerçek ayrılma
// (presence temizliği + DM aramasına call:ended) işlenir.
const VOICE_GRACE_MS = 120_000;

class Hub {
  private clients = new Map<WebSocket, HubClient>();
  private voice: VoiceMap = new Map();
  // active 1:1 DM calls keyed by dm channel id; mirrors voice above but for DMs.
  // needed so a peer dropping their socket cleanly notifies the other side.
  private dmCalls = new Map<string, DmCallRow>();
  // DM call PRESENCE (Discord green-ring): LiveKit odasına bağlı kullanıcı
  // kendini duyurur; peer "X aramada — katıl" göstergesi için. dmCalls'tan
  // farkı: bir taraf cancel etse de odada kalan duyuruyu sürdürür.
  private dmVoice = new Map<string, { channelId: string; peerId: string }>(); // userId ->
  // outgoing frame queues: ws → frames pending this tick. Set keeps insertion
  // order and drops true duplicates (same payload twice) WITHOUT losing
  // distinct events — a Map<ws, string> would let the last event overwrite
  // earlier ones sent in the same 16 ms window (message loss, caught by
  // reactions.test.ts: rapid add→remove delivered only "remove").
  private outboundFrames = new Map<WebSocket, Set<string>>();
  private batcher: NodeJS.Timeout | null = null;
  // userId -> pending leave grace timer (socket closed, waiting for reconnect)
  private leaveGraces = new Map<string, NodeJS.Timeout>();

  register(ws: WebSocket, user: { id: string; nick: string }): void {
    const communities = new Set(
      (
        db.prepare('SELECT community_id FROM members WHERE user_id = ?').all(user.id) as {
          community_id: string;
        }[]
      ).map((r) => r.community_id),
    );
    this.clients.set(ws, { userId: user.id, nick: user.nick, communities, alive: true });
    // the user reconnected inside the grace window — presence never dropped,
    // cancel the pending real-leave
    const grace = this.leaveGraces.get(user.id);
    if (grace) {
      clearTimeout(grace);
      this.leaveGraces.delete(user.id);
    }
    // F5 / yeni oturum: peers'ın şu anki DM arama presence'ını gönder ki
    // "X aramada" göstergesi kaybolmasın
    this.sendDmVoiceSnapshotTo(user.id);
  }

  unregister(ws: WebSocket): void {
    const client = this.clients.get(ws);
    this.clients.delete(ws);
    if (!client) return;
    // the user still has another open socket (multi-tab) — nothing to do
    for (const c of this.clients.values()) {
      if (c.userId === client.userId) return;
    }
    if (this.leaveGraces.has(client.userId)) return; // already waiting
    const userId = client.userId;
    const t = setTimeout(() => {
      this.leaveGraces.delete(userId);
      // grace expired — bail if a new socket appeared meanwhile
      for (const c of this.clients.values()) {
        if (c.userId === userId) return;
      }
      // drop the user's voice presence entries; each affected channel broadcasts
      this.dropVoiceFor(userId);
      // a DM-call peer never came back — end the call for the other side too
      this.endDmCallFor(userId, 'peer_disconnected');
      // DM presence de bitti — peer'daki "X aramada" göstergesi insin
      this.dropDmVoiceFor(userId);
    }, VOICE_GRACE_MS);
    // never keep the process alive just for a grace timer (tests, shutdown)
    t.unref?.();
    this.leaveGraces.set(userId, t);
  }

  private dropVoiceFor(userId: string): void {
    for (const [communityId, byChannel] of this.voice) {
      for (const [channelId, users] of byChannel) {
        if (users.delete(userId)) {
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

  /** Dedup + batch: identical frame strings on the same socket collapse; every
   *  distinct frame is kept in order and flushed on the BROADCAST_TICK_MS tick.
   *  First enqueue schedules the timer; later ones just queue (trailing flush
   *  ~16 ms after first activity). */
  private enqueue(ws: WebSocket, data: string): void {
    let frames = this.outboundFrames.get(ws);
    if (!frames) {
      frames = new Set();
      this.outboundFrames.set(ws, frames);
    }
    frames.add(data);
    if (this.batcher) return;
    this.batcher = setTimeout(() => this.flush(), BROADCAST_TICK_MS);
  }

  private flush(): void {
    this.batcher = null;
    for (const [ws, frames] of this.outboundFrames) {
      if (ws.readyState === ws.OPEN) {
        for (const data of frames) ws.send(data);
      }
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

  /** DM arama presence duyurusu (odadayım / odadan çıktım). Bayat "kapama"
   *  mesajları (sonraki bir aramadan kalan) yok sayılır. */
  setDmVoice(userId: string, channelId: string, peerId: string, on: boolean): void {
    const cur = this.dmVoice.get(userId);
    if (on) {
      this.dmVoice.set(userId, { channelId, peerId });
    } else {
      if (!cur || cur.channelId !== channelId) return;
      this.dmVoice.delete(userId);
    }
    this.sendToUser(peerId, { type: 'dm:voice', channel_id: channelId, user_id: userId, in: on });
  }

  /** soket düştü + grace doldu — presence'ı kaldır, peer'a haber ver */
  private dropDmVoiceFor(userId: string): void {
    const cur = this.dmVoice.get(userId);
    if (!cur) return;
    this.dmVoice.delete(userId);
    this.sendToUser(cur.peerId, { type: 'dm:voice', channel_id: cur.channelId, user_id: userId, in: false });
  }

  /** register anlık görüntüsü: benim DM'lerimde hâlen aramada olan peers */
  private sendDmVoiceSnapshotTo(userId: string): void {
    for (const [uid, v] of this.dmVoice) {
      if (v.peerId === userId) {
        this.sendToUser(userId, { type: 'dm:voice', channel_id: v.channelId, user_id: uid, in: true });
      }
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
