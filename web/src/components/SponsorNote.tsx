import { useT } from '../i18n/I18nProvider';

// sponsorship credit: yuxor.dev sponsors the project, yubra.tech builds it.
// Text-only — the CSP allows no third-party images by design.
export function SponsorNote(): React.ReactNode {
  const { t } = useT();
  return (
    <p className="text-center text-[11px] text-paper-500">
      <a
        href="https://yuxor.dev"
        target="_blank"
        rel="noopener noreferrer"
        className="transition-colors hover:text-paper-100 underline decoration-brass-700 underline-offset-2"
      >
        yuxor.dev
      </a>{' '}
      {t('sponsor.text', { a: 'yuxor.dev', b: 'yubra.tech' })}
    </p>
  );
}