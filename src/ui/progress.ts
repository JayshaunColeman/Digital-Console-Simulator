// Academy / training progress, kept in the browser (localStorage).
// Shared by the learning screens and the LEARN dock's status line.

import { useEffect, useState } from 'react';

const LS = 'dm3sim.progress.v1';
const EVT = 'dm3sim-progress';

export interface Progress {
  ex: Record<string, { done: number; at: number }>;
  sc: Record<string, { fixed: number; hints: number; revealed: boolean; at: number }>;
}

export function loadProgress(): Progress {
  try {
    return { ex: {}, sc: {}, ...(JSON.parse(localStorage.getItem(LS) ?? '{}') as Partial<Progress>) };
  } catch {
    return { ex: {}, sc: {} };
  }
}

export function saveProgress(p: Progress) {
  try {
    localStorage.setItem(LS, JSON.stringify(p));
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new Event(EVT));
}

/** Live progress (re-reads whenever a learning screen saves). */
export function useProgress(): Progress {
  const [p, setP] = useState(loadProgress);
  useEffect(() => {
    const on = () => setP(loadProgress());
    window.addEventListener(EVT, on);
    window.addEventListener('storage', on);
    return () => {
      window.removeEventListener(EVT, on);
      window.removeEventListener('storage', on);
    };
  }, []);
  return p;
}
