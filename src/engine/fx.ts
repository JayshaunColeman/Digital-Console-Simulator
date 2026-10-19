// Internal effects rack. Input is the FX bus (mono), output is stereo, 100% wet
// (it feeds the matching FX RTN channel, whose fader is the only dry/wet control).
//
// Algorithm families (all sub-graphs are built once; the active one is selected
// by gating its input and output gains, idle ones receive zero input):
//   reverb hall / room / plate  - convolution with a generated stereo IR
//   early reflections           - convolution with a sparse generated IR
//   stereo (ping-pong) / mono delay
//   chorus, flanger, phaser     - modulated delays / allpass chains, internally
//                                 mixed ~50/50 with the unprocessed signal so the
//                                 effect is audible at the return
//   tremolo                     - LFO amplitude modulation with L/R in antiphase
// Every feedback loop contains a DelayNode.

import type { FxState, FxType } from '../model/types';

const clamp = (v: number, lo: number, hi: number, d = lo) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);

/** Early-reflection pattern length in ms for the SIZE parameter (`time`, 0.1..1.0). */
export function earlySpanMs(time: number): number {
  return clamp(10 + ((time - 0.1) / 0.9) * 110, 10, 120, 60);
}

/** Sanitised, clamped copy of the parameters (time interpreted per family). */
function sanitize(f: FxState): FxState {
  const t = f.type;
  const isRev = t === 'reverb-hall' || t === 'reverb-room' || t === 'reverb-plate';
  const isDly = t === 'delay-stereo' || t === 'delay-mono';
  return {
    type: t,
    time: isRev ? clamp(f.time, 0.2, 8, 2) : isDly ? clamp(f.time, 1, 2400, 400) : t === 'early-ref' ? clamp(f.time, 0.05, 2, 0.5) : clamp(f.time, 0, 10000, 0),
    predelay: clamp(f.predelay, 0, 200, 0),
    feedback: clamp(f.feedback, 0, 0.95, 0),
    hiCut: clamp(f.hiCut, 1000, 20000, 7000),
    loCut: clamp(f.loCut, 20, 1000, 150),
    rate: clamp(f.rate, 0.05, 20, 1),
    depth: clamp(f.depth, 0, 1, 0.5),
  };
}

// Biquad lowpass Q is in dB: -3.01 dB = Butterworth (no peak), keeps loops with feedback <= 0.95 stable.
const FLAT_Q = -3.01;

const isReverbish = (t: FxType) => t === 'reverb-hall' || t === 'reverb-room' || t === 'reverb-plate' || t === 'early-ref';

/** Quadrature low-frequency oscillator pair (sin + cos stay exactly 90 degrees apart). */
class Lfo {
  readonly sin: OscillatorNode;
  readonly cos: OscillatorNode;
  private started = false;
  constructor(ctx: AudioContext) {
    this.sin = ctx.createOscillator();
    this.cos = ctx.createOscillator();
    this.sin.frequency.value = 0.5;
    this.cos.frequency.value = 0.5;
    this.cos.setPeriodicWave(ctx.createPeriodicWave(new Float32Array([0, 1]), new Float32Array([0, 0])));
  }
  start() {
    if (this.started) return;
    this.started = true;
    this.sin.start();
    this.cos.start();
  }
  setRate(hz: number, t: number) {
    this.sin.frequency.setTargetAtTime(hz, t, 0.05);
    this.cos.frequency.setTargetAtTime(hz, t, 0.05);
  }
}

interface Mod {
  g: GainNode;
  k: (s: FxState) => number;
}

export class FxRack {
  readonly input: GainNode;
  readonly output: GainNode;

  // --- convolution family (hall / room / plate / early reflections)
  private revIn: GainNode;
  private predelay: DelayNode;
  private conv: ConvolverNode;
  private revLo: BiquadFilterNode;
  private revHi: BiquadFilterNode;
  private revOut: GainNode;

  // --- delay family
  private dlyIn: GainNode;
  private dlyLo: BiquadFilterNode;
  private dL: DelayNode;
  private dR: DelayNode;
  private fbL: GainNode;
  private fbR: GainNode;
  private dampL: BiquadFilterNode;
  private dampR: BiquadFilterNode;
  private dlyOut: GainNode;
  private delayMode: 'delay-stereo' | 'delay-mono' | null = null;

  // --- modulation family
  private modLo: BiquadFilterNode;
  private modHi: BiquadFilterNode;
  private lfos: Record<'chorus' | 'flanger' | 'phaser' | 'tremolo', Lfo>;
  private mods: Mod[] = [];
  private gates: Record<'chorus' | 'flanger' | 'phaser' | 'tremolo', GainNode>;
  private outs: Record<'chorus' | 'flanger' | 'phaser' | 'tremolo', GainNode>;
  private flFb: GainNode[] = [];
  private flWet: GainNode[] = [];
  private phFb: GainNode[] = [];
  private phWet: GainNode[] = [];
  private treBase: GainNode[] = [];

  // --- state
  private cur: FxState | null = null;
  private irTimer = 0;
  private irKey = '';
  private irType: FxType | null = null;
  private pendingKey = '';

  constructor(private ctx: AudioContext) {
    this.input = ctx.createGain();
    this.input.channelCount = 1;
    this.input.channelCountMode = 'explicit';
    this.output = ctx.createGain();

    // ---------------------------------------------------------- convolution
    this.revIn = ctx.createGain();
    this.revIn.gain.value = 0;
    this.predelay = ctx.createDelay(0.5);
    this.conv = ctx.createConvolver();
    this.conv.normalize = false;
    this.revLo = ctx.createBiquadFilter();
    this.revLo.type = 'highpass';
    this.revHi = ctx.createBiquadFilter();
    this.revHi.type = 'lowpass';
    this.revHi.Q.value = FLAT_Q;
    this.revOut = ctx.createGain();
    this.revOut.gain.value = 0;
    this.input.connect(this.revIn).connect(this.predelay).connect(this.revLo).connect(this.revHi).connect(this.conv).connect(this.revOut);
    this.revOut.connect(this.output);

    // ---------------------------------------------------------------- delay
    this.dlyIn = ctx.createGain();
    this.dlyIn.gain.value = 0;
    this.dlyLo = ctx.createBiquadFilter();
    this.dlyLo.type = 'highpass';
    this.dL = ctx.createDelay(2.5);
    this.dR = ctx.createDelay(2.5);
    this.fbL = ctx.createGain();
    this.fbR = ctx.createGain();
    this.fbL.gain.value = 0;
    this.fbR.gain.value = 0;
    this.dampL = ctx.createBiquadFilter();
    this.dampR = ctx.createBiquadFilter();
    this.dampL.type = this.dampR.type = 'lowpass';
    this.dampL.Q.value = this.dampR.Q.value = FLAT_Q; // no resonance inside feedback loops
    const dMerge = ctx.createChannelMerger(2);
    this.dlyOut = ctx.createGain();
    this.dlyOut.gain.value = 0;
    this.input.connect(this.dlyIn).connect(this.dlyLo).connect(this.dL);
    this.dL.connect(this.dampL).connect(this.fbL);
    this.dR.connect(this.dampR).connect(this.fbR);
    this.dL.connect(dMerge, 0, 0);
    this.dR.connect(dMerge, 0, 1);
    dMerge.connect(this.dlyOut).connect(this.output);
    this.wireDelay('delay-stereo', 0);

    // ----------------------------------------------------------- modulation
    this.modLo = ctx.createBiquadFilter();
    this.modLo.type = 'highpass';
    this.modHi = ctx.createBiquadFilter();
    this.modHi.type = 'lowpass';
    this.modHi.Q.value = FLAT_Q;
    this.input.connect(this.modLo).connect(this.modHi);
    const mk = () => {
      const g = ctx.createGain();
      g.gain.value = 0;
      return g;
    };
    this.gates = { chorus: mk(), flanger: mk(), phaser: mk(), tremolo: mk() };
    this.outs = { chorus: mk(), flanger: mk(), phaser: mk(), tremolo: mk() };
    this.lfos = { chorus: new Lfo(ctx), flanger: new Lfo(ctx), phaser: new Lfo(ctx), tremolo: new Lfo(ctx) };
    for (const k of ['chorus', 'flanger', 'phaser', 'tremolo'] as const) {
      this.modHi.connect(this.gates[k]);
      this.outs[k].connect(this.output);
    }
    this.buildChorus();
    this.buildFlanger();
    this.buildPhaser();
    this.buildTremolo();
  }

  // ---------------------------------------------------------------- helpers

  /** LFO -> gain -> AudioParam, with the gain tracking a function of the parameters. */
  private mod(src: AudioNode, param: AudioParam, k: (s: FxState) => number) {
    const g = this.ctx.createGain();
    g.gain.value = 0;
    src.connect(g).connect(param);
    this.mods.push({ g, k });
  }

  private stereoOut(kind: 'chorus' | 'flanger' | 'phaser' | 'tremolo') {
    const m = this.ctx.createChannelMerger(2);
    m.connect(this.outs[kind]);
    return m;
  }

  private buildChorus() {
    const ctx = this.ctx;
    const gate = this.gates.chorus;
    const lfo = this.lfos.chorus;
    const m = this.stereoOut('chorus');
    const dry = ctx.createGain();
    dry.gain.value = 0.5;
    gate.connect(dry);
    dry.connect(m, 0, 0);
    dry.connect(m, 0, 1);
    // [base delay s, lfo source, sign, gain to L, gain to R]
    const voices: [number, OscillatorNode, number, number, number][] = [
      [0.017, lfo.sin, 1, 0.45, 0],
      [0.021, lfo.cos, 1, 0, 0.45],
      [0.026, lfo.sin, -1, 0.3, 0.3],
    ];
    for (const [base, src, sign, gl, gr] of voices) {
      const d = ctx.createDelay(0.06);
      d.delayTime.value = base;
      gate.connect(d);
      this.mod(src, d.delayTime, (s) => sign * s.depth * 0.005);
      if (gl) {
        const g = ctx.createGain();
        g.gain.value = gl;
        d.connect(g).connect(m, 0, 0);
      }
      if (gr) {
        const g = ctx.createGain();
        g.gain.value = gr;
        d.connect(g).connect(m, 0, 1);
      }
    }
  }

  private buildFlanger() {
    const ctx = this.ctx;
    const gate = this.gates.flanger;
    const lfo = this.lfos.flanger;
    const m = this.stereoOut('flanger');
    const dry = ctx.createGain();
    dry.gain.value = 0.5;
    gate.connect(dry);
    dry.connect(m, 0, 0);
    dry.connect(m, 0, 1);
    ([[lfo.sin, 0], [lfo.cos, 1]] as [OscillatorNode, number][]).forEach(([src, ch]) => {
      const d = ctx.createDelay(0.02);
      d.delayTime.value = 0.005;
      gate.connect(d);
      this.mod(src, d.delayTime, (s) => s.depth * 0.0035);
      const damp = ctx.createBiquadFilter();
      damp.type = 'lowpass';
      damp.frequency.value = 9000;
      damp.Q.value = FLAT_Q;
      const fb = ctx.createGain();
      fb.gain.value = 0;
      d.connect(damp).connect(fb).connect(d); // loop contains the DelayNode
      const wet = ctx.createGain();
      wet.gain.value = 0.5;
      d.connect(wet).connect(m, 0, ch);
      this.flFb.push(fb);
      this.flWet.push(wet);
    });
  }

  private buildPhaser() {
    const ctx = this.ctx;
    const gate = this.gates.phaser;
    const lfo = this.lfos.phaser;
    const m = this.stereoOut('phaser');
    const dry = ctx.createGain();
    dry.gain.value = 0.5;
    gate.connect(dry);
    dry.connect(m, 0, 0);
    dry.connect(m, 0, 1);
    const bases = [300, 465, 720, 1117, 1730, 2682];
    ([[lfo.sin, 1, 0], [lfo.cos, 1, 1]] as [OscillatorNode, number, number][]).forEach(([src, sign, ch]) => {
      const sum = ctx.createGain();
      gate.connect(sum);
      let node: AudioNode = sum;
      for (const f0 of bases) {
        const ap = ctx.createBiquadFilter();
        ap.type = 'allpass';
        ap.frequency.value = f0;
        ap.Q.value = 0.8;
        node.connect(ap);
        node = ap;
        this.mod(src, ap.detune, (s) => sign * s.depth * 1800);
      }
      // feedback must pass through a DelayNode (cycle rule); one render quantum
      const fbDelay = ctx.createDelay(0.05);
      fbDelay.delayTime.value = 128 / ctx.sampleRate;
      const fb = ctx.createGain();
      fb.gain.value = 0;
      node.connect(fb).connect(fbDelay).connect(sum);
      const wet = ctx.createGain();
      wet.gain.value = 0.5;
      node.connect(wet).connect(m, 0, ch);
      this.phFb.push(fb);
      this.phWet.push(wet);
    });
  }

  private buildTremolo() {
    const ctx = this.ctx;
    const gate = this.gates.tremolo;
    const lfo = this.lfos.tremolo;
    const m = this.stereoOut('tremolo');
    ([[1, 0], [-1, 1]] as [number, number][]).forEach(([sign, ch]) => {
      const amp = ctx.createGain();
      amp.gain.value = 1;
      gate.connect(amp);
      this.mod(lfo.sin, amp.gain, (s) => (sign * s.depth) / 2);
      amp.connect(m, 0, ch);
      this.treBase.push(amp);
    });
  }

  /** (Re)wire the delay feedback topology. */
  private wireDelay(mode: 'delay-stereo' | 'delay-mono', t: number) {
    if (this.delayMode === mode) return;
    this.delayMode = mode;
    this.fbL.disconnect();
    this.fbR.disconnect();
    try {
      this.dL.disconnect(this.dR);
    } catch {
      /* not connected */
    }
    if (mode === 'delay-stereo') {
      // ping-pong L -> R -> L
      this.fbL.connect(this.dR);
      this.fbR.connect(this.dL);
    } else {
      this.fbL.connect(this.dL);
      this.dL.connect(this.dR); // right mirrors left (zero extra delay)
      this.dR.delayTime.setTargetAtTime(0, t, 0.01);
    }
  }

  // ------------------------------------------------------------------- IRs

  private buildIr(type: FxType, time: number) {
    const sr = this.ctx.sampleRate;
    const rnd = () => Math.random();
    const gauss = () => (rnd() + rnd() + rnd() - 1.5) * 2;
    let ir: AudioBuffer;
    if (type === 'early-ref') {
      const span = earlySpanMs(time) / 1000;
      const len = Math.floor(sr * (span + 0.012));
      ir = this.ctx.createBuffer(2, len, sr);
      const N = 10;
      for (let c = 0; c < 2; c++) {
        const d = ir.getChannelData(c);
        for (let j = 0; j < N; j++) {
          const pos = Math.pow((j + 1 + (rnd() - 0.5) * 0.7) / N, 1.35); // denser early, sparser later
          const i = Math.min(len - 3, Math.max(8, Math.floor(span * pos * sr)));
          const a = Math.pow(0.88, j) * (0.7 + 0.3 * rnd()) * (rnd() < 0.5 ? -1 : 1);
          d[i] += a;
          d[i + 1] += a * 0.5; // slight HF rounding of each reflection
          d[i + 2] += a * 0.15;
        }
      }
    } else {
      const T = Math.max(0.2, time);
      const prof =
        type === 'reverb-room'
          ? { onset: 0.006, s0: 0.4, s1: 0.8, er: 22, erFrom: 0.003, erTo: 0.07, erGain: 4, bright: 0 }
          : type === 'reverb-hall'
            ? { onset: 0.045, s0: 0.3, s1: 0.85, er: 6, erFrom: 0.012, erTo: 0.09, erGain: 1.5, bright: 0 }
            : { onset: 0.002, s0: 0.05, s1: 0.45, er: 0, erFrom: 0, erTo: 0, erGain: 0, bright: 0.5 };
      const len = Math.floor(sr * (T * 1.05 + 0.02));
      ir = this.ctx.createBuffer(2, len, sr);
      const k = Math.log(1000) / T; // -60 dB after T seconds
      for (let c = 0; c < 2; c++) {
        const d = ir.getChannelData(c);
        let lp = 0;
        let prev = 0;
        for (let i = 0; i < len; i++) {
          const t = i / sr;
          const n = gauss();
          const x = prof.bright ? n + prof.bright * (n - prev) : n;
          prev = n;
          const s = prof.s0 + (prof.s1 - prof.s0) * Math.min(1, t / T);
          lp += (x - lp) * (1 - s);
          d[i] = lp * (1 - Math.exp(-t / prof.onset)) * Math.exp(-k * t);
        }
        for (let j = 0; j < prof.er; j++) {
          const tt = prof.erFrom + (prof.erTo - prof.erFrom) * rnd();
          const i = Math.floor(tt * sr);
          if (i + 1 >= len) continue;
          const a = prof.erGain * Math.exp(-tt * 18) * (rnd() < 0.5 ? -1 : 1);
          d[i] += a;
          d[i + 1] += a * 0.4;
        }
      }
    }
    // unity energy: broadband wet level == input level
    let e = 0;
    for (let c = 0; c < 2; c++) {
      const d = ir.getChannelData(c);
      for (let i = 0; i < d.length; i++) e += d[i] * d[i];
    }
    const sc = e > 0 ? 1 / Math.sqrt(e / 2) : 0;
    for (let c = 0; c < 2; c++) {
      const d = ir.getChannelData(c);
      for (let i = 0; i < d.length; i++) d[i] *= sc;
    }
    this.conv.buffer = ir;
  }

  private irKeyOf(s: FxState) {
    return `${s.type}|${s.time.toFixed(2)}`;
  }

  // ----------------------------------------------------------------- apply

  apply(f: FxState) {
    const prev = this.cur;
    const s = sanitize(f);
    this.cur = s;
    const t = this.ctx.currentTime;
    const sr = this.ctx.sampleRate;
    const nyq = sr * 0.45;
    const hi = Math.min(s.hiCut, nyq);

    // impulse response (debounced; only when type / time changed)
    if (isReverbish(s.type)) {
      const key = this.irKeyOf(s);
      if (key === this.irKey) {
        clearTimeout(this.irTimer);
        this.pendingKey = '';
      } else if (key !== this.pendingKey) {
        clearTimeout(this.irTimer);
        this.pendingKey = key;
        const quick = !prev || prev.type !== s.type || !this.conv.buffer;
        this.irTimer = window.setTimeout(() => {
          const c = this.cur;
          if (!c || !isReverbish(c.type)) {
            this.pendingKey = '';
            return;
          }
          this.buildIr(c.type, c.time);
          this.irKey = this.irKeyOf(c);
          this.irType = c.type;
          this.pendingKey = '';
          this.gate();
        }, quick ? 0 : 120);
      }
    }

    // shared parameters
    this.predelay.delayTime.setTargetAtTime(s.predelay / 1000, t, 0.02);
    this.revLo.frequency.setTargetAtTime(s.loCut, t, 0.02);
    this.revHi.frequency.setTargetAtTime(hi, t, 0.02);

    const sec = Math.min(2.4, s.time / 1000);
    if (s.type === 'delay-stereo' || s.type === 'delay-mono') this.wireDelay(s.type, t);
    this.dL.delayTime.setTargetAtTime(sec, t, 0.05);
    this.dR.delayTime.setTargetAtTime(this.delayMode === 'delay-mono' ? 0 : sec, t, this.delayMode === 'delay-mono' ? 0.01 : 0.05);
    this.dlyLo.frequency.setTargetAtTime(s.loCut, t, 0.02);
    this.dampL.frequency.setTargetAtTime(hi, t, 0.02);
    this.dampR.frequency.setTargetAtTime(hi, t, 0.02);

    this.modLo.frequency.setTargetAtTime(s.loCut, t, 0.02);
    this.modHi.frequency.setTargetAtTime(hi, t, 0.02);
    for (const k of ['chorus', 'flanger', 'phaser', 'tremolo'] as const) this.lfos[k].setRate(s.rate, t);
    for (const m of this.mods) m.g.gain.setTargetAtTime(m.k(s), t, 0.03);
    for (const g of this.treBase) g.gain.setTargetAtTime(1 - s.depth / 2, t, 0.03);

    this.gate();
  }

  /** Select the active algorithm; everything else gets zero input and output. */
  private gate() {
    const s = this.cur;
    if (!s) return;
    const t = this.ctx.currentTime;
    const ty = s.type;
    const rev = isReverbish(ty);
    const revReady = rev && this.irType === ty; // IR for this type built (else stay muted)
    const dly = ty === 'delay-stereo' || ty === 'delay-mono';
    const set = (p: AudioParam, v: number, tc = 0.02) => p.setTargetAtTime(v, t, tc);

    set(this.revIn.gain, rev ? 1 : 0);
    set(this.revOut.gain, revReady ? 1 : 0, revReady ? 0.02 : 0.008);

    set(this.dlyIn.gain, dly ? 1 : 0);
    set(this.dlyOut.gain, dly ? 1 : 0);
    const fb = dly ? s.feedback : 0;
    set(this.fbL.gain, fb);
    set(this.fbR.gain, fb);

    const wetFb = Math.min(0.9, s.feedback);
    const wetComp = 0.5 * Math.sqrt(1 - wetFb);
    const act = { chorus: ty === 'chorus', flanger: ty === 'flanger', phaser: ty === 'phaser', tremolo: ty === 'tremolo' };
    for (const k of ['chorus', 'flanger', 'phaser', 'tremolo'] as const) {
      set(this.gates[k].gain, act[k] ? 1 : 0);
      set(this.outs[k].gain, act[k] ? 1 : 0);
      if (act[k]) this.lfos[k].start();
    }
    for (const g of this.flFb) set(g.gain, act.flanger ? wetFb : 0);
    for (const g of this.flWet) set(g.gain, wetComp);
    for (const g of this.phFb) set(g.gain, act.phaser ? wetFb : 0);
    for (const g of this.phWet) set(g.gain, wetComp);
  }
}
