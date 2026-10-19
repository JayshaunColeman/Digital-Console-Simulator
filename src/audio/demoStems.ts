/**
 * Demo band multitrack.
 *
 * These stems are procedurally synthesized at runtime (OfflineAudioContext, seeded PRNG) for
 * mixing-training purposes only. No audio files or external assets are used, and nothing here is
 * derived from any copyrighted recording. 112 BPM, 4/4, 8 bars, Am - F - C - G (2 bars each).
 * Every stem has exactly the same length so the set loops in sync.
 */

export type StemId = 'vox' | 'kick' | 'snare' | 'hats' | 'bass' | 'keys' | 'backing';
export interface StemInfo {
  id: StemId;
  name: string;
  stereo: boolean;
}

export const DEMO_STEMS: StemInfo[] = [
  { id: 'vox', name: 'Vocal (synth)', stereo: false },
  { id: 'kick', name: 'Kick', stereo: false },
  { id: 'snare', name: 'Snare', stereo: false },
  { id: 'hats', name: 'Hi-Hat', stereo: false },
  { id: 'bass', name: 'Bass', stereo: false },
  { id: 'keys', name: 'Keys', stereo: true },
  { id: 'backing', name: 'Backing Track', stereo: true },
];

const BPM = 112;
const BEAT = 60 / BPM;
const BARS = 8;
const BEATS_PER_BAR = 4;
const TOTAL_BEATS = BARS * BEATS_PER_BAR;
const LOOP_SECONDS = TOTAL_BEATS * BEAT;

/** Target absolute peak per stem, in dBFS. */
const PEAK_DB: Record<StemId, number> = {
  vox: -6,
  kick: -3,
  snare: -6,
  hats: -12,
  bass: -6,
  keys: -9,
  backing: -9,
};

const SEEDS: Record<StemId, number> = {
  vox: 0x1a2b3c,
  kick: 0x2b3c4d,
  snare: 0x3c4d5e,
  hats: 0x4d5e6f,
  bass: 0x5e6f70,
  keys: 0x6f7081,
  backing: 0x708192,
};

const FADE_IN = 0.0015;
const FADE_OUT = 0.025;

interface Build {
  ctx: OfflineAudioContext;
  out: AudioNode;
  rng: () => number;
  total: number;
}

interface Chord {
  /** MIDI note of the bass root. */
  bassRoot: number;
  /** Electric-piano voicing. */
  keys: number[];
  /** Pad voicing. */
  pad: number[];
  /** Arpeggio tones (ascending). */
  arp: number[];
}

// Am - F - C - G, 2 bars each.
const CHORDS: Chord[] = [
  { bassRoot: 33, keys: [57, 60, 64, 67], pad: [57, 60, 64, 69], arp: [69, 72, 76, 81] },
  { bassRoot: 29, keys: [53, 57, 60, 64], pad: [53, 57, 60, 65], arp: [65, 69, 72, 77] },
  { bassRoot: 36, keys: [55, 60, 64, 71], pad: [55, 60, 64, 67], arp: [72, 76, 79, 84] },
  { bassRoot: 31, keys: [55, 59, 62, 69], pad: [55, 59, 62, 67], arp: [67, 71, 74, 79] },
];

function mulberry32(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const mtof = (m: number): number => 440 * Math.pow(2, (m - 69) / 12);
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const chordAtBar = (bar: number): Chord => CHORDS[Math.floor(bar / 2)];

function makeNoise(ctx: OfflineAudioContext, rng: () => number, seconds: number): AudioBuffer {
  const len = Math.round(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = rng() * 2 - 1;
  return buf;
}

/** One-shot noise burst from a random position in the noise buffer. */
function noiseHit(b: Build, buf: AudioBuffer, when: number, dur: number, dest: AudioNode): void {
  const s = b.ctx.createBufferSource();
  s.buffer = buf;
  s.connect(dest);
  const offset = b.rng() * Math.max(0.01, buf.duration - dur - 0.02);
  s.start(when, offset, dur);
}

/** Percussive amplitude envelope: fast linear attack then exponential-ish decay. */
function percEnv(g: AudioParam, t: number, peak: number, attack: number, tau: number): void {
  g.setValueAtTime(0, t);
  g.linearRampToValueAtTime(peak, t + attack);
  g.setTargetAtTime(0, t + attack, tau);
}

// ---------------------------------------------------------------------------------------------
// Vocal
// ---------------------------------------------------------------------------------------------

type Vowel = 'ah' | 'oh' | 'eh' | 'oo';
const VOWELS: Record<Vowel, [number, number, number]> = {
  ah: [800, 1150, 2900],
  oh: [450, 800, 2830],
  eh: [530, 1840, 2480],
  oo: [300, 870, 2240],
};
const FORMANT_Q = [6, 9, 12];
const FORMANT_GAIN = [1.0, 0.65, 0.4];

interface VoxNote {
  beat: number;
  dur: number;
  midi: number;
  vowel: Vowel;
  level: number;
}

// Four phrases, one per chord, with deliberately different loudness.
const VOX_NOTES: VoxNote[] = [
  // Am: loud phrase
  { beat: 0.5, dur: 1.0, midi: 69, vowel: 'ah', level: 1.0 },
  { beat: 1.5, dur: 0.5, midi: 72, vowel: 'oh', level: 0.9 },
  { beat: 2.0, dur: 1.5, midi: 76, vowel: 'ah', level: 1.0 },
  { beat: 4.0, dur: 1.0, midi: 74, vowel: 'eh', level: 0.95 },
  { beat: 5.0, dur: 1.0, midi: 72, vowel: 'oh', level: 0.85 },
  { beat: 6.0, dur: 1.5, midi: 69, vowel: 'ah', level: 0.95 },
  // F: quiet phrase
  { beat: 8.5, dur: 1.0, midi: 65, vowel: 'oh', level: 0.5 },
  { beat: 9.5, dur: 0.5, midi: 69, vowel: 'oo', level: 0.45 },
  { beat: 10.0, dur: 1.5, midi: 72, vowel: 'oh', level: 0.55 },
  { beat: 12.0, dur: 1.0, midi: 69, vowel: 'ah', level: 0.5 },
  { beat: 13.0, dur: 1.0, midi: 65, vowel: 'oh', level: 0.45 },
  { beat: 14.0, dur: 1.5, midi: 65, vowel: 'oh', level: 0.5 },
  // C: medium-loud phrase, higher
  { beat: 16.0, dur: 0.75, midi: 72, vowel: 'ah', level: 0.85 },
  { beat: 16.75, dur: 0.75, midi: 76, vowel: 'ah', level: 0.9 },
  { beat: 17.5, dur: 0.5, midi: 79, vowel: 'eh', level: 0.95 },
  { beat: 18.0, dur: 1.5, midi: 76, vowel: 'ah', level: 0.95 },
  { beat: 20.0, dur: 1.0, midi: 74, vowel: 'eh', level: 0.8 },
  { beat: 21.0, dur: 1.0, midi: 72, vowel: 'oh', level: 0.8 },
  { beat: 22.0, dur: 1.5, midi: 67, vowel: 'oh', level: 0.75 },
  // G: soft closing phrase
  { beat: 24.5, dur: 1.0, midi: 71, vowel: 'oo', level: 0.32 },
  { beat: 25.5, dur: 0.5, midi: 67, vowel: 'oh', level: 0.3 },
  { beat: 26.0, dur: 1.5, midi: 74, vowel: 'ah', level: 0.38 },
  { beat: 28.0, dur: 1.0, midi: 71, vowel: 'oh', level: 0.3 },
  { beat: 29.0, dur: 1.0, midi: 67, vowel: 'oo', level: 0.28 },
  { beat: 30.0, dur: 1.0, midi: 62, vowel: 'oh', level: 0.25 },
];

function buildVox(b: Build): void {
  const { ctx, out, rng, total } = b;
  const src = ctx.createOscillator();
  src.type = 'sawtooth';
  src.frequency.value = mtof(VOX_NOTES[0].midi);

  // Vibrato: LFO into detune (cents), depth is re-ramped on every note.
  const lfo = ctx.createOscillator();
  lfo.frequency.value = 5.3;
  const vibDepth = ctx.createGain();
  vibDepth.gain.value = 0;
  lfo.connect(vibDepth).connect(src.detune);

  const srcGain = ctx.createGain();
  srcGain.gain.value = 0.8;
  src.connect(srcGain);

  const noise = ctx.createBufferSource();
  noise.buffer = makeNoise(ctx, rng, 1);
  noise.loop = true;
  const noiseGain = ctx.createGain();
  noiseGain.gain.value = 0;
  noise.connect(noiseGain);

  const mix = ctx.createGain();
  srcGain.connect(mix);
  noiseGain.connect(mix);

  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 150;
  mix.connect(hp);

  const env = ctx.createGain();
  env.gain.value = 0;
  const formants: BiquadFilterNode[] = [];
  for (let k = 0; k < 3; k++) {
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = FORMANT_Q[k];
    f.frequency.value = VOWELS[VOX_NOTES[0].vowel][k];
    const g = ctx.createGain();
    g.gain.value = FORMANT_GAIN[k];
    hp.connect(f).connect(g).connect(env);
    formants.push(f);
  }

  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 5200;
  env.connect(lp).connect(out);

  for (const n of VOX_NOTES) {
    const t = n.beat * BEAT + (rng() - 0.5) * 0.012;
    const dur = n.dur * BEAT - 0.04;
    const f0 = mtof(n.midi) * (1 + (rng() - 0.5) * 0.004);

    // Pitch: slight scoop up into the note.
    src.frequency.setValueAtTime(f0 * 0.972, t);
    src.frequency.setTargetAtTime(f0, t, 0.03);

    // Vibrato fades in over the note.
    vibDepth.gain.setValueAtTime(3, t);
    vibDepth.gain.linearRampToValueAtTime(20, t + Math.min(0.35, dur));

    // Vowel formants (F1 kept above the pitch for higher notes, like a real singer).
    const vf = VOWELS[n.vowel];
    for (let k = 0; k < 3; k++) {
      const target = k === 0 ? Math.max(vf[0], f0 * 1.05) : vf[k];
      formants[k].frequency.setTargetAtTime(target, t - 0.02, 0.022);
    }

    // Syllable amplitude: quick attack, slight sag, release.
    const lvl = n.level;
    env.gain.setTargetAtTime(lvl, t, 0.012);
    env.gain.setTargetAtTime(lvl * 0.82, t + Math.min(0.15, dur * 0.4), 0.35);
    env.gain.setTargetAtTime(0, t + dur, 0.035);

    // Consonant / breath burst on the onset, then a little aspiration.
    noiseGain.gain.setValueAtTime(0.4, t);
    noiseGain.gain.setTargetAtTime(0.03, t + 0.005, 0.03);
    noiseGain.gain.setTargetAtTime(0, t + dur, 0.02);
  }

  src.start(0);
  lfo.start(0);
  noise.start(0);
  src.stop(total);
  lfo.stop(total);
  noise.stop(total);
}

// ---------------------------------------------------------------------------------------------
// Drums
// ---------------------------------------------------------------------------------------------

function buildKick(b: Build): void {
  const { ctx, out, rng, total } = b;
  const noise = makeNoise(ctx, rng, 0.5);
  const clickLp = ctx.createBiquadFilter();
  clickLp.type = 'lowpass';
  clickLp.frequency.value = 5000;
  clickLp.connect(out);

  const hits: Array<[number, number]> = [];
  for (let bar = 0; bar < BARS; bar++) {
    const base = bar * BEATS_PER_BAR;
    hits.push([base, 1], [base + 2, 0.95]);
    if (bar % 4 === 1) hits.push([base + 2.5, 0.8]);
    if (bar === 3) hits.push([base + 3.5, 0.7]);
    if (bar === 7) hits.push([base + 1.75, 0.8]);
    if (bar % 4 === 2) hits.push([base + 0.75, 0.6]);
  }

  for (const [beat, vel] of hits) {
    const t = beat * BEAT;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(150, t);
    osc.frequency.exponentialRampToValueAtTime(48, t + 0.1);
    const g = ctx.createGain();
    percEnv(g.gain, t, vel, 0.002, 0.11);
    osc.connect(g).connect(out);
    osc.start(t);
    osc.stop(Math.min(total, t + 0.6));

    const cg = ctx.createGain();
    percEnv(cg.gain, t, vel * 0.35, 0.0005, 0.004);
    cg.connect(clickLp);
    noiseHit(b, noise, t, 0.03, cg);
  }
}

function buildSnare(b: Build): void {
  const { ctx, out, rng, total } = b;
  const noise = makeNoise(ctx, rng, 0.5);

  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 1100;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 9000;
  hp.connect(lp).connect(out);

  const hits: Array<[number, number]> = [];
  for (let bar = 0; bar < BARS; bar++) {
    const base = bar * BEATS_PER_BAR;
    hits.push([base + 1, 1]);
    if (bar === 7) {
      // Fill into the loop point, crescendo.
      hits.push([base + 3, 0.7], [base + 3.25, 0.5], [base + 3.5, 0.7], [base + 3.75, 0.9]);
    } else {
      hits.push([base + 3, 1]);
      if (bar % 2 === 0 && bar > 0) hits.push([base + 2.75, 0.22]);
      if (bar % 2 === 1) hits.push([base + 3.75, 0.25]);
    }
  }

  for (const [beat, vel] of hits) {
    const t = beat * BEAT + (rng() - 0.5) * 0.004;
    const ng = ctx.createGain();
    percEnv(ng.gain, t, vel, 0.001, 0.07);
    ng.connect(hp);
    noiseHit(b, noise, t, 0.35, ng);

    const body = ctx.createOscillator();
    body.type = 'triangle';
    body.frequency.setValueAtTime(215, t);
    body.frequency.exponentialRampToValueAtTime(165, t + 0.05);
    const bg = ctx.createGain();
    percEnv(bg.gain, t, vel * 0.7, 0.001, 0.05);
    body.connect(bg).connect(out);
    body.start(t);
    body.stop(Math.min(total, t + 0.3));

    const ring = ctx.createOscillator();
    ring.type = 'sine';
    ring.frequency.value = 330;
    const rg = ctx.createGain();
    percEnv(rg.gain, t, vel * 0.25, 0.001, 0.025);
    ring.connect(rg).connect(out);
    ring.start(t);
    ring.stop(Math.min(total, t + 0.2));
  }
}

function buildHats(b: Build): void {
  const { ctx, out, rng, total } = b;
  const noise = makeNoise(ctx, rng, 1);

  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 7000;
  hp.Q.value = 0.7;
  const bp = ctx.createBiquadFilter();
  bp.type = 'peaking';
  bp.frequency.value = 10000;
  bp.Q.value = 1;
  bp.gain.value = 5;
  hp.connect(bp).connect(out);

  const hit = (beat: number, vel: number, tau: number, len: number): void => {
    const t = beat * BEAT + (rng() - 0.5) * 0.004;
    const g = ctx.createGain();
    percEnv(g.gain, t, vel, 0.0012, tau);
    g.connect(hp);
    noiseHit(b, noise, t, Math.min(len, total - t - 0.001), g);
  };

  for (let bar = 0; bar < BARS; bar++) {
    for (let e = 0; e < 8; e++) {
      const beat = bar * BEATS_PER_BAR + e * 0.5;
      const accent = e % 4 === 0 ? 1.0 : e % 2 === 0 ? 0.75 : 0.5;
      const vel = accent * (0.9 + rng() * 0.2);
      if (bar === 3 && e === 7) {
        hit(beat, 0.8, 0.07, 0.4); // open hat
      } else {
        hit(beat, vel, 0.02, 0.16);
      }
    }
    if (bar % 2 === 1) hit(bar * BEATS_PER_BAR + 3.75, 0.28, 0.01, 0.1); // ghost 16th
  }
}

// ---------------------------------------------------------------------------------------------
// Bass
// ---------------------------------------------------------------------------------------------

function buildBass(b: Build): void {
  const { ctx, out, total } = b;
  const saw = ctx.createOscillator();
  saw.type = 'sawtooth';
  const sub = ctx.createOscillator();
  sub.type = 'sine';

  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.Q.value = 2;
  lp.frequency.value = 300;
  const sawGain = ctx.createGain();
  sawGain.gain.value = 0.7;
  const subGain = ctx.createGain();
  subGain.gain.value = 0.9;
  const env = ctx.createGain();
  env.gain.value = 0;

  saw.connect(lp).connect(sawGain).connect(env);
  sub.connect(subGain).connect(env);
  env.connect(out);

  // [beat in bar, length in beats, semitone offset]
  const patEven: Array<[number, number, number]> = [
    [0, 1.5, 0],
    [1.5, 0.5, 12],
    [2, 1, 0],
    [3, 0.5, 0],
    [3.5, 0.5, 7],
  ];
  const patOdd: Array<[number, number, number]> = [
    [0, 1.5, 0],
    [2, 0.75, 0],
    [2.75, 0.75, 12],
    [3.5, 0.5, 7],
  ];

  for (let bar = 0; bar < BARS; bar++) {
    const root = chordAtBar(bar).bassRoot;
    for (const [beat, len, semi] of bar % 2 === 0 ? patEven : patOdd) {
      const t = (bar * BEATS_PER_BAR + beat) * BEAT;
      const dur = len * BEAT - 0.03;
      const f = mtof(root + semi);
      saw.frequency.setValueAtTime(f, t);
      sub.frequency.setValueAtTime(f, t);

      lp.frequency.setValueAtTime(950, t);
      lp.frequency.setTargetAtTime(260, t, 0.1);

      env.gain.setValueAtTime(0, t);
      env.gain.linearRampToValueAtTime(1, t + 0.006);
      env.gain.setTargetAtTime(0.7, t + 0.006, 0.3);
      env.gain.setTargetAtTime(0, t + dur, 0.012);
    }
  }

  saw.start(0);
  sub.start(0);
  saw.stop(total);
  sub.stop(total);
}

// ---------------------------------------------------------------------------------------------
// Keys (electric piano)
// ---------------------------------------------------------------------------------------------

function buildKeys(b: Build): void {
  const { ctx, out, rng, total } = b;

  // Electric-piano-ish tone: sine fundamental with a little 2nd/3rd/bell partial in one wave.
  const wave = ctx.createPeriodicWave(
    new Float32Array([0, 1, 0.38, 0.14, 0.05, 0.03, 0.015]),
    new Float32Array(7),
  );

  // Shared panners (voice position x side) so each note only needs oscillator + envelope.
  const VOICES = 4;
  const panners: AudioNode[][] = [];
  for (let i = 0; i < VOICES; i++) {
    const pos = (i / (VOICES - 1) - 0.5) * 0.7;
    const row: AudioNode[] = [];
    for (const off of [-0.35, 0.35]) {
      const p = ctx.createStereoPanner();
      p.pan.value = clamp(pos + off, -1, 1);
      p.connect(out);
      row.push(p);
    }
    panners.push(row);
  }

  // [beat in bar, velocity, decay tau]
  const patEven: Array<[number, number, number]> = [
    [0, 1.0, 0.7],
    [1.5, 0.7, 0.5],
    [3, 0.85, 0.5],
  ];
  const patOdd: Array<[number, number, number]> = [
    [0, 0.95, 0.8],
    [2.5, 0.75, 0.5],
  ];
  const patLast: Array<[number, number, number]> = [
    [0, 0.9, 0.6],
    [1.5, 0.7, 0.3],
  ];

  for (let bar = 0; bar < BARS; bar++) {
    const chord = chordAtBar(bar);
    const pat = bar === BARS - 1 ? patLast : bar % 2 === 0 ? patEven : patOdd;
    for (const [beat, vel, tau] of pat) {
      const tHit = (bar * BEATS_PER_BAR + beat) * BEAT;
      chord.keys.forEach((midi, i) => {
        const t = tHit + i * 0.006 + rng() * 0.004;
        const v = vel * (0.85 + rng() * 0.3) * (midi < 55 ? 1.1 : 1);
        const end = t + tau * 5;
        [-3, 3].forEach((cents, side) => {
          const osc = ctx.createOscillator();
          osc.setPeriodicWave(wave);
          osc.frequency.value = mtof(midi);
          osc.detune.value = cents;
          const g = ctx.createGain();
          percEnv(g.gain, t, v * 0.3, 0.003, tau);
          // Cut the tail at about -43 dB so long decays do not keep oscillators alive.
          g.gain.setTargetAtTime(0, end, 0.006);
          osc.connect(g).connect(panners[i % VOICES][side]);
          osc.start(t);
          osc.stop(Math.min(total, end + 0.06));
        });
      });
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Backing track: wide pad + ping-pong arpeggio
// ---------------------------------------------------------------------------------------------

function buildBacking(b: Build): void {
  const { ctx, out, total } = b;

  // Pad bus with a slowly moving low-pass.
  const padBus = ctx.createBiquadFilter();
  padBus.type = 'lowpass';
  padBus.frequency.value = 1400;
  padBus.Q.value = 0.7;
  const padGain = ctx.createGain();
  padGain.gain.value = 0.9;
  padBus.connect(padGain).connect(out);
  const lfo = ctx.createOscillator();
  lfo.frequency.value = 0.12;
  const lfoDepth = ctx.createGain();
  lfoDepth.gain.value = 500;
  lfo.connect(lfoDepth).connect(padBus.frequency);
  lfo.start(0);
  lfo.stop(total);

  const padMerge = ctx.createChannelMerger(2);
  padMerge.connect(padBus);

  CHORDS.forEach((chord, c) => {
    const start = c * 8 * BEAT;
    const end = start + 8 * BEAT;
    const last = c === CHORDS.length - 1;
    const stop = last ? total : end + 0.9;
    // One envelope per side; saws are summed per side so no per-voice panner is needed.
    const sides: GainNode[] = [];
    for (let side = 0; side < 2; side++) {
      const env = ctx.createGain();
      env.gain.setValueAtTime(0, start);
      env.gain.linearRampToValueAtTime(1, start + 0.8);
      if (!last) {
        env.gain.setValueAtTime(1, end - 0.2);
        env.gain.linearRampToValueAtTime(0, end + 0.8);
      } else {
        env.gain.setValueAtTime(1, total - 1.2);
        env.gain.linearRampToValueAtTime(0, total - 0.04);
      }
      env.connect(padMerge, 0, side);
      sides.push(env);
    }

    chord.pad.forEach((midi, i) => {
      const f = mtof(midi);
      for (let s = 0; s < 2; s++) {
        const osc = ctx.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.value = f;
        osc.detune.value = s === 0 ? -9 : 9;
        const g = ctx.createGain();
        g.gain.value = 0.09;
        osc.connect(g).connect(sides[(i + s) % 2]);
        osc.start(start);
        osc.stop(Math.min(total, stop));
      }
    });
  });

  // Arpeggio into a dry bus and a ping-pong delay (dotted eighth).
  const arpBus = ctx.createGain();
  arpBus.connect(out);
  const mono = ctx.createGain();
  mono.channelCount = 1;
  mono.channelCountMode = 'explicit';
  arpBus.connect(mono);
  const dL = ctx.createDelay(2);
  const dR = ctx.createDelay(2);
  dL.delayTime.value = 0.75 * BEAT;
  dR.delayTime.value = 0.75 * BEAT;
  const fbA = ctx.createGain();
  const fbB = ctx.createGain();
  fbA.gain.value = 0.45;
  fbB.gain.value = 0.45;
  const merger = ctx.createChannelMerger(2);
  const wet = ctx.createGain();
  wet.gain.value = 0.5;
  mono.connect(dL);
  dL.connect(merger, 0, 0);
  dL.connect(fbA).connect(dR);
  dR.connect(merger, 0, 1);
  dR.connect(fbB).connect(dL);
  merger.connect(wet).connect(out);

  const arpPans: StereoPannerNode[] = [];
  for (let k = 0; k < 4; k++) {
    const p = ctx.createStereoPanner();
    p.pan.value = ((k - 1.5) / 1.5) * 0.85;
    p.connect(arpBus);
    arpPans.push(p);
  }

  const order = [0, 1, 2, 3, 2, 1, 2, 3];
  for (let j = 0; j < BARS * 8; j++) {
    const bar = Math.floor(j / 8);
    const step = j % 8;
    if (bar === BARS - 1 && step >= 5) continue; // let the delay tails die before the loop point
    const t = j * 0.5 * BEAT;
    const f = mtof(chordAtBar(bar).arp[order[step]]);
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = f;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.value = 1;
    lp.frequency.setValueAtTime(3400, t);
    lp.frequency.setTargetAtTime(800, t, 0.07);
    const g = ctx.createGain();
    percEnv(g.gain, t, step === 0 ? 0.42 : 0.3, 0.003, 0.09);
    osc.connect(lp).connect(g).connect(arpPans[j % 4]);
    osc.start(t);
    osc.stop(Math.min(total, t + 0.6));
  }
}

// ---------------------------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------------------------

const BUILDERS: Record<StemId, (b: Build) => void> = {
  vox: buildVox,
  kick: buildKick,
  snare: buildSnare,
  hats: buildHats,
  bass: buildBass,
  keys: buildKeys,
  backing: buildBacking,
};

function normalize(buf: AudioBuffer, targetDb: number): void {
  let peak = 0;
  for (let ch = 0; ch < buf.numberOfChannels; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < d.length; i++) {
      const a = Math.abs(d[i]);
      if (a > peak) peak = a;
    }
  }
  if (!(peak > 1e-9)) return;
  const gain = Math.pow(10, targetDb / 20) / peak;
  for (let ch = 0; ch < buf.numberOfChannels; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < d.length; i++) d[i] *= gain;
  }
}

async function renderStem(info: StemInfo, sampleRate: number): Promise<AudioBuffer> {
  const length = Math.round(LOOP_SECONDS * sampleRate);
  const ctx = new OfflineAudioContext({
    numberOfChannels: info.stereo ? 2 : 1,
    length,
    sampleRate,
  });
  const total = length / sampleRate;

  // Short fades at both ends guarantee a click-free loop point.
  const master = ctx.createGain();
  master.gain.setValueAtTime(0, 0);
  master.gain.linearRampToValueAtTime(1, FADE_IN);
  master.gain.setValueAtTime(1, total - FADE_OUT);
  master.gain.linearRampToValueAtTime(0, total - 0.0005);
  master.connect(ctx.destination);

  BUILDERS[info.id]({ ctx, out: master, rng: mulberry32(SEEDS[info.id]), total });
  const buf = await ctx.startRendering();
  normalize(buf, PEAK_DB[info.id]);
  return buf;
}

export async function renderDemoStems(sampleRate: number): Promise<Record<StemId, AudioBuffer>> {
  const bufs = await Promise.all(DEMO_STEMS.map((s) => renderStem(s, sampleRate)));
  const result = {} as Record<StemId, AudioBuffer>;
  DEMO_STEMS.forEach((s, i) => {
    result[s.id] = bufs[i];
  });
  return result;
}
