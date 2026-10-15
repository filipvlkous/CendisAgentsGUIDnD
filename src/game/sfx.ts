// Tiny 8-bit sound effects made with WebAudio square waves. Muting is remembered per browser.

let ctx: AudioContext | null = null;
let muted = (() => {
  try {
    return localStorage.getItem("as-muted") === "1";
  } catch {
    return false;
  }
})();

export const isMuted = () => muted;
export function setMuted(m: boolean) {
  muted = m;
  try {
    localStorage.setItem("as-muted", m ? "1" : "0");
  } catch {
    // storage unavailable: keep the in-memory value
  }
}

function tone(freq: number, start: number, dur: number, type: OscillatorType = "square", vol = 0.05) {
  if (!ctx) return;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, ctx.currentTime + start);
  gain.gain.setValueAtTime(vol, ctx.currentTime + start);
  gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + start + dur);
  osc.connect(gain).connect(ctx.destination);
  osc.start(ctx.currentTime + start);
  osc.stop(ctx.currentTime + start + dur + 0.02);
}

const SOUNDS = {
  click: [[660, 0, 0.05]],
  select: [[523, 0, 0.06], [784, 0.06, 0.08]],
  equip: [[392, 0, 0.06], [523, 0.06, 0.06], [659, 0.12, 0.1]],
  unequip: [[523, 0, 0.06], [392, 0.06, 0.1]],
  save: [[523, 0, 0.07], [659, 0.07, 0.07], [784, 0.14, 0.07], [1046, 0.21, 0.15]],
  quest: [[262, 0, 0.1], [330, 0.1, 0.1], [392, 0.2, 0.1], [523, 0.3, 0.25]],
  win: [[523, 0, 0.1], [523, 0.1, 0.1], [523, 0.2, 0.1], [698, 0.3, 0.35]],
  fail: [[392, 0, 0.15], [330, 0.15, 0.15], [262, 0.3, 0.35]],
  levelup: [[523, 0, 0.08], [659, 0.08, 0.08], [784, 0.16, 0.08], [1046, 0.24, 0.08], [1318, 0.32, 0.3]],
  talk: [[880, 0, 0.03], [990, 0.05, 0.03], [880, 0.1, 0.03]],
  ask: [[660, 0, 0.08], [880, 0.1, 0.08], [660, 0.2, 0.08], [990, 0.3, 0.16]],
  step: [[180, 0, 0.03, "triangle"]],
} as const;

export type Sound = keyof typeof SOUNDS;

export function sfx(name: Sound) {
  if (muted) return;
  try {
    ctx ??= new AudioContext();
    for (const [f, s, d, type] of SOUNDS[name] as readonly (readonly [number, number, number, OscillatorType?])[]) tone(f, s, d, type);
  } catch {
    // audio not available
  }
}
