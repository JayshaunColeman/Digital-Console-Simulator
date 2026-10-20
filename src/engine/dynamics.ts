// Channel / bus dynamics as AudioWorklets:
//   dm3-dyn1  Dynamics 1: gate / ducker. Input 0 is the audio, input 1 an
//             optional external key (key-in).
//   dm3-dyn2  Dynamics 2: feed-forward compressor with soft knee, peak or RMS
//             detection, stereo-linked, optional key-in, no hidden make-up gain.
// Both post their current gain reduction (dB) to the main thread ~40 times a
// second for metering. Loaded from a Blob URL so it works identically in dev
// and production builds.

const SOURCE = `
class Dyn1 extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'threshold', defaultValue: -40, automationRate: 'k-rate' },
      { name: 'range', defaultValue: -60, automationRate: 'k-rate' },
      { name: 'attack', defaultValue: 1, automationRate: 'k-rate' },
      { name: 'hold', defaultValue: 50, automationRate: 'k-rate' },
      { name: 'decay', defaultValue: 150, automationRate: 'k-rate' },
      { name: 'mode', defaultValue: 0, automationRate: 'k-rate' },
      { name: 'ext', defaultValue: 0, automationRate: 'k-rate' },
    ];
  }
  constructor() {
    super();
    this.env = 0; this.g = 1; this.hold = 0; this.active = false; this.t = 0; this.minG = 1;
    this.rel = Math.exp(-1 / (sampleRate * 0.01));
  }
  process(inputs, outputs, p) {
    const inp = inputs[0] || [];
    // external key: an inactive key input has zero channels, i.e. silence
    const key = p.ext[0] > 0.5 ? inputs[1] || [] : inp;
    const out = outputs[0];
    const n = out[0].length;
    const thr = Math.pow(10, p.threshold[0] / 20);
    const thrLow = thr * 0.708; // 3 dB hysteresis
    const floor = Math.pow(10, Math.max(-80, Math.min(0, p.range[0])) / 20);
    const aA = 1 - Math.exp(-1 / (sampleRate * Math.max(0.0001, p.attack[0] / 1000)));
    const aD = 1 - Math.exp(-1 / (sampleRate * Math.max(0.001, p.decay[0] / 1000)));
    const holdN = Math.max(0, p.hold[0] / 1000) * sampleRate;
    const ducker = p.mode[0] > 0.5;
    for (let i = 0; i < n; i++) {
      let k = 0;
      for (let c = 0; c < key.length; c++) { const v = Math.abs(key[c][i]); if (v > k) k = v; }
      this.env = k > this.env ? k : this.env * this.rel;
      if (this.env >= thr) { this.active = true; this.hold = holdN; }
      else if (this.env < (ducker ? thr : thrLow)) { if (this.hold > 0) this.hold--; else this.active = false; }
      let target;
      if (ducker) target = this.active ? floor : 1;
      else target = this.active ? 1 : floor;
      const fast = ducker ? target < this.g : target > this.g;
      this.g += (target - this.g) * (fast ? aA : aD);
      for (let c = 0; c < out.length; c++) out[c][i] = (inp[c] ? inp[c][i] : inp[0] ? inp[0][i] : 0) * this.g;
      if (this.g < this.minG) this.minG = this.g;
    }
    this.t += n;
    if (this.t >= 1024) {
      this.port.postMessage(20 * Math.log10(Math.max(this.minG, 1e-6)));
      this.t = 0; this.minG = 1;
    }
    return true;
  }
}
registerProcessor('dm3-dyn1', Dyn1);

class Dyn2 extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'threshold', defaultValue: -20, automationRate: 'k-rate' },
      { name: 'ratio', defaultValue: 4, automationRate: 'k-rate' },
      { name: 'attack', defaultValue: 10, automationRate: 'k-rate' },
      { name: 'release', defaultValue: 150, automationRate: 'k-rate' },
      { name: 'knee', defaultValue: 2, automationRate: 'k-rate' },
      { name: 'makeup', defaultValue: 0, automationRate: 'k-rate' },
      { name: 'rms', defaultValue: 0, automationRate: 'k-rate' },
      { name: 'ext', defaultValue: 0, automationRate: 'k-rate' },
    ];
  }
  constructor() {
    super();
    this.gs = 0; this.ms = 0; this.env = 0; this.t = 0; this.minG = 0;
    this.msA = Math.exp(-1 / (sampleRate * 0.01)); // 10 ms RMS window
    this.envR = Math.exp(-1 / (sampleRate * 0.03)); // peak detector: instant rise, 30 ms fall
  }
  process(inputs, outputs, p) {
    const inp = inputs[0] || [];
    // key-in: self post-EQ (the audio itself) or an external tap (self pre-EQ)
    const key = p.ext[0] > 0.5 ? inputs[1] || [] : inp;
    const out = outputs[0];
    const n = out[0].length;
    const T = p.threshold[0];
    const R = Math.max(1, p.ratio[0]);
    const W = Math.max(0, p.knee[0]);
    const aA = Math.exp(-1 / (sampleRate * Math.max(0.00002, p.attack[0] / 1000)));
    const aR = Math.exp(-1 / (sampleRate * Math.max(0.001, p.release[0] / 1000)));
    const mk = Math.pow(10, p.makeup[0] / 20);
    const rms = p.rms[0] > 0.5;
    for (let i = 0; i < n; i++) {
      let pk = 0;
      for (let c = 0; c < key.length; c++) { const v = Math.abs(key[c][i]); if (v > pk) pk = v; }
      let lvl;
      if (rms) { this.ms = this.msA * this.ms + (1 - this.msA) * pk * pk; lvl = Math.sqrt(this.ms); }
      else { this.env = pk > this.env ? pk : this.env * this.envR; lvl = this.env; }
      const x = lvl > 1e-6 ? 20 * Math.log10(lvl) : -120;
      // static curve with soft knee (gain computer in dB)
      const d = x - T;
      let gc = 0;
      if (2 * d <= -W) gc = 0;
      else if (W > 0 && 2 * Math.abs(d) <= W) gc = ((1 / R - 1) * (d + W / 2) * (d + W / 2)) / (2 * W);
      else gc = d * (1 / R - 1);
      // reduction moving down uses ATTACK, recovering uses RELEASE
      this.gs = gc < this.gs ? aA * this.gs + (1 - aA) * gc : aR * this.gs + (1 - aR) * gc;
      const g = Math.pow(10, this.gs / 20) * mk;
      for (let c = 0; c < out.length; c++) out[c][i] = (inp[c] ? inp[c][i] : inp[0] ? inp[0][i] : 0) * g;
      if (this.gs < this.minG) this.minG = this.gs;
    }
    this.t += n;
    if (this.t >= 1024) {
      this.port.postMessage(this.minG);
      this.t = 0; this.minG = 0;
    }
    return true;
  }
}
registerProcessor('dm3-dyn2', Dyn2);
`;

let url: string | null = null;

export async function loadDynamics(ctx: AudioContext): Promise<void> {
  if (!url) url = URL.createObjectURL(new Blob([SOURCE], { type: 'application/javascript' }));
  await ctx.audioWorklet.addModule(url);
}

export class DynNode {
  readonly node: AudioWorkletNode;
  gr = 0;

  constructor(ctx: AudioContext, channels: 1 | 2, kind: 'dm3-dyn1' | 'dm3-dyn2') {
    this.node = new AudioWorkletNode(ctx, kind, {
      numberOfInputs: 2,
      numberOfOutputs: 1,
      outputChannelCount: [channels],
      channelCount: channels,
      channelCountMode: 'explicit',
      channelInterpretation: 'speakers',
    });
    this.node.port.onmessage = (e: MessageEvent<number>) => {
      this.gr = e.data;
    };
  }

  param(name: string): AudioParam {
    return this.node.parameters.get(name)!;
  }
}
