// Metering. Every meter value is computed from real audio samples read from
// AnalyserNodes inserted at tap points in the DSP graph. Nothing is simulated.

import { NEG_INF } from '../model/types';

export interface MeterReading {
  peak: number[]; // displayed peak per channel, dBFS (with ballistics)
  hold: number[]; // peak hold, dBFS
  rms: number[]; // dBFS
  clip: boolean[]; // sample peak reached 0 dBFS within the latch time
  raw: number[]; // instantaneous window peak, dBFS
}

interface Tap {
  analysers: AnalyserNode[];
  st: { disp: number; hold: number; holdT: number; clipT: number; rms: number; raw: number }[];
}

export type GrSource = () => number; // returns gain reduction in dB (<= 0)

const FFT = 2048;
const RELEASE_DB_PER_S = 26;
const HOLD_S = 1.5;
const CLIP_LATCH_S = 2;

const toDb = (v: number) => (v <= 1e-7 ? NEG_INF : 20 * Math.log10(v));

export class MeterHub {
  private taps = new Map<string, Tap>();
  private gr = new Map<string, GrSource>();
  private subs = new Map<string, Set<(r: MeterReading) => void>>();
  private grSubs = new Map<string, Set<(db: number) => void>>();
  private buf = new Float32Array(FFT);
  private raf = 0;
  holdEnabled = true; // global PEAK HOLD key
  private last = 0;

  constructor(private ctx: BaseAudioContext) {}

  /** Insert a tap that meters `node` (1 or 2 channels). */
  addTap(id: string, node: AudioNode, channels: 1 | 2) {
    const analysers: AnalyserNode[] = [];
    if (channels === 1) {
      const a = this.ctx.createAnalyser();
      a.fftSize = FFT;
      a.channelCount = 1;
      a.channelCountMode = 'explicit';
      node.connect(a);
      analysers.push(a);
    } else {
      const sp = this.ctx.createChannelSplitter(2);
      node.connect(sp);
      for (let i = 0; i < 2; i++) {
        const a = this.ctx.createAnalyser();
        a.fftSize = FFT;
        sp.connect(a, i);
        analysers.push(a);
      }
    }
    this.taps.set(id, {
      analysers,
      st: analysers.map(() => ({ disp: NEG_INF, hold: NEG_INF, holdT: 0, clipT: -99, rms: NEG_INF, raw: NEG_INF })),
    });
  }

  addGr(id: string, src: GrSource) {
    this.gr.set(id, src);
  }

  has(id: string) {
    return this.taps.has(id);
  }

  /** Instantaneous peak (dBFS, max over channels) of the last ~43 ms of audio. */
  peakNow(id: string): number {
    const t = this.taps.get(id);
    if (!t) return NEG_INF;
    let max = 0;
    for (const a of t.analysers) {
      a.getFloatTimeDomainData(this.buf);
      for (let i = 0; i < this.buf.length; i++) {
        const v = Math.abs(this.buf[i]);
        if (v > max) max = v;
      }
    }
    return toDb(max);
  }

  grNow(id: string): number {
    return this.gr.get(id)?.() ?? 0;
  }

  subscribe(id: string, cb: (r: MeterReading) => void): () => void {
    if (!this.subs.has(id)) this.subs.set(id, new Set());
    this.subs.get(id)!.add(cb);
    return () => this.subs.get(id)?.delete(cb);
  }

  subscribeGr(id: string, cb: (db: number) => void): () => void {
    if (!this.grSubs.has(id)) this.grSubs.set(id, new Set());
    this.grSubs.get(id)!.add(cb);
    return () => this.grSubs.get(id)?.delete(cb);
  }

  reading(id: string): MeterReading | null {
    const t = this.taps.get(id);
    if (!t) return null;
    const now = this.ctx.currentTime;
    return {
      peak: t.st.map((s) => s.disp),
      hold: t.st.map((s) => (this.holdEnabled ? s.hold : NEG_INF)),
      rms: t.st.map((s) => s.rms),
      clip: t.st.map((s) => now - s.clipT < CLIP_LATCH_S),
      raw: t.st.map((s) => s.raw),
    };
  }

  private update(id: string, dt: number) {
    const t = this.taps.get(id)!;
    const now = this.ctx.currentTime;
    t.analysers.forEach((a, i) => {
      a.getFloatTimeDomainData(this.buf);
      let pk = 0;
      let sq = 0;
      for (let k = 0; k < this.buf.length; k++) {
        const v = this.buf[k];
        const av = v < 0 ? -v : v;
        if (av > pk) pk = av;
        sq += v * v;
      }
      const s = t.st[i];
      const db = toDb(pk);
      s.raw = db;
      s.rms = toDb(Math.sqrt(sq / this.buf.length));
      s.disp = db >= s.disp ? db : Math.max(db, s.disp - RELEASE_DB_PER_S * dt);
      if (db >= s.hold || now - s.holdT > HOLD_S) {
        s.hold = db;
        s.holdT = now;
      }
      if (pk >= 0.9999) s.clipT = now;
    });
  }

  start() {
    const loop = (ts: number) => {
      this.raf = requestAnimationFrame(loop);
      if (!this.last) this.last = ts;
      const dt = Math.min(0.2, (ts - this.last) / 1000);
      if (dt < 0.03) return; // ~30 fps
      this.last = ts;
      for (const [id, set] of this.subs) {
        if (!set.size || !this.taps.has(id)) continue;
        this.update(id, dt);
        const r = this.reading(id)!;
        set.forEach((cb) => cb(r));
      }
      for (const [id, set] of this.grSubs) {
        if (!set.size) continue;
        const v = this.grNow(id);
        set.forEach((cb) => cb(v));
      }
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop() {
    cancelAnimationFrame(this.raf);
  }
}
