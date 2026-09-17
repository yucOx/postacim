// Faz 6 — istemci-arası anahtar defteri head gossip (spec: docs/faz6-keygossip-design.md)
// Sunucu opak relay eder; çatışma çözümü alıcıdadır. CONIKS/Keybase modelinin
// basitleştirilmiş hali: tam kanıt zinciri yok, gözlemsel tespit var.
// 4 durum makinesi (saf fonksiyon) + periyodik yayın (5dk + JIT).
import { type KeyLogHead } from './keytransparency';
import { wsSend } from '../ws/socket';

export const GOSSIP_PERIOD_MS = 5 * 60_000; // 5 dakika — aktif kanallarda çatışma ~5dk içinde

/** WS → istemci yönü: gelen keylog_head frame'i (server eklediği 'from' ile) */
export interface IncomingKeylogHead {
  type: 'keylog_head';
  community_id?: string;
  id: number;
  hash: string;
  from: string;
}

export type GossipAction =
  /** aynı head → sessiz, hiçbir şey yapma */
  | { kind: 'silence' }
  /** biz gerideyiz → sessiz sync tetikle; sync sonucu bant eşlemesi yapacak */
  | { kind: 'sync'; remote: IncomingKeylogHead }
  /** aynı id farklı hash = fork kanıtı; bant tetikle */
  | { kind: 'fork' };

/**
 * Çatışma çözümü saf fonksiyonu. (myHead|null, remote) → aksiyon.
 * myHead null = biz hâlâ doğrulanmış head görmedik → sessiz (kendi
 * senkronumuzun sonucunu bekliyoruz, başkasının head'i ile yargı
> veremeyiz).
 */
export function classifyKeylogHead(
  myHead: KeyLogHead | null,
  remote: IncomingKeylogHead,
): GossipAction {
  if (!myHead) return { kind: 'silence' };
  if (myHead.id === remote.id) {
    if (myHead.entry_hash === remote.hash) return { kind: 'silence' };
    return { kind: 'fork' };
  }
  if (myHead.id < remote.id) return { kind: 'sync', remote };
  // myHead.id > remote.id: biz öndeyiz ama başka istemci geride ve farklı
  // bir head gözlemliyor — bu da fork kanıtıdır (gözlemci eski head'de
  // kalmış, sunucu ona farklı defter veriyor olabilir)
  return { kind: 'fork' };
}

// --- Periyodik yayın: periyot + JIT tetikleyici ---

let timer: ReturnType<typeof setInterval> | null = null;
let myUserId: string | null = null;
let myCommunities: () => string[] = () => [];

/** dışarıdan head'i getHead() ile çekecek callback — döngüsel bağımlılık
 *  için: store hazır olduğunda register edilir, biz tetikleyici olduğumuzda
 *  callback çağrılır */
let getHead: () => KeyLogHead | null = () => null;

export function registerGossipPublisher(opts: {
  userId: string;
  communities: () => string[];
  head: () => KeyLogHead | null;
}): void {
  myUserId = opts.userId;
  myCommunities = opts.communities;
  getHead = opts.head;
}

/** testler için: periyodik zamanlayıcıyı kur/iptal et. JIt tetikleyici
 *  ayrı — her `publishKeylogHead` çağrısı bir frame yollar. */
export function startGossipLoop(): void {
  if (timer) return;
  // ilk tick'i yarım periyot sonra — iki cihaz birbirine çok yakın
  // başlar başlamaz çatışma penceresi açılır
  setTimeout(publishKeylogHead, Math.floor(GOSSIP_PERIOD_MS / 2));
  timer = setInterval(publishKeylogHead, GOSSIP_PERIOD_MS);
}

export function stopGossipLoop(): void {
  if (timer) clearInterval(timer);
  timer = null;
}

/** bir kez head yayını. Head yoksa frame göndermez (gossip için bir
 *  şeyimiz yok). */
export function publishKeylogHead(): void {
  if (!myUserId) return;
  const head = getHead();
  if (!head) return;
  const communities = myCommunities();
  if (communities.length === 0) return;
  wsSend({ type: 'keylog_head', id: head.id, hash: head.entry_hash, communities });
}

/** gelen frame'in yapısal geçerliliği — sunucu da doğrular ama istemci
 *  de savunmacı kontrol yapar (server değişebilir, biz bağımsız kalırız) */
export function isValidIncomingHead(e: unknown): e is IncomingKeylogHead {
  if (e === null || typeof e !== 'object') return false;
  const o = e as Record<string, unknown>;
  return (
    o.type === 'keylog_head' &&
    typeof o.id === 'number' &&
    Number.isInteger(o.id) &&
    o.id >= 1 &&
    o.id <= 0x7fffffff &&
    typeof o.hash === 'string' &&
    /^[0-9a-f]{64}$/.test(o.hash) &&
    typeof o.from === 'string' &&
    o.from.length > 0 &&
    (o.community_id === undefined || typeof o.community_id === 'string')
  );
}
