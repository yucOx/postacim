import { nextDelay } from './backoff';

export interface ServerEvent {
  type: string;
  [key: string]: unknown;
}

type Handler = (e: ServerEvent) => void;
export type WsStatus = 'connecting' | 'open' | 'offline';

let ws: WebSocket | null = null;
let stopped = true;
let backoffMs = 500;
let retry = 0;
const handlers = new Set<Handler>();
const statusHandlers = new Set<(s: WsStatus) => void>();
let status: WsStatus = 'offline';

const setStatus = (s: WsStatus): void => {
  status = s;
  statusHandlers.forEach((h) => h(s));
};

export const wsStatus = (): WsStatus => status;
export function onWsStatus(h: (s: WsStatus) => void): () => void {
  h(status);
  statusHandlers.add(h);
  return () => statusHandlers.delete(h);
}

function scheduleReconnect(): void {
  if (stopped) return;
  // retries forever; the UI shows an offline badge so the user is never left guessing
  const delay = nextDelay(retry);
  backoffMs = Math.min(backoffMs * 2, 30_000);
  retry++;
  setTimeout(() => {
    if (!stopped) open();
  }, delay);
}

function open(): void {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const url = (import.meta.env.VITE_WS_URL as string | undefined) ?? `${proto}://${location.host}/ws`;
  setStatus('connecting');
  try {
    ws = new WebSocket(url);
  } catch {
    scheduleReconnect();
    return;
  }
  ws.onopen = () => {
    // auth frame without a token: the server falls back to the session cookie
    // carried on the upgrade request
    ws!.send(JSON.stringify({ type: 'auth' }));
    backoffMs = 500;
    retry = 0;
    setStatus('open');
  };
  ws.onmessage = (ev) => {
    try {
      const e = JSON.parse(ev.data as string) as ServerEvent;
      handlers.forEach((h) => h(e));
    } catch {
      // ignore malformed frames
    }
  };
  ws.onclose = () => {
    setStatus('offline');
    scheduleReconnect();
  };
  ws.onerror = () => ws?.close();
}

export function wsConnect(): void {
  if (!stopped) return;
  stopped = false;
  backoffMs = 500;
  open();
}

export function wsDisconnect(): void {
  stopped = true;
  ws?.close();
  ws = null;
  setStatus('offline');
}

export function wsSend(obj: unknown): void {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
}

export function onServerEvent(h: Handler): () => void {
  handlers.add(h);
  return () => handlers.delete(h);
}
