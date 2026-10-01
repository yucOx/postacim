import { useEffect, useState } from 'react';
import { useT } from '../i18n/I18nProvider';
import { fetchCommunityAvatar } from '../lib/avatar';
import { nickColor } from '../lib/format';

interface Props {
  communityId: string;
  name: string;
  /** avatar_updated_at — 0/null: fotoğraf yok (baş harfler düşer) */
  version: number | null | undefined;
  size?: number;
  rounded?: string;
  className?: string;
}

/** Topluluk profil fotoğrafı: varsa resim, yoksa adın ilk iki harfi renkli
 *  zeminde (ServerRail'deki eski baş harf döşemesiyle aynı görünüm).
 *  version cache anahtarı — sunucudaki yeni damga otomatik taze çeker. */
export default function CommunityAvatar({
  communityId,
  name,
  version,
  size = 40,
  rounded = 'rounded-md',
  className = '',
}: Props): React.ReactNode {
  const { t } = useT();
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    setSrc(null);
    if (version) {
      void fetchCommunityAvatar(communityId, version).then((url) => {
        if (!cancelled) setSrc(url);
      });
    }
    return () => {
      cancelled = true;
    };
  }, [communityId, version]);

  const dim = `${size}px`;
  if (src) {
    return (
      <img
        src={src}
        alt={t('community.avatarAlt', { name })}
        width={size}
        height={size}
        className={`shrink-0 object-cover ${rounded} ${className}`}
        style={{ width: dim, height: dim }}
      />
    );
  }
  return (
    <span
      className={`flex shrink-0 items-center justify-center font-display font-bold uppercase tracking-wide ${rounded} ${className}`}
      style={{
        width: dim,
        height: dim,
        color: nickColor(name),
        fontSize: Math.round(size * 0.34),
      }}
      aria-hidden
    >
      {name.slice(0, 2).toLocaleUpperCase('tr-TR')}
    </span>
  );
}
