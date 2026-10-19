// EQ response curve (computed with real BiquadFilterNodes so the drawing
// matches the processing) and compressor transfer curve.

import type { CompState, EqBand } from '../model/types';

let off: OfflineAudioContext | null = null;
const FREQS = new Float32Array(Array.from({ length: 160 }, (_, i) => 20 * Math.pow(1000, i / 159)));

function response(type: BiquadFilterType, f: number, g: number, q: number): Float32Array {
  if (!off) off = new OfflineAudioContext(1, 1, 48000);
  const b = off.createBiquadFilter();
  b.type = type;
  b.frequency.value = f;
  b.gain.value = g;
  b.Q.value = q;
  const mag = new Float32Array(FREQS.length);
  const ph = new Float32Array(FREQS.length);
  b.getFrequencyResponse(FREQS, mag, ph);
  return mag;
}

export function EqCurve({ bands, eqOn, hpf }: { bands: EqBand[]; eqOn: boolean; hpf?: { on: boolean; freq: number } }) {
  const W = 360;
  const H = 130;
  const total = new Float32Array(FREQS.length).fill(1);
  if (eqOn) {
    for (const b of bands) {
      const m = response(b.type === 'peak' ? 'peaking' : b.type, b.freq, b.gain, b.q);
      for (let i = 0; i < m.length; i++) total[i] *= m[i];
    }
  }
  if (hpf?.on) {
    const m = response('highpass', hpf.freq, 0, Math.SQRT1_2);
    for (let i = 0; i < m.length; i++) total[i] *= m[i];
  }
  const y = (db: number) => H / 2 - (Math.max(-24, Math.min(24, db)) / 24) * (H / 2 - 4);
  const pts = Array.from(total, (m, i) => `${((i / (FREQS.length - 1)) * W).toFixed(1)},${y(20 * Math.log10(Math.max(1e-6, m))).toFixed(1)}`).join(' ');
  const xf = (f: number) => (Math.log(f / 20) / Math.log(1000)) * W;
  return (
    <svg className="curve" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="EQ response">
      {[100, 1000, 10000].map((f) => (
        <g key={f}>
          <line x1={xf(f)} x2={xf(f)} y1={0} y2={H} className="grid" />
          <text x={xf(f) + 2} y={H - 3} className="gridtxt">
            {f >= 1000 ? `${f / 1000}k` : f}
          </text>
        </g>
      ))}
      {[-12, 0, 12].map((d) => (
        <g key={d}>
          <line x1={0} x2={W} y1={y(d)} y2={y(d)} className={d === 0 ? 'grid zero' : 'grid'} />
          <text x={2} y={y(d) - 2} className="gridtxt">
            {d > 0 ? `+${d}` : d}
          </text>
        </g>
      ))}
      <polyline points={pts} className={`trace ${eqOn ? '' : 'off'}`} />
      {eqOn &&
        bands.map((b, i) => <circle key={i} cx={xf(b.freq)} cy={y(b.gain)} r={4} className={`band b${i}`} />)}
    </svg>
  );
}

export function CompCurve({ c }: { c: CompState }) {
  const S = 130;
  const lo = -60;
  const map = (db: number) => ((db - lo) / -lo) * S;
  const pts: string[] = [];
  for (let x = lo; x <= 0; x += 1) {
    let yv = x;
    if (c.on) {
      const k = c.knee;
      const over = x - c.threshold;
      if (2 * over < -k) yv = x;
      else if (2 * Math.abs(over) <= k && k > 0) yv = x + ((1 / c.ratio - 1) * (over + k / 2) ** 2) / (2 * k);
      else yv = c.threshold + over / c.ratio;
      yv += c.makeup;
    }
    pts.push(`${map(x).toFixed(1)},${(S - map(yv)).toFixed(1)}`);
  }
  return (
    <svg className="curve square" viewBox={`0 0 ${S} ${S}`} role="img" aria-label="Compressor transfer curve">
      <line x1={0} y1={S} x2={S} y2={0} className="grid" />
      {c.on && <line x1={map(c.threshold)} x2={map(c.threshold)} y1={0} y2={S} className="grid zero" />}
      <polyline points={pts.join(' ')} className={`trace ${c.on ? '' : 'off'}`} />
      <text x={3} y={11} className="gridtxt">
        OUT
      </text>
      <text x={S - 18} y={S - 3} className="gridtxt">
        IN
      </text>
    </svg>
  );
}
