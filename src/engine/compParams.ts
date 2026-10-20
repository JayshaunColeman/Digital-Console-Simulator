import type { CompState } from '../model/types';

export interface CompParams {
  threshold: number;
  ratio: number;
  attack: number;
  release: number;
  knee: number;
  makeup: number;
}

/**
 * The parameters the compressor actually runs with. In 1-knob mode Yamaha fixes
 * attack 25 ms, release 296 ms and knee "Med", and one control drives threshold,
 * ratio and out gain together. Yamaha does not publish that mapping, so the
 * threshold/ratio/gain curve below is an approximation.
 */
export function effectiveComp(c: CompState): CompParams {
  if (!c.oneKnob) return { threshold: c.threshold, ratio: c.ratio, attack: c.attack, release: c.release, knee: c.knee, makeup: c.makeup };
  const a = Math.max(0, Math.min(10, c.amount));
  const threshold = -a * 3;
  const ratio = 1 + a * 0.5;
  // give back roughly half of the reduction a -10 dBFS peak would see
  const red = Math.max(0, -10 - threshold) * (1 - 1 / ratio);
  return { threshold, ratio, attack: 25, release: 296, knee: 6, makeup: Math.round(red * 5) / 10 };
}
