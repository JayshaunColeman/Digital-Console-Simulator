// Internal effects rack: algorithmic reverb (convolution with a generated
// impulse response) and stereo / mono delay. Input is the FX bus (mono),
// output is stereo and feeds the matching FX RTN channel.

import type { FxState } from '../model/types';

export class FxRack {
  readonly input: GainNode;
  readonly output: GainNode;
  private predelay: DelayNode;
  private conv: ConvolverNode;
  private revLo: BiquadFilterNode;
  private revHi: BiquadFilterNode;
  private revOut: GainNode;
  private dL: DelayNode;
  private dR: DelayNode;
  private fbL: GainNode;
  private fbR: GainNode;
  private dampL: BiquadFilterNode;
  private dampR: BiquadFilterNode;
  private dlyIn: GainNode;
  private dlyLo: BiquadFilterNode;
  private merge: ChannelMergerNode;
  private dlyOut: GainNode;
  private cur: FxState | null = null;
  private irTimer = 0;

  constructor(private ctx: AudioContext) {
    this.input = ctx.createGain();
    this.input.channelCount = 1;
    this.input.channelCountMode = 'explicit';
    this.output = ctx.createGain();

    // reverb
    this.predelay = ctx.createDelay(0.5);
    this.conv = ctx.createConvolver();
    this.conv.normalize = false;
    this.revLo = ctx.createBiquadFilter();
    this.revLo.type = 'highpass';
    this.revHi = ctx.createBiquadFilter();
    this.revHi.type = 'lowpass';
    this.revOut = ctx.createGain();
    this.input.connect(this.predelay).connect(this.revLo).connect(this.revHi).connect(this.conv).connect(this.revOut);
    this.revOut.connect(this.output);

    // delay (ping-pong capable)
    this.dlyIn = ctx.createGain();
    this.dlyLo = ctx.createBiquadFilter();
    this.dlyLo.type = 'highpass';
    this.dL = ctx.createDelay(2.5);
    this.dR = ctx.createDelay(2.5);
    this.fbL = ctx.createGain();
    this.fbR = ctx.createGain();
    this.dampL = ctx.createBiquadFilter();
    this.dampR = ctx.createBiquadFilter();
    this.dampL.type = this.dampR.type = 'lowpass';
    this.merge = ctx.createChannelMerger(2);
    this.dlyOut = ctx.createGain();
    this.input.connect(this.dlyIn).connect(this.dlyLo).connect(this.dL);
    this.dL.connect(this.dampL).connect(this.fbL);
    this.dR.connect(this.dampR).connect(this.fbR);
    this.dL.connect(this.merge, 0, 0);
    this.dR.connect(this.merge, 0, 1);
    this.merge.connect(this.dlyOut).connect(this.output);
  }

  private buildIr(f: FxState) {
    const sr = this.ctx.sampleRate;
    const plate = f.type === 'reverb-plate';
    const len = Math.max(0.2, f.time) * sr * 1.2;
    const ir = this.ctx.createBuffer(2, Math.floor(len), sr);
    // decay so that the tail falls 60 dB over `time` seconds
    const k = Math.log(1000) / Math.max(0.2, f.time);
    for (let c = 0; c < 2; c++) {
      const d = ir.getChannelData(c);
      let lp = 0;
      const smooth = plate ? 0.15 : 0.45; // plates are brighter / denser
      for (let i = 0; i < d.length; i++) {
        const t = i / sr;
        const n = Math.random() * 2 - 1;
        lp = lp + (n - lp) * (1 - smooth);
        const early = !plate && i < sr * 0.08 && Math.random() < 0.004 ? (Math.random() * 2 - 1) * 2 : 0;
        d[i] = (lp + early) * Math.exp(-k * t) * 0.2;
      }
    }
    this.conv.buffer = ir;
  }

  apply(f: FxState) {
    const prev = this.cur;
    this.cur = { ...f };
    const t = this.ctx.currentTime;
    const isRev = f.type.startsWith('reverb');
    this.revOut.gain.setTargetAtTime(isRev ? 1 : 0, t, 0.02);
    this.dlyOut.gain.setTargetAtTime(isRev ? 0 : 1, t, 0.02);
    this.dlyIn.gain.setTargetAtTime(isRev ? 0 : 1, t, 0.02);
    if (isRev) {
      this.predelay.delayTime.setTargetAtTime(f.predelay / 1000, t, 0.02);
      this.revLo.frequency.setTargetAtTime(f.loCut, t, 0.02);
      this.revHi.frequency.setTargetAtTime(f.hiCut, t, 0.02);
      if (!prev || prev.type !== f.type || prev.time !== f.time || !this.conv.buffer) {
        clearTimeout(this.irTimer);
        this.irTimer = window.setTimeout(() => this.buildIr(f), prev ? 120 : 0);
      }
    } else {
      const sec = Math.min(2.4, f.time / 1000);
      this.dL.delayTime.setTargetAtTime(sec, t, 0.05);
      this.dR.delayTime.setTargetAtTime(sec, t, 0.05);
      this.dlyLo.frequency.setTargetAtTime(f.loCut, t, 0.02);
      this.dampL.frequency.setTargetAtTime(f.hiCut, t, 0.02);
      this.dampR.frequency.setTargetAtTime(f.hiCut, t, 0.02);
      const fb = Math.min(0.95, Math.max(0, f.feedback));
      this.fbL.gain.setTargetAtTime(fb, t, 0.02);
      this.fbR.gain.setTargetAtTime(fb, t, 0.02);
      // rewire feedback topology: stereo = ping-pong L->R->L, mono = L->L and L->R
      if (!prev || prev.type !== f.type) {
        this.fbL.disconnect();
        this.fbR.disconnect();
        if (f.type === 'delay-stereo') {
          this.fbL.connect(this.dR);
          this.fbR.connect(this.dL);
          try {
            this.dL.disconnect(this.dR);
          } catch {
            /* not connected */
          }
        } else {
          this.fbL.connect(this.dL);
          this.dL.connect(this.dR); // mono: right mirrors left (dR is fed, its feedback unused)
          this.dR.delayTime.setTargetAtTime(0, t, 0.01);
        }
      }
      if (f.type === 'delay-mono') this.dR.delayTime.setTargetAtTime(0, t, 0.01);
    }
  }
}
