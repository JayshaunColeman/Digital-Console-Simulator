// The Web Audio DSP engine. It builds one audio node graph for the console
// model and keeps it in sync with the ConsoleState / RigState. Every route that
// exists in the state exists here as a real audio connection, and nothing
// reaches the browser speakers unless the routing actually carries it there.

import type { BusDef, ChannelDef, CompState, ConsoleModel, ConsoleState, EqBand, RigState } from '../model/types';
import { NEG_INF } from '../model/types';
import { pairKeyOf, pairPartner } from '../model/dm3';
import { clamp, dbToLin } from '../lib/db';
import { MeterHub } from './meters';
import { devicePick, Generator, Microphone, Player, type DeviceOut } from './devices';
import { FxRack } from './fx';
import { anyCue, dcaFor, effectiveFaderDb, governingBusId, muteGroupFor, deviceKind } from './routing';
import { DynNode, loadDynamics } from './dynamics';
import { getFile, putFile } from '../lib/idb';
import { GEQ_FREQS } from '../model/defaults';
import { renderDemoStems, DEMO_STEMS, type StemId } from '../audio/demoStems';

interface Link {
  key: string;
  from: AudioNode;
  to: AudioNode;
  out?: number;
  in?: number;
}

interface PortNodes {
  input: GainNode;
  pad: GainNode; // device electrical level (mic / line) and +48V requirement
  ha: GainNode;
  out: WaveShaperNode;
}

interface Strip {
  eq: BiquadFilterNode[];
  comp: DynamicsCompressorNode;
  makeup: GainNode;
  delay: DelayNode | null; // lazily created
}

interface ChNodes extends Strip {
  def: ChannelDef;
  merger: ChannelMergerNode | null;
  input: GainNode;
  digital: GainNode;
  hpf: BiquadFilterNode;
  gate: DynNode | null; // lazily created
  pre: GainNode;
  on: GainNode;
  fader: GainNode;
  pan: StereoPannerNode;
  toSt: GainNode;
  pfl: GainNode;
  afl: GainNode;
  sends: Map<string, SendNodes>;
}

interface SendNodes {
  gain: GainNode;
  pan?: StereoPannerNode;
  split?: ChannelSplitterNode;
}

interface BusNodes extends Strip {
  def: BusDef;
  input: GainNode;
  pre: GainNode;
  on: GainNode;
  fader: GainNode;
  out: AudioNode; // post master (balance panner for stereo bus)
  bal: StereoPannerNode | null;
  split: ChannelSplitterNode | null;
  pfl: GainNode;
  afl: GainNode;
  mtx: Map<string, SendNodes>;
  geq: BiquadFilterNode[] | null; // lazily created 31-band GEQ
}

const curve = (() => {
  const c = new Float32Array([-1, 1]);
  return c;
})();

export class AudioEngine {
  readonly ctx: AudioContext;
  readonly meters: MeterHub;
  readonly gen: Generator;
  readonly mic: Microphone;
  readonly players: Player[] = [];
  readonly fx: FxRack[] = [];
  stems: Partial<Record<StemId, AudioBuffer>> = {};

  private cache = new Map<AudioParam, number>();
  private groups = new Map<string, Map<string, Link>>();
  private devices = new Map<string, DeviceOut>();
  private ports = new Map<string, PortNodes>();
  private chans = new Map<string, ChNodes>();
  private buses = new Map<string, BusNodes>();
  private psrc = new Map<string, [AudioNode, number]>();
  private outs = new Map<string, { gain: GainNode; dac: WaveShaperNode }>();
  private loops = new Map<string, { delay: DelayNode }>();
  private cueBus: GainNode;
  private cueGain: GainNode;
  private monSrc: GainNode;
  private monLevel: GainNode;
  private monSplit: ChannelSplitterNode;
  private listenMerge: ChannelMergerNode;
  private listenVol: GainNode;
  private limiter: DynamicsCompressorNode;
  private limMakeup: GainNode;
  private ceiling: WaveShaperNode;
  private multi: { merger: ChannelMergerNode; vol: GainNode; ceil: WaveShaperNode; n: number } | null = null;
  private sinkId = '';
  readonly osc: Generator;
  private oscLevel: GainNode;
  private tbIn: GainNode;
  private tbLevel: GainNode;
  workletReady = false;
  private makeupCache = new Map<string, number>();
  private pending = new Set<string>();
  private lastState: ConsoleState | null = null;
  private lastRig: RigState | null = null;

  constructor(readonly model: ConsoleModel) {
    this.ctx = new AudioContext({ latencyHint: 'interactive' });
    this.meters = new MeterHub(this.ctx);
    const ctx = this.ctx;

    // ---- devices
    this.gen = new Generator(ctx);
    this.devices.set('gen', this.gen.dev);
    this.mic = new Microphone(ctx);
    this.devices.set('mic', this.mic.dev);
    for (let i = 0; i < 8; i++) {
      const p = new Player(ctx);
      this.players.push(p);
      this.devices.set(`p${i + 1}`, p.dev);
      this.meters.addTap(`dev.p${i + 1}`, p.dev.out, 2);
    }
    this.meters.addTap('dev.mic', this.mic.dev.out, 1);
    this.meters.addTap('dev.gen', this.gen.dev.out, 1);

    // ---- input ports (head amp + A/D converter, which clips at 0 dBFS)
    for (const p of model.inPorts) {
      const input = this.mono();
      const pad = ctx.createGain();
      const ha = ctx.createGain();
      const out = this.clipper(1);
      input.connect(pad).connect(ha).connect(out);
      this.ports.set(p.id, { input, pad, ha, out });
      this.meters.addTap(`port.${p.id}`, out, 1);
    }

    // ---- buses
    this.cueBus = this.stereo();
    for (const b of model.buses) this.buildBus(b);

    // ---- FX racks
    for (let i = 0; i < model.fxRackCount; i++) {
      const r = new FxRack(ctx);
      this.fx.push(r);
      this.buses.get(`fx${i + 1}`)!.out.connect(r.input);
      this.meters.addTap(`fx.${i + 1}.out`, r.output, 2);
    }

    // ---- channels
    for (const c of model.channels) this.buildChannel(c);

    // ---- talkback + internal oscillator
    this.tbIn = this.mono();
    this.tbLevel = ctx.createGain();
    this.tbIn.connect(this.tbLevel);
    this.osc = new Generator(ctx);
    this.oscLevel = ctx.createGain();
    this.osc.dev.out.connect(this.oscLevel);
    this.meters.addTap('osc', this.oscLevel, 1);
    this.meters.addTap('tb', this.tbLevel, 1);

    // ---- monitor / cue
    this.cueGain = ctx.createGain();
    this.monSrc = this.stereo();
    const monSum = this.stereo();
    this.monLevel = ctx.createGain();
    this.monSplit = ctx.createChannelSplitter(2);
    this.cueBus.connect(this.cueGain).connect(monSum);
    this.monSrc.connect(monSum);
    monSum.connect(this.monLevel).connect(this.monSplit);
    this.psrc.set('mon_l', [this.monSplit, 0]);
    this.psrc.set('mon_r', [this.monSplit, 1]);
    this.meters.addTap('bus.cue', this.cueBus, 2);
    this.meters.addTap('mon', this.monLevel, 2);

    // ---- output ports (D/A converter clips at 0 dBFS)
    for (const p of model.outPorts) {
      const gain = this.mono();
      const dac = this.clipper(1);
      gain.connect(dac);
      this.outs.set(p.id, { gain, dac });
      this.meters.addTap(`out.${p.id}`, dac, 1);
    }

    // ---- browser output: volume -> protective limiter -> hard ceiling
    this.listenMerge = ctx.createChannelMerger(2);
    this.listenVol = this.stereo();
    this.limiter = ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -6;
    this.limiter.knee.value = 0;
    this.limiter.ratio.value = 20;
    this.limiter.attack.value = 0.001;
    this.limiter.release.value = 0.12;
    this.limMakeup = ctx.createGain();
    const ceiling = this.clipper(2, 0.9); // about -0.9 dBFS
    this.ceiling = ceiling;
    this.listenVol.connect(this.limiter).connect(this.limMakeup).connect(ceiling);
    this.wire('dest', [{ key: 'stereo', from: ceiling, to: ctx.destination }]);
    this.meters.addTap('listen', ceiling, 2);
    this.meters.addGr('listen.gr', () => this.limiter.reduction);
    void this.compensate(this.limMakeup, -6, 0, 20, 0);

    this.meters.start();
  }

  // ------------------------------------------------------------ helpers ---

  private mono(): GainNode {
    const g = this.ctx.createGain();
    g.channelCount = 1;
    g.channelCountMode = 'explicit';
    g.channelInterpretation = 'speakers';
    return g;
  }

  private stereo(): GainNode {
    const g = this.ctx.createGain();
    g.channelCount = 2;
    g.channelCountMode = 'explicit';
    g.channelInterpretation = 'speakers';
    return g;
  }

  private clipper(ch: 1 | 2, ceil = 1): WaveShaperNode {
    const w = this.ctx.createWaveShaper();
    w.curve = ceil === 1 ? curve : new Float32Array([-ceil, ceil]);
    w.channelCount = ch;
    w.channelCountMode = 'explicit';
    return w;
  }

  private set(p: AudioParam, v: number, tc = 0.012) {
    if (!Number.isFinite(v)) v = 0;
    if (this.cache.get(p) === v) return;
    const first = !this.cache.has(p);
    this.cache.set(p, v);
    const now = this.ctx.currentTime;
    if (first) {
      p.setValueAtTime(v, now);
      return;
    }
    p.cancelScheduledValues(now);
    p.setTargetAtTime(v, now, tc);
    // an exponential approach never reaches zero: land exactly on 0 so a muted
    // path is truly silent rather than ~-90 dB down
    if (v === 0) p.setValueAtTime(0, now + tc * 6);
  }

  private wire(group: string, links: Link[]) {
    const cur = this.groups.get(group) ?? new Map<string, Link>();
    const next = new Map(links.map((l) => [l.key, l] as const));
    for (const [k, l] of cur) {
      if (!next.has(k)) {
        try {
          l.from.disconnect(l.to, l.out ?? 0, l.in ?? 0);
        } catch {
          /* already disconnected */
        }
      }
    }
    for (const [k, l] of next) if (!cur.has(k)) l.from.connect(l.to, l.out ?? 0, l.in ?? 0);
    this.groups.set(group, next);
  }

  private makeStrip(nch: 1 | 2): Strip {
    const eq = [0, 1, 2, 3].map(() => {
      const f = this.ctx.createBiquadFilter();
      f.channelCount = nch;
      f.channelCountMode = 'explicit';
      return f;
    });
    const comp = this.ctx.createDynamicsCompressor();
    comp.channelCount = nch;
    comp.channelCountMode = 'explicit';
    const makeup = this.ctx.createGain();
    comp.connect(makeup);
    return { eq, comp, makeup, delay: null };
  }

  private ensureDelay(s: Strip, nch: 1 | 2): DelayNode {
    if (!s.delay) {
      s.delay = this.ctx.createDelay(1.0);
      s.delay.channelCount = nch;
      s.delay.channelCountMode = 'explicit';
    }
    return s.delay;
  }

  /** Links for start -> each active stage in order -> end (bypassed stages are left out). */
  private chainLinks(prefix: string, start: AudioNode, nodes: [string, AudioNode, AudioNode][], end: AudioNode): Link[] {
    const links: Link[] = [];
    let prevKey = 'start';
    let prev: AudioNode = start;
    for (const [k, inNode, outNode] of nodes) {
      links.push({ key: `${prefix}:${prevKey}>${k}`, from: prev, to: inNode });
      prevKey = k;
      prev = outNode;
    }
    links.push({ key: `${prefix}:${prevKey}>end`, from: prev, to: end });
    return links;
  }

  private applyEq(s: Strip, bands: EqBand[]) {
    bands.forEach((b, i) => {
      const f = s.eq[i];
      const type: BiquadFilterType = b.type === 'peak' ? 'peaking' : b.type;
      if (f.type !== type) f.type = type;
      this.set(f.frequency, clamp(b.freq, 20, 20000));
      this.set(f.gain, clamp(b.gain, -18, 18));
      this.set(f.Q, clamp(b.q, 0.1, 16));
    });
  }

  private applyComp(s: Strip, c: CompState) {
    this.set(s.comp.threshold, clamp(c.threshold, -60, 0));
    this.set(s.comp.ratio, clamp(c.ratio, 1, 20));
    this.set(s.comp.knee, clamp(c.knee, 0, 40));
    this.set(s.comp.attack, clamp(c.attack, 0, 1000) / 1000);
    this.set(s.comp.release, clamp(c.release, 10, 1000) / 1000);
    void this.compensate(s.makeup, c.threshold, c.knee, c.ratio, c.makeup);
  }

  /**
   * DynamicsCompressorNode applies an automatic make-up gain that depends on
   * threshold/knee/ratio. Real console compressors do not, so we measure it once
   * per setting (offline render of a signal far below threshold) and divide it
   * out, leaving only the user's MAKEUP control.
   */
  private async compensate(node: GainNode, threshold: number, knee: number, ratio: number, makeupDb: number) {
    const key = `${threshold}|${knee}|${ratio}`;
    let auto = this.makeupCache.get(key);
    if (auto === undefined) {
      const pkey = `${key}|${makeupDb}`;
      if (this.pending.has(pkey)) return;
      this.pending.add(pkey);
      try {
        const off = new OfflineAudioContext(1, 4096, 8000);
        const src = off.createConstantSource();
        src.offset.value = 1e-4;
        const c = off.createDynamicsCompressor();
        c.threshold.value = clamp(threshold, -60, 0);
        c.knee.value = clamp(knee, 0, 40);
        c.ratio.value = clamp(ratio, 1, 20);
        src.connect(c).connect(off.destination);
        src.start();
        const buf = await off.startRendering();
        const d = buf.getChannelData(0);
        auto = d[d.length - 1] / 1e-4;
        if (!Number.isFinite(auto) || auto <= 0) auto = 1;
      } catch {
        auto = 1;
      }
      this.makeupCache.set(key, auto);
      this.pending.delete(pkey);
    }
    this.set(node.gain, dbToLin(makeupDb) / auto);
  }

  // ----------------------------------------------------------- building ---

  private buildChannel(c: ChannelDef) {
    const ctx = this.ctx;
    const nch: 1 | 2 = c.kind === 'mono' ? 1 : 2;
    const input = nch === 1 ? this.mono() : this.stereo();
    const merger = c.kind === 'stereo' ? ctx.createChannelMerger(2) : null;
    if (merger) merger.connect(input);
    const digital = ctx.createGain();
    const hpf = ctx.createBiquadFilter();
    hpf.type = 'highpass';
    hpf.Q.value = Math.SQRT1_2;
    hpf.channelCount = nch;
    hpf.channelCountMode = 'explicit';
    const strip = this.makeStrip(nch);
    const pre = ctx.createGain();
    const on = ctx.createGain();
    const fader = ctx.createGain();
    const pan = ctx.createStereoPanner();
    const toSt = ctx.createGain();
    const pfl = ctx.createGain();
    const afl = ctx.createGain();
    input.connect(digital);
    pre.connect(on).connect(fader).connect(pan).connect(toSt).connect(this.buses.get('st')!.input);
    pre.connect(pfl).connect(this.cueBus);
    pan.connect(afl).connect(this.cueBus);
    if (c.kind === 'fxreturn') this.fx[c.fxRack! - 1].output.connect(input);
    const n: ChNodes = { def: c, merger, input, digital, hpf, gate: null, pre, on, fader, pan, toSt, pfl, afl, sends: new Map(), ...strip };
    this.chans.set(c.id, n);
    this.meters.addTap(`ch.${c.id}.in`, digital, nch);
    this.meters.addTap(`ch.${c.id}.pre`, pre, nch);
    this.meters.addTap(`ch.${c.id}.post`, fader, nch);
    this.meters.addGr(`ch.${c.id}.gr`, () => strip.comp.reduction);
    this.meters.addGr(`ch.${c.id}.gate`, () => n.gate?.gr ?? 0);
    if (c.kind === 'mono') this.psrc.set(`dir_${c.id}`, [on, 0]);
  }

  private buildBus(b: BusDef) {
    const ctx = this.ctx;
    const nch: 1 | 2 = b.kind === 'stereo' ? 2 : 1;
    const input = nch === 1 ? this.mono() : this.stereo();
    const strip = this.makeStrip(nch);
    const pre = ctx.createGain();
    const on = ctx.createGain();
    const fader = ctx.createGain();
    const pfl = ctx.createGain();
    const afl = ctx.createGain();
    let out: AudioNode = fader;
    let bal: StereoPannerNode | null = null;
    let split: ChannelSplitterNode | null = null;
    pre.connect(on).connect(fader);
    if (b.kind === 'stereo') {
      bal = ctx.createStereoPanner();
      fader.connect(bal);
      out = bal;
      split = ctx.createChannelSplitter(2);
      bal.connect(split);
      this.psrc.set('st_l', [split, 0]);
      this.psrc.set('st_r', [split, 1]);
    } else if (b.kind === 'mix' || b.kind === 'matrix') {
      this.psrc.set(b.id, [fader, 0]);
    }
    input.connect(pfl).connect(this.cueBus);
    out.connect(afl).connect(this.cueBus);
    this.buses.set(b.id, { def: b, input, pre, on, fader, out, bal, split, pfl, afl, mtx: new Map(), geq: null, ...strip });
    this.meters.addTap(`bus.${b.id}.in`, input, nch);
    this.meters.addTap(`bus.${b.id}.out`, out, nch);
    this.meters.addGr(`bus.${b.id}.gr`, () => strip.comp.reduction);
  }

  // -------------------------------------------------------------- sync ----

  sync(state: ConsoleState, rig: RigState) {
    this.lastState = state;
    this.lastRig = rig;
    const m = this.model;

    // devices
    this.gen.apply(rig.generator);
    rig.players.forEach((p, i) => this.players[i]?.apply(p));
    this.mic.setLevel(rig.micLevel);

    // input ports + what is plugged into them
    for (const p of m.inPorts) {
      const pn = this.ports.get(p.id)!;
      const gain = p.hasPreamp ? clamp(state.ports[p.id]?.gain ?? 0, m.haGainRange[0], m.haGainRange[1]) : 0;
      this.set(pn.ha.gain, dbToLin(gain));
      const plug = rig.plugs[p.id];
      // device electrical behaviour: mic-level sources are ~30 dB below line level,
      // condenser mics output nothing without +48V phantom power
      let pad = 0;
      if (plug && !plug.device.startsWith('loop:')) {
        const kind = deviceKind(rig, plug.device);
        const off = plug.device === 'mic' ? 0 : kind === 'dynamic' ? -30 : kind === 'condenser' ? -24 : 0;
        pad = kind === 'condenser' && !state.ports[p.id]?.phantom ? NEG_INF : off;
      }
      this.set(pn.pad.gain, dbToLin(pad));
      const links: Link[] = [];
      if (plug) {
        const loop = /^loop:(.+)$/.exec(plug.device);
        if (loop) {
          const o = this.outs.get(loop[1]);
          if (o) {
            let l = this.loops.get(p.id);
            if (!l) {
              // a cable from an output back to an input: the DelayNode is required
              // by Web Audio for cycles and also models cable + converter latency
              l = { delay: this.ctx.createDelay(0.1) };
              l.delay.delayTime.value = 0.02;
              this.loops.set(p.id, l);
            }
            links.push({ key: `loop:${loop[1]}`, from: o.dac, to: l.delay });
            links.push({ key: 'loopd', from: l.delay, to: pn.input });
          }
        } else {
          const dev = this.devices.get(plug.device);
          if (dev) {
            const [node, idx] = devicePick(dev, plug.ch);
            links.push({ key: `${plug.device}:${plug.ch}`, from: node, to: pn.input, out: idx });
          }
        }
      }
      this.wire(`plug:${p.id}`, links);
    }

    // channels
    for (const c of m.channels) this.syncChannel(c, state);

    // buses
    for (const b of m.buses) this.syncBus(b, state);

    // FX
    state.fx.forEach((f, i) => this.fx[i]?.apply(f));

    // talkback + oscillator
    const tb = state.talkback;
    const tbPort = tb.source ? this.ports.get(tb.source) : undefined;
    this.wire('tbsrc', tbPort ? [{ key: tb.source!, from: tbPort.out, to: this.tbIn }] : []);
    this.set(this.tbLevel.gain, tb.on ? dbToLin(tb.level) : 0);
    this.wire('tbassign', tb.assign.filter((b) => this.buses.has(b)).map((b) => ({ key: b, from: this.tbLevel, to: this.buses.get(b)!.input })));
    const osc = state.osc;
    this.osc.apply({ type: osc.type, freq: osc.freq, level: osc.level, on: osc.on });
    this.set(this.oscLevel.gain, osc.on ? 1 : 0);
    this.wire('oscassign', osc.assign.filter((b) => this.buses.has(b)).map((b) => ({ key: b, from: this.oscLevel, to: this.buses.get(b)!.input })));

    // monitor + cue
    const cueing = anyCue(state);
    this.set(this.cueGain.gain, cueing ? 1 : 0);
    const monBus = this.buses.get(state.monitor.source) ?? this.buses.get('st')!;
    this.wire('monsrc', cueing ? [] : [{ key: `mon:${state.monitor.source}`, from: monBus.out, to: this.monSrc }]);
    this.set(this.monLevel.gain, dbToLin(state.monitor.level));

    // output patch
    for (const p of m.outPorts) {
      const o = this.outs.get(p.id)!;
      const op = state.outPorts[p.id];
      this.set(o.gain.gain, dbToLin(Math.min(0, op?.att ?? 0)));
      const src = op?.source ? this.psrc.get(op.source) : undefined;
      this.wire(`outpatch:${p.id}`, src ? [{ key: op!.source!, from: src[0], to: o.gain, out: src[1] }] : []);
    }

    // browser listening position
    const L = rig.listen;
    const links: Link[] = [];
    if (L.mode === 'phones') {
      links.push({ key: 'phones', from: this.monLevel, to: this.listenVol });
    } else {
      links.push({ key: 'merge', from: this.listenMerge, to: this.listenVol });
      if (L.l && this.outs.has(L.l)) links.push({ key: `l:${L.l}`, from: this.outs.get(L.l)!.dac, to: this.listenMerge, in: 0 });
      if (L.r && this.outs.has(L.r)) links.push({ key: `r:${L.r}`, from: this.outs.get(L.r)!.dac, to: this.listenMerge, in: 1 });
    }
    this.wire('listen', links);
    this.set(this.listenVol.gain, dbToLin(Math.min(6, L.volume)));
    this.syncOutputDevice(rig);
  }

  /** Browser output device + optional multichannel mode (OMNI n -> device output n). */
  private syncOutputDevice(rig: RigState) {
    const o = rig.output ?? { sinkId: '', mode: 'stereo' };
    const ctxSink = this.ctx as AudioContext & { setSinkId?: (id: string) => Promise<void> };
    if (o.sinkId !== this.sinkId && ctxSink.setSinkId) {
      this.sinkId = o.sinkId;
      ctxSink.setSinkId(o.sinkId).catch(() => {
        this.outputError = 'Could not switch to that audio output device.';
      });
    }
    const max = this.ctx.destination.maxChannelCount;
    if (o.mode === 'multi' && max > 2) {
      if (!this.multi || this.multi.n !== max) {
        const n = Math.min(32, max);
        this.ctx.destination.channelCount = n;
        this.ctx.destination.channelCountMode = 'explicit';
        this.ctx.destination.channelInterpretation = 'discrete';
        const merger = this.ctx.createChannelMerger(n);
        const vol = this.ctx.createGain();
        vol.channelCount = n;
        vol.channelCountMode = 'explicit';
        vol.channelInterpretation = 'discrete';
        const ceil = this.ctx.createWaveShaper();
        ceil.curve = new Float32Array([-0.9, 0.9]);
        ceil.channelCount = n;
        ceil.channelCountMode = 'explicit';
        ceil.channelInterpretation = 'discrete';
        merger.connect(vol).connect(ceil);
        this.multi = { merger, vol, ceil, n };
      }
      const m = this.multi;
      this.set(m.vol.gain, dbToLin(Math.min(6, rig.listen.volume)));
      const omni = this.model.outPorts.filter((p) => p.group === 'analog').slice(0, m.n);
      this.wire(
        'multi',
        omni.map((p, i) => ({ key: p.id, from: this.outs.get(p.id)!.dac, to: m.merger, in: i })),
      );
      this.wire('dest', [{ key: 'multi', from: m.ceil, to: this.ctx.destination }]);
    } else {
      if (this.ctx.destination.channelCount !== 2) {
        this.ctx.destination.channelCount = 2;
        this.ctx.destination.channelInterpretation = 'speakers';
      }
      this.wire('multi', []);
      this.wire('dest', [{ key: 'stereo', from: this.ceiling, to: this.ctx.destination }]);
    }
  }

  outputError = '';

  private syncChannel(c: ChannelDef, state: ConsoleState) {
    const n = this.chans.get(c.id)!;
    const ch = state.channels[c.id];
    // input patch
    const links: Link[] = [];
    if (c.kind === 'mono' && ch.patchL && this.ports.has(ch.patchL)) {
      links.push({ key: ch.patchL, from: this.ports.get(ch.patchL)!.out, to: n.input });
    } else if (c.kind === 'stereo') {
      if (ch.patchL && this.ports.has(ch.patchL)) links.push({ key: `L:${ch.patchL}`, from: this.ports.get(ch.patchL)!.out, to: n.merger!, in: 0 });
      if (ch.patchR && this.ports.has(ch.patchR)) links.push({ key: `R:${ch.patchR}`, from: this.ports.get(ch.patchR)!.out, to: n.merger!, in: 1 });
    }
    this.wire(`inpatch:${c.id}`, links);

    // processing
    this.set(n.digital.gain, dbToLin(clamp(ch.digitalGain, -96, 24)) * (ch.polarity ? -1 : 1));
    this.set(n.hpf.frequency, clamp(ch.hpfFreq, 20, 600));
    this.applyEq(n, ch.eq);
    this.applyComp(n, ch.comp);
    const nch: 1 | 2 = c.kind === 'mono' ? 1 : 2;
    const stages: [string, AudioNode, AudioNode][] = [];
    if (ch.hpfOn) stages.push(['hpf', n.hpf, n.hpf]);
    if (ch.eqOn) n.eq.forEach((f, i) => stages.push([`eq${i}`, f, f]));
    if (ch.gate.on && this.workletReady) {
      if (!n.gate) n.gate = new DynNode(this.ctx, nch, 'dm3-dyn1');
      const g = ch.gate;
      this.set(n.gate.param('threshold'), clamp(g.threshold, -72, 0));
      this.set(n.gate.param('range'), clamp(g.range, -80, 0));
      this.set(n.gate.param('attack'), clamp(g.attack, 0, 120));
      this.set(n.gate.param('hold'), clamp(g.hold, 0, 2000));
      this.set(n.gate.param('decay'), clamp(g.decay, 5, 4000));
      this.set(n.gate.param('mode'), g.mode === 'ducker' ? 1 : 0);
      const keyCh = g.key !== 'self' && g.key !== c.id ? this.chans.get(g.key) : undefined;
      this.set(n.gate.param('ext'), keyCh ? 1 : 0);
      this.wire(`key:${c.id}`, keyCh ? [{ key: g.key, from: keyCh.digital, to: n.gate.node, in: 1 }] : []);
      stages.push(['gate', n.gate.node, n.gate.node]);
    } else if (n.gate) {
      this.wire(`key:${c.id}`, []);
      n.gate.gr = 0;
    }
    if (ch.comp.on) stages.push(['comp', n.comp, n.makeup]);
    if (ch.delayOn) {
      const d = this.ensureDelay(n, nch);
      this.set(d.delayTime, clamp(ch.delayMs, 0, 1000) / 1000, 0.03);
      stages.push(['dly', d, d]);
    }
    this.wire(`chain:${c.id}`, this.chainLinks('c', n.digital, stages, n.pre));

    // ON, fader (incl. DCA), pan, ST assign, cue
    const dca = dcaFor(state, c.id);
    this.set(n.on.gain, ch.on && !dca.muted ? 1 : 0);
    this.set(n.fader.gain, dbToLin(effectiveFaderDb(state, c.id)));
    this.set(n.pan.pan, clamp(ch.pan / 63, -1, 1));
    this.set(n.toSt.gain, ch.toSt ? 1 : 0);
    this.set(n.pfl.gain, ch.cue && state.monitor.cueMode === 'PFL' ? 1 : 0);
    this.set(n.afl.gain, ch.cue && state.monitor.cueMode === 'AFL' ? 1 : 0);

    // sends to mix + fx buses
    for (const b of this.model.buses) {
      if (b.kind === 'fx') this.syncSend(n, ch.sends[b.id], `${c.id}:${b.id}`, b.id, [b.id]);
    }
    for (const b of this.model.buses) {
      if (b.kind !== 'mix') continue;
      const pk = pairKeyOf(b.id)!;
      const linked = state.pairLinked[pk];
      const pp = pairPartner(b.id)!;
      if (linked) {
        if (b.id === pp.left) this.syncSend(n, ch.sends[pp.left], `${c.id}:${b.id}`, b.id, [pp.left, pp.right]);
        else this.syncSend(n, undefined, `${c.id}:${b.id}`, b.id, []);
      } else {
        this.syncSend(n, ch.sends[b.id], `${c.id}:${b.id}`, b.id, [b.id]);
      }
    }
    // input channel -> matrix sends
    for (const b of this.model.buses) {
      if (b.kind !== 'matrix') continue;
      const pp = pairPartner(b.id)!;
      if (state.pairLinked[pairKeyOf(b.id)!]) {
        if (b.id === pp.left) this.syncSend(n, ch.sends[pp.left], `${c.id}:${b.id}`, b.id, [pp.left, pp.right]);
        else this.syncSend(n, undefined, `${c.id}:${b.id}`, b.id, []);
      } else this.syncSend(n, ch.sends[b.id], `${c.id}:${b.id}`, b.id, [b.id]);
    }
  }

  private syncSend(
    n: ChNodes,
    s: { on: boolean; level: number; pre: boolean; pan: number } | undefined,
    group: string,
    key: string,
    targets: string[],
  ) {
    const g = s && s.on && targets.length ? dbToLin(s.level) : 0;
    let sn = n.sends.get(key);
    if (!sn) {
      if (g === 0) {
        this.wire(`send:${group}`, []);
        return;
      }
      sn = { gain: this.ctx.createGain() };
      n.sends.set(key, sn);
    }
    this.set(sn.gain.gain, g);
    const links: Link[] = [];
    if (s && targets.length) {
      links.push({ key: s.pre ? 'pre' : 'post', from: s.pre ? n.on : n.fader, to: sn.gain });
      if (targets.length === 2) {
        if (!sn.pan) {
          sn.pan = this.ctx.createStereoPanner();
          sn.split = this.ctx.createChannelSplitter(2);
          sn.pan.connect(sn.split);
        }
        this.set(sn.pan.pan, clamp(s.pan / 63, -1, 1));
        links.push({ key: 'g>pan', from: sn.gain, to: sn.pan });
        links.push({ key: `L:${targets[0]}`, from: sn.split!, to: this.buses.get(targets[0])!.input, out: 0 });
        links.push({ key: `R:${targets[1]}`, from: sn.split!, to: this.buses.get(targets[1])!.input, out: 1 });
      } else {
        links.push({ key: `M:${targets[0]}`, from: sn.gain, to: this.buses.get(targets[0])!.input });
      }
    }
    this.wire(`send:${group}`, links);
  }

  private syncBus(b: BusDef, state: ConsoleState) {
    const n = this.buses.get(b.id)!;
    const gov = b.kind === 'mix' || b.kind === 'matrix' ? governingBusId(state, b.id) : b.id;
    const bs = state.buses[gov];
    if (b.kind === 'fx') {
      this.wire(`chain:${b.id}`, [{ key: 'in>pre', from: n.input, to: n.pre }]);
    } else {
      this.applyEq(n, bs.eq);
      this.applyComp(n, bs.comp);
      const nch: 1 | 2 = b.kind === 'stereo' ? 2 : 1;
      const stages: [string, AudioNode, AudioNode][] = [];
      if (bs.eqOn) n.eq.forEach((f, i) => stages.push([`eq${i}`, f, f]));
      if (bs.comp.on) stages.push(['comp', n.comp, n.makeup]);
      if (bs.geqOn && this.model.geqBuses.includes(gov)) {
        if (!n.geq) {
          n.geq = GEQ_FREQS.map((f) => {
            const q = this.ctx.createBiquadFilter();
            q.type = 'peaking';
            q.frequency.value = f;
            q.Q.value = 4.32; // 1/3 octave
            q.channelCount = nch;
            q.channelCountMode = 'explicit';
            return q;
          });
        }
        n.geq.forEach((q, i) => {
          this.set(q.gain, clamp(bs.geq[i] ?? 0, -15, 15));
          stages.push([`geq${i}`, q, q]);
        });
      }
      if (bs.delayOn) {
        const d = this.ensureDelay(n, nch);
        this.set(d.delayTime, clamp(bs.delayMs, 0, 1000) / 1000, 0.03);
        stages.push(['dly', d, d]);
      }
      this.wire(`chain:${b.id}`, this.chainLinks('b', n.input, stages, n.pre));
    }
    this.set(n.on.gain, bs.on && !muteGroupFor(state, bs.muteGroups) ? 1 : 0);
    this.set(n.fader.gain, dbToLin(bs.fader));
    if (n.bal) this.set(n.bal.pan, clamp(bs.balance / 63, -1, 1));
    const own = state.buses[b.id];
    this.set(n.pfl.gain, own.cue && state.monitor.cueMode === 'PFL' ? 1 : 0);
    this.set(n.afl.gain, own.cue && state.monitor.cueMode === 'AFL' ? 1 : 0);

    // matrix sends (from stereo + mix buses)
    if (b.kind !== 'stereo' && b.kind !== 'mix') return;
    const mixSide: 'L' | 'R' | 'M' =
      b.kind === 'mix' && gov !== b.id ? 'R' : b.kind === 'mix' && state.pairLinked[pairKeyOf(b.id)!] ? 'L' : 'M';
    for (const mb of this.model.buses) {
      if (mb.kind !== 'matrix') continue;
      const linked = state.pairLinked[pairKeyOf(mb.id)!];
      const pp = pairPartner(mb.id)!;
      const group = `mtx:${b.id}:${mb.id}`;
      if (linked && mb.id !== pp.left) {
        this.wire(group, []);
        continue;
      }
      const ms = bs.mtxSends[linked ? pp.left : mb.id];
      const g = ms && ms.on ? dbToLin(ms.level) : 0;
      let sn = n.mtx.get(mb.id);
      if (!sn) {
        if (g === 0) {
          this.wire(group, []);
          continue;
        }
        sn = { gain: b.kind === 'stereo' ? this.stereo() : this.mono() };
        n.mtx.set(mb.id, sn);
      }
      this.set(sn.gain.gain, g);
      const links: Link[] = [{ key: 'src', from: n.out, to: sn.gain }];
      const L = this.buses.get(linked ? pp.left : mb.id)!.input;
      const R = this.buses.get(linked ? pp.right : mb.id)!.input;
      if (!linked) links.push({ key: 'M', from: sn.gain, to: L });
      else if (b.kind === 'stereo') {
        if (!sn.split) {
          sn.split = this.ctx.createChannelSplitter(2);
          sn.gain.connect(sn.split);
        }
        links.push({ key: 'L', from: sn.split, to: L, out: 0 });
        links.push({ key: 'R', from: sn.split, to: R, out: 1 });
      } else {
        if (mixSide !== 'R') links.push({ key: 'L', from: sn.gain, to: L });
        if (mixSide !== 'L') links.push({ key: 'R', from: sn.gain, to: R });
      }
      this.wire(group, links);
    }
  }

  // --------------------------------------------------------- transport ----

  async resume() {
    if (this.ctx.state !== 'running') await this.ctx.resume();
  }

  /** Load the gate/ducker worklet; until then Dynamics 1 is treated as bypassed. */
  async loadWorklets(): Promise<void> {
    try {
      await loadDynamics(this.ctx);
      this.workletReady = true;
      if (this.lastState && this.lastRig) this.sync(this.lastState, this.lastRig);
    } catch {
      this.workletReady = false;
    }
  }

  async loadStems(): Promise<void> {
    if (Object.keys(this.stems).length) return;
    this.stems = await renderDemoStems(this.ctx.sampleRate);
    if (this.lastRig) this.assignPlayerBuffers(this.lastRig);
  }

  assignPlayerBuffers(rig: RigState) {
    rig.players.forEach((p, i) => {
      const pl = this.players[i];
      if (p.source === 'stem' && p.stem) {
        const b = this.stems[p.stem as StemId] ?? null;
        if (pl.buffer !== b) pl.setBuffer(b, DEMO_STEMS.find((s) => s.id === p.stem)?.name);
      } else if (p.source === 'none' && pl.buffer) pl.setBuffer(null);
    });
  }

  async loadFile(index: number, file: File): Promise<void> {
    const data = await file.arrayBuffer();
    await this.loadData(index, file.name, data.slice(0));
    void putFile(`player${index}`, { name: file.name, data });
  }

  async loadData(index: number, name: string, data: ArrayBuffer): Promise<void> {
    let buf: AudioBuffer;
    try {
      buf = await this.ctx.decodeAudioData(data);
    } catch {
      throw new Error(
        `"${name}" could not be decoded. This browser supports WAV, MP3, OGG/Opus, AAC/M4A or FLAC depending on platform; try converting the file to WAV or MP3.`,
      );
    }
    this.players[index].setBuffer(buf, name);
  }

  /** Reload user files saved in IndexedDB for players set to 'file'. */
  async restoreFiles(rig: RigState): Promise<string[]> {
    const restored: string[] = [];
    for (let i = 0; i < rig.players.length; i++) {
      if (rig.players[i].source !== 'file' || this.players[i].buffer) continue;
      const f = await getFile(`player${i}`);
      if (!f) continue;
      try {
        await this.loadData(i, f.name, f.data);
        restored.push(f.name);
      } catch {
        /* undecodable: leave empty */
      }
    }
    return restored;
  }

  /** Start every loaded player in sample-accurate sync (demo multitrack). */
  playAll() {
    const t = this.ctx.currentTime + 0.05;
    for (const p of this.players) if (p.buffer) p.play(t, 0);
  }

  stopAll() {
    for (const p of this.players) p.stop();
  }

  get state(): ConsoleState | null {
    return this.lastState;
  }

  /** Current nominal level helper used by training checks. */
  peak(tap: string): number {
    return this.meters.peakNow(tap);
  }

  /** Max peak over a time window (ms), sampled from the live analysers. */
  async measure(tap: string, ms = 400): Promise<number> {
    let max = NEG_INF;
    const end = performance.now() + ms;
    while (performance.now() < end) {
      max = Math.max(max, this.meters.peakNow(tap));
      await new Promise((r) => setTimeout(r, 30));
    }
    return max;
  }
}
