// Notification chime — WebAudio, no asset files. Two soft sine notes
// (E5 → A5, a gentle "ding-dong") with a bell-like fast attack and decay.
let ctx: AudioContext | null = null;

export function playChime(): void {
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
    const t0 = ctx.currentTime;
    const notes: [number, number][] = [
      [659.25, 0], // E5
      [880, 0.1], // A5
    ];
    for (const [freq, at] of notes) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, t0 + at);
      gain.gain.exponentialRampToValueAtTime(0.12, t0 + at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + at + 0.35);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t0 + at);
      osc.stop(t0 + at + 0.4);
    }
  } catch {
    // audio blocked until first user gesture — fine, the title badge still shows
  }
}

// Mention chime — brighter/louder two-note rise (A5 → C#6) so a ping that
// names you cuts through the regular incoming-message ding.
export function playMention(): void {
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
    const t0 = ctx.currentTime;
    const notes: [number, number][] = [
      [880, 0], // A5
      [1108.73, 0.09], // C#6
    ];
    for (const [freq, at] of notes) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, t0 + at);
      gain.gain.exponentialRampToValueAtTime(0.18, t0 + at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + at + 0.45);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t0 + at);
      osc.stop(t0 + at + 0.5);
    }
  } catch {
    // audio blocked until first user gesture — fine, the title badge still shows
  }
}