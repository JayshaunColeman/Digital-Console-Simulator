import { NEG_INF } from '../model/types';

export const dbToLin = (db: number) => (db <= NEG_INF ? 0 : Math.pow(10, db / 20));
export const linToDb = (lin: number) => (lin <= 1e-7 ? NEG_INF : 20 * Math.log10(lin));
export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Yamaha-style fader law: position 0..1 <-> dB (+10 .. -inf). */
const FADER_TABLE: [number, number][] = [
  [0, NEG_INF],
  [0.02, -60],
  [0.06, -50],
  [0.12, -40],
  [0.2, -30],
  [0.3, -20],
  [0.4, -15],
  [0.5, -10],
  [0.625, -5],
  [0.75, 0],
  [0.875, 5],
  [1, 10],
];

export function faderPosToDb(pos: number): number {
  pos = clamp(pos, 0, 1);
  if (pos <= 0.001) return NEG_INF;
  for (let i = 1; i < FADER_TABLE.length; i++) {
    const [p1, d1] = FADER_TABLE[i];
    const [p0, d0] = FADER_TABLE[i - 1];
    if (pos <= p1) {
      if (i === 1) return -60 - (1 - pos / p1) * 40; // steep tail toward -inf
      return d0 + ((pos - p0) / (p1 - p0)) * (d1 - d0);
    }
  }
  return 10;
}

export function faderDbToPos(db: number): number {
  if (db <= NEG_INF) return 0;
  if (db <= -60) return clamp(0.02 * (1 - (-60 - db) / 40), 0, 0.02);
  for (let i = 2; i < FADER_TABLE.length; i++) {
    const [p1, d1] = FADER_TABLE[i];
    const [p0, d0] = FADER_TABLE[i - 1];
    if (db <= d1) return p0 + ((db - d0) / (d1 - d0)) * (p1 - p0);
  }
  return 1;
}

export const FADER_MARKS = [10, 5, 0, -5, -10, -15, -20, -30, -40, -50, -60];

export function fmtDb(db: number, digits = 1): string {
  if (db <= NEG_INF + 0.01) return '-∞';
  const s = db.toFixed(digits);
  return db > 0 ? `+${s}` : s;
}

export function fmtHz(f: number): string {
  return f >= 1000 ? `${(f / 1000).toFixed(f >= 10000 ? 1 : 2)}k` : `${Math.round(f)}`;
}

export function fmtPan(p: number): string {
  if (Math.abs(p) < 0.5) return 'C';
  return p < 0 ? `L${Math.round(-p)}` : `R${Math.round(p)}`;
}
