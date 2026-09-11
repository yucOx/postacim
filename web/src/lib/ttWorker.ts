// CSP `require-trusted-types-for 'script'` makes the Worker constructor reject
// plain string/URL arguments — it demands a TrustedScriptURL. livekit's
// E2EEWorker passes a raw blob: URL, so every voice-room join died with
// "Failed to construct 'Worker': This document requires 'TrustedScriptURL'
// assignment". This module must be imported BEFORE any livekit module loads:
// it replaces window.Worker with a subclass that launders the URL through a
// policy named for exactly this purpose. DOM XSS sinks (innerHTML, eval…)
// stay rejected — the policy only ever sees Worker URLs, which CSP still
// pins to worker-src 'self' blob:.

// TrustedTypes ships behind a Chrome-only API — this TS version's DOM lib has
// no typings for it, so declare the sliver we use.
declare global {
  interface TrustedTypePolicyFactory {
    createPolicy(name: string, rules: { createScriptURL: (s: string) => unknown }): {
      createScriptURL: (s: string) => unknown;
    };
  }
  var trustedTypes: TrustedTypePolicyFactory | undefined;
}

if (typeof window !== 'undefined' && typeof trustedTypes !== 'undefined') {
  const policy = trustedTypes.createPolicy('e2ee-worker', { createScriptURL: (s: string) => s });
  const OrigWorker = window.Worker;
  class TrustedWorker extends OrigWorker {
    constructor(url: string | URL, options?: WorkerOptions) {
      super(policy.createScriptURL(String(url)) as unknown as string, options);
    }
  }
  window.Worker = TrustedWorker as unknown as typeof Worker;
}

export {};