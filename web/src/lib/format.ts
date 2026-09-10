export const formatTime = (ms: number): string =>
  new Date(ms).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });

export const formatDay = (ms: number): string =>
  new Date(ms).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' });

export const sameDay = (a: number, b: number): boolean => {
  const d1 = new Date(a);
  const d2 = new Date(b);
  return d1.toDateString() === d2.toDateString();
};

// stable nick tint — warm-muted, all ≥4.5:1 on the night ground
const PALETTE = [
  '#e8a33d', // lamba
  '#d98e73', // kiremit
  '#a3b86c', // adaçayı
  '#7fb0c4', // alacakaranık
  '#c99ac0', // gül kurusu
  '#c9a45c', // pirinç
  '#9db8a0', // nane
  '#d4b483', // vurn
];
export const nickColor = (nick: string): string => {
  let h = 0;
  for (let i = 0; i < nick.length; i++) h = (h * 31 + nick.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length]!;
};
