export interface ServerEvent {
  type: string;
  [key: string]: unknown;
}

type Handler = (e: ServerEvent) => void;

let ws: WebSocket | null = null;
let token: string | null = null;
let stopped = true;
let backoffMs = 500;
const handlers = new Set<Handler>();

function open(): void {
  if (!token) return;
  const url = (import.meta.env.VITE_WS_URL as string | undefined) ?? `ws://${location.host}/ws`;
  ws = new WebSocket(url);
  ws.onopen = () => {
    ws!.send(JSON.stringify({ type: 'auth', token }));
    backoffMs = 500;
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
    if (stopped) return;
    setTimeout(open, backoffMs);
    backoffMs = Math.min(backoffMs * 2, 15_000);
  };
  ws.onerror = () => ws?.close();
}

export function wsConnect(t: string): void {
  token = t;
  stopped = false;
  open();
}

export function wsDisconnect(): void {
  stopped = true;
  ws?.close();
  ws = null;
}

export function wsSend(obj: unknown): void {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
}

export function onServerEvent(h: Handler): () => void {
  handlers.add(h);
  return () => handlers.delete(h);
}
