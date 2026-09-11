// channel-internal replay defence: a malicious server can re-inject a captured
// ciphertext as a "new" message (fresh row id), so the client dedupes on the
// client-generated id that is bound into the AAD instead of the row id.
export class ReplayFilter {
  private seen = new Map<string, Set<string>>();

  /** records the id; returns true when it was already observed on this channel */
  check(channelId: string, clientId: string): boolean {
    let set = this.seen.get(channelId);
    if (!set) {
      set = new Set();
      this.seen.set(channelId, set);
    }
    if (set.has(clientId)) return true;
    set.add(clientId);
    return false;
  }

  /** a full history reload replaces the whole list — drop stale state so
   * re-served history is not mistaken for injected duplicates */
  reset(channelId: string): void {
    this.seen.delete(channelId);
  }
}
