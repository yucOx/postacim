/** postacim mark — the carrier pigeon of the night mail, drawn once, reused everywhere. */
export function PigeonMark({ className = '', size = 24 }: { className?: string; size?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="currentColor"
      className={className}
      aria-hidden="true"
    >
      {/* body + head, sweeping right */}
      <path d="M22.2 6.4c-2.9-1.5-5.6-.9-7.5 1.2l-1.2 1.3-8-1.2-2.7 2.5 6.6 2.2-7.6 6.9 3.2 1 5.3-3.9 1.7 4.9 2.9-1.2-1.2-4.9 3.1-2.6c2.3-1.9 4.3-3.3 5.4-6.2z" />
      {/* eye — punched out of the ink */}
      <circle cx="18.1" cy="7.3" r="0.85" fill="var(--color-night-950, #0b0e13)" />
    </svg>
  );
}

/** round official seal — ring, pigeon, and the sealing text */
export function SealMark({
  className = '',
  size = 96,
  text = 'POSTACIM · UÇTAN UCA · ',
}: {
  className?: string;
  size?: number;
  text?: string;
}) {
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} className={className} aria-hidden="true">
      <defs>
        <path id="seal-arc" d="M50 50 m -38 0 a 38 38 0 1 1 76 0 a 38 38 0 1 1 -76 0" />
      </defs>
      <circle cx="50" cy="50" r="47" fill="none" stroke="currentColor" strokeWidth="2" />
      <circle cx="50" cy="50" r="41" fill="none" stroke="currentColor" strokeWidth="0.75" />
      <text fontSize="8.2" letterSpacing="2.2" fill="currentColor" fontFamily="var(--font-display), sans-serif">
        <textPath href="#seal-arc">{text}</textPath>
      </text>
      <g transform="translate(30 32) scale(1.68)">
        <PigeonMark size={24} />
      </g>
    </svg>
  );
}

/** small postmark applied to a message the wagon just sealed and sent */
export function Postmark({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" width="15" height="15" className={className} aria-hidden="true">
      <circle cx="10" cy="10" r="8.6" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <circle cx="10" cy="10" r="5.9" fill="none" stroke="currentColor" strokeWidth="0.7" />
      {/* cancellation bars */}
      <path
        d="M-1 12.4 21 7.2M-1 15 21 9.8"
        stroke="currentColor"
        strokeWidth="1.1"
        transform="translate(0 0)"
      />
    </svg>
  );
}
