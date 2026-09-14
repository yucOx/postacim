import { useEffect, useState } from 'react';
import { useT } from '../i18n/I18nProvider';
import { fetchAvatar } from '../lib/avatar';
import { nickColor } from '../lib/format';

interface Props {
  userId: string;
  label: string;
  size?: number;
  className?: string;
  // when provided, the avatar is rendered immediately (e.g. for "me").
  // otherwise it's lazy-fetched from /api/users/:id/avatar.
  srcOverride?: string | null;
}

/** Tiny user avatar: image if available, otherwise the first letter on a
 *  hashed-color tile. Lazy-fetches the image for users other than the current. */
export default function Avatar({ userId, label, size = 32, className = '', srcOverride }: Props): React.ReactNode {
  const { t } = useT();
  const [src, setSrc] = useState<string | null>(srcOverride ?? null);
  useEffect(() => {
    if (srcOverride !== undefined) {
      setSrc(srcOverride);
      return;
    }
    let cancelled = false;
    void fetchAvatar(userId).then((url) => {
      if (!cancelled) setSrc(url);
    });
    return () => {
      cancelled = true;
    };
  }, [userId, srcOverride]);

  const dim = `${size}px`;
  if (src) {
    return (
      <img
        src={src}
        alt={t('avatar.avatar')}
        width={size}
        height={size}
        className={`shrink-0 rounded-sm border border-brass-700/40 object-cover ${className}`}
        style={{ width: dim, height: dim }}
      />
    );
  }
  return (
    <div
      className={`flex shrink-0 items-center justify-center rounded-sm border border-brass-700/40 bg-night-800 font-display font-bold ${className}`}
      style={{ width: dim, height: dim, color: nickColor(label), fontSize: Math.round(size * 0.45) }}
      aria-label={t('avatar.avatar')}
    >
      {label[0]?.toLocaleUpperCase('tr-TR')}
    </div>
  );
}
