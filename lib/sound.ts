// Small synthesized UI sounds (WebAudio, no audio files). Off when the player mutes them.
type SoundName = "win" | "bigwin" | "notify" | "coin";

const KEY = "bayhan.sound";
let ctx: AudioContext | null = null;

export function soundEnabled(): boolean {
  try {
    return localStorage.getItem(KEY) !== "off";
  } catch {
    return true;
  }
}

export function setSoundEnabled(on: boolean) {
  try {
    localStorage.setItem(KEY, on ? "on" : "off");
  } catch {
    // storage blocked: sound simply stays at the default
  }
}

function audio(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  ctx ??= new Ctor();
  if (ctx.state === "suspended") ctx.resume().catch(() => {});
  return ctx;
}

function tone(a: AudioContext, freq: number, start: number, dur: number, type: OscillatorType, gain: number) {
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, a.currentTime + start);
  g.gain.setValueAtTime(0, a.currentTime + start);
  g.gain.linearRampToValueAtTime(gain, a.currentTime + start + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + start + dur);
  o.connect(g).connect(a.destination);
  o.start(a.currentTime + start);
  o.stop(a.currentTime + start + dur + 0.05);
}

export function play(name: SoundName) {
  if (!soundEnabled()) return;
  const a = audio();
  if (!a) return;
  try {
    if (name === "coin") {
      tone(a, 988, 0, 0.08, "square", 0.04);
      tone(a, 1319, 0.07, 0.22, "square", 0.04);
    } else if (name === "notify") {
      tone(a, 880, 0, 0.18, "sine", 0.08);
      tone(a, 1318.5, 0.12, 0.3, "sine", 0.07);
    } else if (name === "win") {
      [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone(a, f, i * 0.08, 0.35, "triangle", 0.08));
    } else {
      // big win: rising arpeggio + bright chord
      [392, 523.25, 659.25, 783.99, 1046.5, 1318.5].forEach((f, i) => tone(a, f, i * 0.07, 0.4, "triangle", 0.08));
      [1046.5, 1318.5, 1568].forEach((f) => tone(a, f, 0.45, 1.1, "sine", 0.06));
    }
  } catch {
    // audio is a nicety; never break the game because of it
  }
}
