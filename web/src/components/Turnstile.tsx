// Optional Cloudflare Turnstile human check for register/login.
// Self-contained: when the build has VITE_TURNSTILE_SITEKEY the api.js is
// injected lazily and the widget renders; without it, nothing is rendered and
// no third-party code loads (self-hosted/LAN builds stay dependency-free —
// nginx CSP already allows the origin for the day it's turned on).
//
// PM integration (Login.tsx):
//   const [tsToken, setTsToken] = useState<string | null>(null);
//   {turnstileEnabled() && <Turnstile onToken={setTsToken} />}
//   ...disabled={turnstileEnabled() && !tsToken} on submit
//   ...include tsToken as turnstile_token in the register/login body.
import { useEffect, useRef } from 'react';
import { useT } from '../i18n/I18nProvider';

const SITEKEY = (import.meta.env.VITE_TURNSTILE_SITEKEY as string | undefined) ?? '';
const API_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js';

/** true when this build carries a sitekey — callers branch on this to render
 *  the widget and hold submits until a token arrives */
export function turnstileEnabled(): boolean {
  return SITEKEY !== '';
}

// the slice of the widget API we use; loaded once per page
interface TurnstileApi {
  render: (el: HTMLElement, params: Record<string, unknown>) => string;
  reset: (widgetId?: string) => void;
  remove: (widgetId: string) => void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

// module-level memo: multiple mounts (React 18 strict mode double-invokes
// effects in dev) must not inject the script twice
let apiPromise: Promise<TurnstileApi> | null = null;
function loadTurnstileApi(errNoApi: string, errLoad: string): Promise<TurnstileApi> {
  apiPromise ??= new Promise<TurnstileApi>((resolve, reject) => {
    if (window.turnstile) return resolve(window.turnstile);
    const script = document.createElement('script');
    script.src = API_SRC;
    script.async = true;
    script.onload = () =>
      window.turnstile
        ? resolve(window.turnstile)
        : reject(new Error(errNoApi));
    script.onerror = () => {
      apiPromise = null; // allow a retry on the next mount
      reject(new Error(errLoad));
    };
    document.head.appendChild(script);
  });
  return apiPromise;
}

interface TurnstileProps {
  /** fresh token after solve; null after expiry, error or load failure —
   *  treat null as "no token yet" and hold the submit */
  onToken: (token: string | null) => void;
}

export default function Turnstile({ onToken }: TurnstileProps) {
  const { t } = useT();
  const containerRef = useRef<HTMLDivElement>(null);
  const onTokenRef = useRef(onToken);

  // keep the latest callback without re-rendering (and re-challenging) the widget
  useEffect(() => {
    onTokenRef.current = onToken;
  });

  useEffect(() => {
    if (SITEKEY === '') return;
    let widgetId: string | null = null;
    let cancelled = false;
    loadTurnstileApi(t('turnstile.loadNoApi'), t('turnstile.loadFail'))
      .then((ts) => {
        if (cancelled || !containerRef.current) return;
        widgetId = ts.render(containerRef.current, {
          sitekey: SITEKEY,
          callback: (token: string) => onTokenRef.current(token),
          'expired-callback': () => {
            onTokenRef.current(null);
            ts.reset(widgetId ?? undefined); // fresh challenge for the next submit
          },
          'error-callback': () => onTokenRef.current(null),
        });
      })
      .catch(() => onTokenRef.current(null));
    return () => {
      cancelled = true;
      if (widgetId !== null && window.turnstile) {
        try {
          window.turnstile.remove(widgetId);
        } catch {
          // widget already torn down (e.g. container unmounted mid-load)
        }
      }
    };
  }, []);

  if (SITEKEY === '') return null;
  return <div ref={containerRef} />;
}
