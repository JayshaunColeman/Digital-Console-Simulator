import { buildRoutingGraph, gainToDb, pathGain } from '../engine/routing';
import { getState } from '../state/store';
import { getEngine, useRuntime } from '../state/engine';
import { NEG_INF } from '../model/types';
import type { CheckCtx } from './types';

export function makeCheckCtx(): CheckCtx {
  const s = getState();
  const graph = buildRoutingGraph(s.model, s.console, s.rig);
  const eng = getEngine();
  const running = useRuntime.getState().running && !!eng;
  return {
    model: s.model,
    state: s.console,
    rig: s.rig,
    graph,
    gain: (a, b) => gainToDb(pathGain(graph, a, b)),
    peak: (tap) => (running ? eng!.peak(tap) : NEG_INF),
    gr: (tap) => (running ? eng!.meters.grNow(tap) : 0),
    audio: running,
    playing: (i) => !!eng?.players[i]?.playing,
  };
}
