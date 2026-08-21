export const formatTime = (ms: number): string =>
  new Date(ms).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });

export const formatDay = (ms: number): string =>
  new Date(ms).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' });

export const sameDay = (a: number, b: number): boolean => {
  const d1 = new Date(a);
  const d2 = new Date(b);
  return d1.toDateString() === d2.toDateString();
};

// stable nick color for avatars
const PALETTE = [
  'text-rose-400', 'text-amber-400', 'text-emerald-400', 'text-sky-400',
  'text-violet-400', 'text-fuchsia-400', 'text-teal-400', 'text-orange-400',
];
export const nickColor = (nick: string): string => {
  let h = 0;
  for (let i = 0; i < nick.length; i++) h = (h * 31 + nick.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length]!;
};
