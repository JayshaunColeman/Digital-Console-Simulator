// Dynamics 1 (gate / ducker) as an AudioWorklet. Input 0 is the audio,
// input 1 an optional external key (key-in). The processor posts its current
// gain reduction (dB) to the main thread ~40 times a second for metering.
// Loaded from a Blob URL so it works identically in dev and production builds.

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
`;

let url: string | null = null;

export async function loadDyn1(ctx: AudioContext): Promise<void> {
  if (!url) url = URL.createObjectURL(new Blob([SOURCE], { type: 'application/javascript' }));
  await ctx.audioWorklet.addModule(url);
}

export class Dyn1Node {
  readonly node: AudioWorkletNode;
  gr = 0;

  constructor(ctx: AudioContext, channels: 1 | 2) {
    this.node = new AudioWorkletNode(ctx, 'dm3-dyn1', {
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
