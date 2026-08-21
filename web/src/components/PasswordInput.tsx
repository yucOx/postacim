import { useState } from 'react';

/** 0-4 heuristic score — length dominates, classes add, common patterns sink it */
export function passwordScore(pw: string): number {
  if (!pw) return 0;
  let score = Math.min(pw.length / 4, 3) * 1.33; // length is the main lever
  const classes = [/[a-zğüşöçı]/, /[A-ZĞÜŞÖÇİ]/, /[0-9]/, /[^a-zA-Z0-9ğüşöçıĞÜŞÖÇİ]/].filter((r) =>
    r.test(pw),
  ).length;
  score += (classes - 1) * 0.35;
  if (/^(.)\1+$|^(0123|1234|qwer|asdf|şifre|pass)/i.test(pw)) score = 0.5;
  return Math.max(0, Math.min(4, Math.round(score)));
}

const LABELS = ['çok zayıf', 'zayıf', 'orta', 'iyi', 'güçlü'];
const COLORS = ['bg-red-500', 'bg-orange-500', 'bg-amber-500', 'bg-lime-500', 'bg-emerald-500'];

export default function PasswordInput({
  value,
  onChange,
  placeholder,
  autoFocus,
  minLength = 6,
  showStrength = true,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
  minLength?: number;
  showStrength?: boolean;
}) {
  const [show, setShow] = useState(false);
  const score = passwordScore(value);
  return (
    <div className="flex flex-col gap-1">
      <div className="relative">
        <input
          type={show ? 'text' : 'password'}
          value={value}
          autoFocus={autoFocus}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          minLength={minLength}
          autoComplete="new-password"
          className="w-full rounded-md border border-neutral-700 bg-neutral-800 px-3 py-2 pr-10 text-sm text-neutral-200 outline-none focus:border-neutral-500"
        />
        <button
          type="button"
          onClick={() => setShow((s) => !s)}
          aria-label={show ? 'şifreyi gizle' : 'şifreyi göster'}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-sm text-neutral-500 hover:text-neutral-300"
        >
          {show ? '🙈' : '👁'}
        </button>
      </div>
      {showStrength && value.length > 0 && (
        <div className="flex items-center gap-2 text-[11px] text-neutral-500">
          <div className="flex h-1 flex-1 gap-0.5" aria-hidden>
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className={`h-full flex-1 rounded ${i < score ? COLORS[score] : 'bg-neutral-700'}`} />
            ))}
          </div>
          <span className={score <= 1 ? 'text-red-400' : score === 2 ? 'text-amber-400' : 'text-emerald-400'}>
            {LABELS[score]}
          </span>
        </div>
      )}
    </div>
  );
}
