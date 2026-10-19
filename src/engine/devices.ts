// Sound sources that can be "plugged into" the console's input sockets:
// browser microphone, 8 file/stem players and a test-signal generator.

import type { GeneratorState, PlayerState } from '../model/types';
import { dbToLin } from '../lib/db';

export interface DeviceOut {
  out: GainNode; // full device output (1 or 2 channels)
  split: ChannelSplitterNode; // L/R picks
  sum: GainNode; // mono sum (speakers downmix)
}

function makeDeviceOut(ctx: AudioContext): DeviceOut {
  const out = ctx.createGain();
  const split = ctx.createChannelSplitter(2);
  const sum = ctx.createGain();
  sum.channelCount = 1;
  sum.channelCountMode = 'explicit';
  sum.channelInterpretation = 'speakers';
  out.connect(split);
  out.connect(sum);
  return { out, split, sum };
}

/** Pick the node+output index a plug should take from a device. */
export function devicePick(d: DeviceOut, ch: 'L' | 'R' | 'SUM'): [AudioNode, number] {
  if (ch === 'SUM') return [d.sum, 0];
  return [d.split, ch === 'L' ? 0 : 1];
}

// ------------------------------------------------------------ generator ----

export class Generator {
  readonly dev: DeviceOut;
  private level: GainNode;
  private src: AudioScheduledSourceNode | null = null;
  private osc: OscillatorNode | null = null;
  private cur: GeneratorState | null = null;
  private buffers = new Map<string, AudioBuffer>();

  constructor(private ctx: AudioContext) {
    this.dev = makeDeviceOut(ctx);
    this.level = ctx.createGain();
    this.level.gain.value = 0;
    this.level.connect(this.dev.out);
  }

  private buffer(type: 'white' | 'pink' | 'impulse' | 'sweep' | 'burst'): AudioBuffer {
    const hit = this.buffers.get(type);
    if (hit) return hit;
    const sr = this.ctx.sampleRate;
    if (type === 'burst') {
      // burst noise: 250 ms of pink noise, 750 ms of silence
      const pink = this.buffer('pink').getChannelData(0);
      const b = this.ctx.createBuffer(1, sr, sr);
      const d = b.getChannelData(0);
      const on = Math.floor(sr * 0.25);
      for (let i = 0; i < on; i++) d[i] = pink[i] * Math.min(1, i / 64, (on - i) / 64);
      this.buffers.set(type, b);
      return b;
    }
    const len = type === 'sweep' ? sr * 6 : type === 'impulse' ? sr : sr * 4;
    const b = this.ctx.createBuffer(1, len, sr);
    const d = b.getChannelData(0);
    if (type === 'white') {
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    } else if (type === 'pink') {
      // Paul Kellet's refined pink noise filter
      let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
      let peak = 0;
      for (let i = 0; i < len; i++) {
        const w = Math.random() * 2 - 1;
        b0 = 0.99886 * b0 + w * 0.0555179;
        b1 = 0.99332 * b1 + w * 0.0750759;
        b2 = 0.969 * b2 + w * 0.153852;
        b3 = 0.8665 * b3 + w * 0.3104856;
        b4 = 0.55 * b4 + w * 0.5329522;
        b5 = -0.7616 * b5 - w * 0.016898;
        d[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362;
        b6 = w * 0.115926;
        peak = Math.max(peak, Math.abs(d[i]));
      }
      for (let i = 0; i < len; i++) d[i] /= peak;
    } else if (type === 'impulse') {
      d[0] = 1; // one click per second
    } else {
      // logarithmic sweep 20 Hz -> 20 kHz over 5 s, then 1 s silence
      const T = 5;
      const f0 = 20, f1 = 20000;
      const k = Math.log(f1 / f0);
      for (let i = 0; i < sr * T; i++) {
        const t = i / sr;
        const ph = ((2 * Math.PI * f0 * T) / k) * (Math.exp((t / T) * k) - 1);
        const env = Math.min(1, t * 50, (T - t) * 50);
        d[i] = Math.sin(ph) * env;
      }
    }
    this.buffers.set(type, b);
    return b;
  }

  apply(g: GeneratorState) {
    const prev = this.cur;
    this.cur = { ...g };
    const t = this.ctx.currentTime;
    this.level.gain.setTargetAtTime(g.on ? dbToLin(g.level) : 0, t, 0.01);
    if (prev && prev.type === g.type && this.src) {
      if (this.osc && prev.freq !== g.freq) this.osc.frequency.setTargetAtTime(g.freq, t, 0.01);
      return;
    }
    if (this.src) {
      this.src.stop();
      this.src.disconnect();
      this.src = null;
      this.osc = null;
    }
    if (g.type === 'sine') {
      const o = this.ctx.createOscillator();
      o.frequency.value = g.freq;
      this.osc = o;
      this.src = o;
    } else {
      const s = this.ctx.createBufferSource();
      s.buffer = this.buffer(g.type);
      s.loop = true;
      this.src = s;
    }
    this.src.connect(this.level);
    this.src.start();
  }
}

// --------------------------------------------------------------- players ----

export interface PlayerRuntime {
  playing: boolean;
  duration: number;
  position: number;
  fileName?: string;
}

export class Player {
  readonly dev: DeviceOut;
  private level: GainNode;
  buffer: AudioBuffer | null = null;
  private node: AudioBufferSourceNode | null = null;
  private startedAt = 0; // ctx time corresponding to buffer offset 0
  private pausedAt = 0;
  playing = false;
  loop = true;
  fileName?: string;

  constructor(private ctx: AudioContext) {
    this.dev = makeDeviceOut(ctx);
    this.level = ctx.createGain();
    this.level.connect(this.dev.out);
  }

  setBuffer(b: AudioBuffer | null, fileName?: string) {
    const was = this.playing;
    this.stop();
    this.buffer = b;
    this.fileName = fileName;
    this.pausedAt = 0;
    if (was && b) this.play();
  }

  apply(p: PlayerState) {
    this.level.gain.setTargetAtTime(dbToLin(p.level), this.ctx.currentTime, 0.01);
    this.loop = p.loop;
    if (this.node) this.node.loop = p.loop;
  }

  position(): number {
    if (!this.buffer) return 0;
    if (!this.playing) return this.pausedAt;
    const pos = this.ctx.currentTime - this.startedAt;
    return this.loop ? pos % this.buffer.duration : Math.min(pos, this.buffer.duration);
  }

  play(at?: number, offset?: number) {
    if (!this.buffer) return;
    this.halt();
    const n = this.ctx.createBufferSource();
    n.buffer = this.buffer;
    n.loop = this.loop;
    n.connect(this.level);
    const when = at ?? this.ctx.currentTime;
    const off = offset ?? this.pausedAt;
    n.start(when, off % this.buffer.duration);
    n.onended = () => {
      if (this.node === n) {
        this.playing = false;
        this.pausedAt = 0;
        this.node = null;
      }
    };
    this.node = n;
    this.startedAt = when - off;
    this.playing = true;
  }

  pause() {
    if (!this.playing) return;
    this.pausedAt = this.position();
    this.halt();
    this.playing = false;
  }

  stop() {
    this.halt();
    this.playing = false;
    this.pausedAt = 0;
  }

  restart() {
    this.pausedAt = 0;
    this.play(undefined, 0);
  }

  private halt() {
    if (this.node) {
      const n = this.node;
      this.node = null;
      n.onended = null;
      try {
        n.stop();
      } catch {
        /* already stopped */
      }
      n.disconnect();
    }
  }

  runtime(): PlayerRuntime {
    return {
      playing: this.playing,
      duration: this.buffer?.duration ?? 0,
      position: this.position(),
      fileName: this.fileName,
    };
  }
}

// ---------------------------------------------------------------- mic -----

export class Microphone {
  readonly dev: DeviceOut;
  private level: GainNode;
  private stream: MediaStream | null = null;
  private src: MediaStreamAudioSourceNode | null = null;
  status: 'off' | 'requesting' | 'on' | 'denied' | 'unavailable' | 'error' = 'off';
  error = '';
  label = '';

  constructor(private ctx: AudioContext) {
    this.dev = makeDeviceOut(ctx);
    // keeps the stream's channel layout: on a stereo / multichannel interface the
    // plug's L / R choice picks interface input 1 / 2, SUM mixes them
    this.level = ctx.createGain();
    this.level.connect(this.dev.out);
  }

  setLevel(db: number) {
    this.level.gain.setTargetAtTime(dbToLin(db), this.ctx.currentTime, 0.01);
  }

  async connect(deviceId?: string): Promise<void> {
    if (!navigator.mediaDevices?.getUserMedia) {
      this.status = 'unavailable';
      this.error =
        'This browser does not expose getUserMedia. Microphone input needs a modern browser and a secure origin (https:// or http://localhost).';
      return;
    }
    this.disconnect();
    this.status = 'requesting';
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: deviceId ? { exact: deviceId } : undefined,
          channelCount: { ideal: 2 },
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });
      this.src = this.ctx.createMediaStreamSource(this.stream);
      this.src.connect(this.level);
      this.label = this.stream.getAudioTracks()[0]?.label ?? 'Microphone';
      this.status = 'on';
      this.error = '';
    } catch (e) {
      const err = e as DOMException;
      if (err.name === 'NotAllowedError' || err.name === 'SecurityError') {
        this.status = 'denied';
        this.error =
          'Microphone permission was denied. Allow microphone access for this page in the browser address bar, then press Connect again.';
      } else if (err.name === 'NotFoundError') {
        this.status = 'unavailable';
        this.error = 'No microphone was found. Plug one in or use an audio file / the signal generator instead.';
      } else {
        this.status = 'error';
        this.error = `Could not open the microphone: ${err.message || err.name}`;
      }
    }
  }

  disconnect() {
    this.src?.disconnect();
    this.stream?.getTracks().forEach((t) => t.stop());
    this.src = null;
    this.stream = null;
    if (this.status === 'on') this.status = 'off';
  }
}
