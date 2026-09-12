// Reaction list helpers — pure functions shared by chatStore and dmChatStore.
// A message's reactions are the grouped form the server sends:
// [{emoji, count, me}] — kept sorted by insertion, me flags are mine only.

export interface Reaction {
  emoji: string;
  count: number;
  me: boolean;
}

/** the quick-pick set offered in the hover toolbar */
export const QUICK_EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🎉'] as const;

/** apply a WS reaction:update from another user (own events are skipped —
 *  the toggle already applied them optimistically) */
export function applyRemote(list: Reaction[], emoji: string, action: 'add' | 'remove'): Reaction[] {
  const entry = list.find((r) => r.emoji === emoji);
  if (action === 'add') {
    if (!entry) return [...list, { emoji, count: 1, me: false }];
    return list.map((r) => (r.emoji === emoji ? { ...r, count: r.count + 1 } : r));
  }
  if (!entry) return list;
  const next = list
    .map((r) => (r.emoji === emoji ? { ...r, count: r.count - 1 } : r))
    .filter((r) => r.count > 0);
  return next;
}

/** optimistic own toggle: on → off, off → on */
export function toggleMine(list: Reaction[], emoji: string): Reaction[] {
  const entry = list.find((r) => r.emoji === emoji);
  if (entry?.me) {
    return list
      .map((r) => (r.emoji === emoji ? { ...r, count: r.count - 1, me: false } : r))
      .filter((r) => r.count > 0);
  }
  if (entry) return list.map((r) => (r.emoji === emoji ? { ...r, count: r.count + 1, me: true } : r));
  return [...list, { emoji, count: 1, me: true }];
}

/** replace one message's reactions inside a channel list (no-op when absent) */
export function withReactions<T extends { id: number; reactions: Reaction[] }>(
  list: T[],
  messageId: number,
  next: Reaction[],
): T[] {
  if (!list.some((m) => m.id === messageId)) return list;
  return list.map((m) => (m.id === messageId ? { ...m, reactions: next } : m));
}