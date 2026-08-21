// Pure reconnect-delay math, extracted so it can be tested: exponential
// growth from 500ms, capped at 30s, ±20% jitter so a fleet of reconnecting
// clients does not stampede the server in lockstep.
const BASE_MS = 500;
const MAX_MS = 30_000;

export function nextDelay(attempt: number): number {
  const raw = Math.min(BASE_MS * 2 ** attempt, MAX_MS);
  const jitter = raw * (0.8 + Math.random() * 0.4);
  return Math.round(jitter);
}
