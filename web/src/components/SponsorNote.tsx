// sponsorship credit: yuxor.dev sponsors the project, yubra.tech builds it.
// Text-only — the CSP allows no third-party images by design.
export function SponsorNote(): React.ReactNode {
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
      sponsorluğunda ·{' '}
      <a
        href="https://yubra.tech"
        target="_blank"
        rel="noopener noreferrer"
        className="transition-colors hover:text-paper-100 underline decoration-brass-700 underline-offset-2"
      >
        yubra.tech
      </a>{' '}
      ile geliştirildi
    </p>
  );
}