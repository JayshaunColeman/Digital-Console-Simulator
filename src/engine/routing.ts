// Routing graph resolver.
//
// Builds a directed graph of every connection in the console from the same
// state object that drives the Web Audio engine. Edge gains are the nominal
// linear gain of each connection (switches, faders, sends, patches), so the
// graph tells you *whether* and *how strongly* a signal can travel from one
// point to another. The audio engine builds the real DSP graph from the same
// rules; the meters (measured from audio) confirm what this graph predicts.

import type { ConsoleModel, ConsoleState, RigState } from '../model/types';
import { NEG_INF } from '../model/types';
import { pairKeyOf, pairPartner } from '../model/dm3';
import { dbToLin } from '../lib/db';

export interface REdge {
  from: string;
  to: string;
  gain: number; // linear; 0 = connection exists but is switched off / -inf
  label: string; // what this connection is ("ST assign", "MIX 1 send (PRE)")
  why?: string; // explanation when gain is 0
  ctl?: string; // UI hint: where to fix it ("ch:ch1:routing", "patch:out", ...)
}

export interface RGraph {
  edges: REdge[];
  out: Map<string, REdge[]>;
  inc: Map<string, REdge[]>;
  labels: Map<string, string>;
}

/** Bus state that actually governs a bus (left bus of a stereo-linked pair). */
export function governingBusId(state: ConsoleState, busId: string): string {
  const pk = pairKeyOf(busId);
  if (pk && state.pairLinked[pk]) return pairPartner(busId)!.left;
  return busId;
}

export function isLinked(state: ConsoleState, busId: string): boolean {
  const pk = pairKeyOf(busId);
  return !!(pk && state.pairLinked[pk]);
}

/** Combined DCA offset (dB) and DCA mute state for a channel. */
export function dcaFor(state: ConsoleState, chId: string): { offset: number; muted: string | null } {
  const ch = state.channels[chId];
  let offset = 0;
  let muted: string | null = null;
  for (const n of ch.dca) {
    const d = state.dcas[n - 1];
    if (!d) continue;
    offset += d.level;
    if (!d.on) muted = d.name;
    if (d.level <= NEG_INF) muted = `${d.name} fader at -∞`;
  }
  return { offset, muted };
}

export function effectiveFaderDb(state: ConsoleState, chId: string): number {
  const ch = state.channels[chId];
  if (ch.fader <= NEG_INF) return NEG_INF;
  const { offset } = dcaFor(state, chId);
  return Math.min(ch.fader + offset, 10 + 10);
}

export function anyCue(state: ConsoleState): boolean {
  return (
    Object.values(state.channels).some((c) => c.cue) || Object.values(state.buses).some((b) => b.cue)
  );
}

export function deviceLabel(rig: RigState, dev: string): string {
  if (dev === 'mic') return 'Browser Microphone';
  if (dev === 'gen') return 'Signal Generator';
  const p = /^p(\d)$/.exec(dev);
  if (p) return `Player ${p[1]}: ${rig.players[Number(p[1]) - 1]?.name ?? ''}`;
  const l = /^loop:(.+)$/.exec(dev);
  if (l) return `Loop cable from ${l[1].toUpperCase()}`;
  return dev;
}

export function buildRoutingGraph(model: ConsoleModel, state: ConsoleState, rig: RigState): RGraph {
  const edges: REdge[] = [];
  const labels = new Map<string, string>();
  const add = (e: REdge) => edges.push(e);
  const sw = (on: boolean) => (on ? 1 : 0);

  // ---- devices -> input ports
  for (const p of model.inPorts) {
    labels.set(`port:${p.id}`, p.label);
    const plug = rig.plugs[p.id];
    if (plug) {
      labels.set(`dev:${plug.device}`, deviceLabel(rig, plug.device));
      const loop = /^loop:(.+)$/.exec(plug.device);
      if (loop) {
        // a physical cable from an output socket back into an input socket
        add({ from: `out:${loop[1]}`, to: `port:${p.id}`, gain: 1, label: 'Loop cable', ctl: 'io:inputs' });
      } else {
        add({ from: `dev:${plug.device}`, to: `port:${p.id}`, gain: 1, label: `Cable (${plug.ch})`, ctl: 'io:inputs' });
      }
    }
  }

  // ---- input channels
  for (const c of model.channels) {
    const ch = state.channels[c.id];
    const id = `ch:${c.id}`;
    labels.set(id, `${c.defaultName} "${ch.name}"`);
    labels.set(`${id}:pre`, `${c.short} pre-fader`);
    labels.set(`${id}:post`, `${c.short} post-fader`);
    if (c.kind === 'fxreturn') {
      add({ from: `fx:${c.fxRack}`, to: id, gain: 1, label: 'Internal FX return' });
    } else {
      for (const port of [ch.patchL, c.kind === 'stereo' ? ch.patchR : null]) {
        if (port) add({ from: `port:${port}`, to: id, gain: 1, label: 'Input patch', ctl: `ch:${c.id}:input` });
      }
    }
    const dca = dcaFor(state, c.id);
    const live = ch.on && !dca.muted;
    add({
      from: id,
      to: `${id}:pre`,
      gain: sw(live),
      label: 'Channel ON',
      why: !ch.on ? `${ch.name}: channel ON key is off (muted)` : dca.muted ? `${ch.name}: muted by ${dca.muted}` : undefined,
      ctl: `ch:${c.id}:on`,
    });
    const fdb = effectiveFaderDb(state, c.id);
    add({
      from: `${id}:pre`,
      to: `${id}:post`,
      gain: dbToLin(fdb),
      label: 'Channel fader',
      why: fdb <= NEG_INF ? `${ch.name}: channel fader at -∞` : undefined,
      ctl: `ch:${c.id}:fader`,
    });
    add({
      from: `${id}:post`,
      to: 'bus:st',
      gain: sw(ch.toSt),
      label: 'ST assign',
      why: ch.toSt ? undefined : `${ch.name}: not assigned to STEREO (ST assign off)`,
      ctl: `ch:${c.id}:routing`,
    });
    if (c.kind === 'mono') {
      add({ from: `${id}:pre`, to: `psrc:dir_${c.id}`, gain: 1, label: 'Direct out (pre-fader)' });
    }
    // sends to mix + fx buses
    for (const b of model.buses) {
      if (b.kind !== 'mix' && b.kind !== 'fx') continue;
      const gov = b.kind === 'mix' ? governingBusId(state, b.id) : b.id;
      const s = ch.sends[gov];
      if (!s) continue;
      const g = s.on ? dbToLin(s.level) : 0;
      const bname = state.buses[gov].name;
      add({
        from: s.pre ? `${id}:pre` : `${id}:post`,
        to: `bus:${b.id}`,
        gain: g,
        label: `${state.buses[b.id].name} send (${s.pre ? 'PRE' : 'POST'})`,
        why: !s.on
          ? `${ch.name}: send to ${bname} is switched off`
          : s.level <= NEG_INF
            ? `${ch.name}: send level to ${bname} at -∞`
            : undefined,
        ctl: `ch:${c.id}:sends`,
      });
    }
    // cue
    add({
      from: state.monitor.cueMode === 'PFL' ? id : `${id}:post`,
      to: 'bus:cue',
      gain: sw(ch.cue),
      label: `CUE (${state.monitor.cueMode})`,
    });
  }

  // ---- buses
  for (const b of model.buses) {
    const gov = b.kind === 'mix' || b.kind === 'matrix' ? governingBusId(state, b.id) : b.id;
    const bs = state.buses[gov];
    const id = `bus:${b.id}`;
    labels.set(id, `${state.buses[b.id].name} bus`);
    labels.set(`${id}:out`, `${state.buses[b.id].name} master`);
    const g = bs.on ? dbToLin(bs.fader) : 0;
    add({
      from: id,
      to: `${id}:out`,
      gain: g,
      label: 'Bus master (ON + fader)',
      why: !bs.on ? `${bs.name}: bus master ON key is off (muted)` : bs.fader <= NEG_INF ? `${bs.name}: master fader at -∞` : undefined,
      ctl: `bus:${b.id}:master`,
    });
    if (b.kind === 'stereo') {
      add({ from: `${id}:out`, to: 'psrc:st_l', gain: 1, label: 'STEREO L' });
      add({ from: `${id}:out`, to: 'psrc:st_r', gain: 1, label: 'STEREO R' });
    } else if (b.kind === 'mix' || b.kind === 'matrix') {
      add({ from: `${id}:out`, to: `psrc:${b.id}`, gain: 1, label: b.id.toUpperCase() });
    } else if (b.kind === 'fx') {
      const n = b.id.slice(2);
      labels.set(`fx:${n}`, `FX ${n} rack (${state.fx[Number(n) - 1].type})`);
      add({ from: `${id}:out`, to: `fx:${n}`, gain: 1, label: 'FX rack input' });
    }
    if (b.kind === 'stereo' || b.kind === 'mix') {
      for (const m of model.buses) {
        if (m.kind !== 'matrix') continue;
        const mgov = governingBusId(state, m.id);
        const ms = state.buses[gov].mtxSends[mgov];
        if (!ms) continue;
        add({
          from: `${id}:out`,
          to: `bus:${m.id}`,
          gain: ms.on ? dbToLin(ms.level) : 0,
          label: `${state.buses[m.id].name} send`,
          why: ms.level <= NEG_INF || !ms.on ? `${bs.name}: matrix send to ${state.buses[mgov].name} is off` : undefined,
          ctl: `bus:${b.id}:matrix`,
        });
      }
    }
    add({ from: state.monitor.cueMode === 'PFL' ? id : `${id}:out`, to: 'bus:cue', gain: sw(state.buses[b.id].cue), label: 'CUE' });
  }

  // ---- monitor / cue
  labels.set('bus:cue', 'CUE bus');
  labels.set('mon', 'MONITOR');
  labels.set('phones', 'PHONES');
  const cueing = anyCue(state);
  add({ from: 'bus:cue', to: 'mon', gain: sw(cueing), label: 'Cue interrupts monitor' });
  add({
    from: `bus:${state.monitor.source}:out`,
    to: 'mon',
    gain: sw(!cueing),
    label: 'Monitor source',
    why: cueing ? 'A CUE is active, so the monitor is carrying the cue signal' : undefined,
  });
  const ml = dbToLin(state.monitor.level);
  add({ from: 'mon', to: 'psrc:mon_l', gain: ml, label: 'Monitor level' });
  add({ from: 'mon', to: 'psrc:mon_r', gain: ml, label: 'Monitor level' });
  add({ from: 'mon', to: 'phones', gain: ml, label: 'Phones level' });

  // ---- output patch
  for (const s of model.patchSources) labels.set(`psrc:${s.id}`, s.label);
  for (const p of model.outPorts) {
    labels.set(`out:${p.id}`, rig.outNames[p.id] ? `${p.label} (${rig.outNames[p.id]})` : p.label);
    const op = state.outPorts[p.id];
    if (op.source) {
      add({
        from: `psrc:${op.source}`,
        to: `out:${p.id}`,
        gain: dbToLin(op.att),
        label: 'Output patch',
        why: op.att <= NEG_INF ? `${p.label}: output attenuator at -∞` : undefined,
        ctl: 'io:outputs',
      });
    }
  }

  // ---- browser listening position
  labels.set('listen', 'Browser audio output');
  if (rig.listen.mode === 'phones') {
    add({ from: 'phones', to: 'listen', gain: 1, label: 'Listening on PHONES', ctl: 'io:listen' });
  } else {
    for (const side of [rig.listen.l, rig.listen.r]) {
      if (side) add({ from: `out:${side}`, to: 'listen', gain: 1, label: 'Speaker cable', ctl: 'io:listen' });
    }
  }

  const out = new Map<string, REdge[]>();
  const inc = new Map<string, REdge[]>();
  for (const e of edges) {
    if (!out.has(e.from)) out.set(e.from, []);
    out.get(e.from)!.push(e);
    if (!inc.has(e.to)) inc.set(e.to, []);
    inc.get(e.to)!.push(e);
  }
  return { edges, out, inc, labels };
}

/** Strongest nominal path gain (linear) from `from` to `to`, 0 if unreachable. */
export function pathGain(g: RGraph, from: string, to: string): number {
  let best = 0;
  const visited = new Set<string>();
  const walk = (node: string, gain: number) => {
    if (node === to) {
      best = Math.max(best, gain);
      return;
    }
    if (visited.has(node)) return;
    visited.add(node);
    for (const e of g.out.get(node) ?? []) if (e.gain > 0) walk(e.to, gain * e.gain);
    visited.delete(node);
  };
  walk(from, 1);
  return best;
}

/** All nodes reachable from `from` through live (gain > 0) connections. */
export function reachable(g: RGraph, from: string): Set<string> {
  const seen = new Set<string>([from]);
  const stack = [from];
  while (stack.length) {
    const n = stack.pop()!;
    for (const e of g.out.get(n) ?? []) {
      if (e.gain > 0 && !seen.has(e.to)) {
        seen.add(e.to);
        stack.push(e.to);
      }
    }
  }
  return seen;
}

/** Detect live feedback loops. Returns each loop as a list of node ids. */
export function findLoops(g: RGraph): string[][] {
  const loops: string[][] = [];
  const color = new Map<string, number>(); // 0 white, 1 grey, 2 black
  const stack: string[] = [];
  const seenKeys = new Set<string>();
  const visit = (n: string) => {
    color.set(n, 1);
    stack.push(n);
    for (const e of g.out.get(n) ?? []) {
      if (e.gain <= 0) continue;
      const c = color.get(e.to) ?? 0;
      if (c === 1) {
        const loop = stack.slice(stack.indexOf(e.to));
        const key = [...loop].sort().join('|');
        if (!seenKeys.has(key)) {
          seenKeys.add(key);
          loops.push(loop);
        }
      } else if (c === 0) visit(e.to);
    }
    stack.pop();
    color.set(n, 2);
  };
  for (const n of g.out.keys()) if ((color.get(n) ?? 0) === 0) visit(n);
  return loops;
}

/**
 * Explain why `from` cannot reach `to`: walks backwards from `to` and forwards
 * from `from` and returns the switched-off connections that sit between them.
 */
export function findBreaks(g: RGraph, from: string, to: string): REdge[] {
  const fwd = reachable(g, from);
  // nodes that can reach `to` if every connection were on
  const back = new Set<string>([to]);
  const stack = [to];
  while (stack.length) {
    const n = stack.pop()!;
    for (const e of g.inc.get(n) ?? []) {
      if (!back.has(e.from)) {
        back.add(e.from);
        stack.push(e.from);
      }
    }
  }
  return g.edges.filter((e) => e.gain <= 0 && fwd.has(e.from) && back.has(e.to));
}

export const gainToDb = (g: number) => (g <= 0 ? NEG_INF : 20 * Math.log10(g));
