// Single source of truth for the console. The audio engine, the routing
// resolver, the meters' labels and every screen read from this store.

import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import type { ConsoleModel, ConsoleState, RigState } from '../model/types';
import { buildDm3Model } from '../model/dm3';
import { defaultConsoleState, defaultRig, migrateConsole, migrateRig, STATE_VERSION } from '../model/defaults';

const LS_STATE = 'dm3sim.console.v1';
const LS_RIG = 'dm3sim.rig.v1';
const LS_SCENES = 'dm3sim.scenes.v1';
const LS_MODEL = 'dm3sim.model.v1';
const LS_SAFE = 'dm3sim.safe.v1';

/** Parameter groups a scene can recall (Yamaha "Focus"). */
export const FOCUS_CATS = ['inpatch', 'ha', 'processing', 'faders', 'sends', 'outpatch', 'fx'] as const;
export type FocusCat = (typeof FOCUS_CATS)[number];
export const FOCUS_LABELS: Record<FocusCat, string> = {
  inpatch: 'Input patch',
  ha: 'HA gain / +48V',
  processing: 'Processing (gain, HPF, EQ, dynamics, GEQ, delay)',
  faders: 'Faders, ON, pan, ST, DCA, mute groups',
  sends: 'Sends, matrix sends, links',
  outpatch: 'Output patch',
  fx: 'FX racks',
};

export interface Scene {
  id: string;
  name: string;
  savedAt: number;
  state: ConsoleState;
  focus?: Partial<Record<FocusCat, boolean>>; // missing = recall everything
}

/**
 * Apply a scene to the current state honoring Focus (which parameter groups the
 * scene recalls) and Recall Safe (channels/buses that keep their current settings).
 */
export function applyScene(cur: ConsoleState, scene: ConsoleState, focus: Scene['focus'], safe: Record<string, boolean>): ConsoleState {
  const on = (c: FocusCat) => focus?.[c] !== false;
  const out: ConsoleState = JSON.parse(JSON.stringify(cur));
  const sc: ConsoleState = JSON.parse(JSON.stringify(scene));
  for (const [id, ch] of Object.entries(sc.channels)) {
    if (safe[id] || !out.channels[id]) continue;
    const o = out.channels[id];
    o.name = ch.name;
    o.color = ch.color;
    if (on('inpatch')) Object.assign(o, { patchL: ch.patchL, patchR: ch.patchR });
    if (on('processing'))
      Object.assign(o, {
        digitalGain: ch.digitalGain, polarity: ch.polarity, hpfOn: ch.hpfOn, hpfFreq: ch.hpfFreq, eqOn: ch.eqOn, eq: ch.eq,
        gate: ch.gate, comp: ch.comp, delayOn: ch.delayOn, delayMs: ch.delayMs,
      });
    if (on('faders')) Object.assign(o, { on: ch.on, fader: ch.fader, pan: ch.pan, toSt: ch.toSt, dca: ch.dca, muteGroups: ch.muteGroups });
    if (on('sends')) o.sends = ch.sends;
  }
  for (const [id, b] of Object.entries(sc.buses)) {
    if (safe[id] || !out.buses[id]) continue;
    const o = out.buses[id];
    o.name = b.name;
    o.color = b.color;
    if (on('processing')) Object.assign(o, { eqOn: b.eqOn, eq: b.eq, comp: b.comp, geqOn: b.geqOn, geq: b.geq, delayOn: b.delayOn, delayMs: b.delayMs });
    if (on('faders')) Object.assign(o, { on: b.on, fader: b.fader, balance: b.balance, muteGroups: b.muteGroups });
    if (on('sends')) o.mtxSends = b.mtxSends;
  }
  if (on('ha')) for (const [id, p] of Object.entries(sc.ports)) if (out.ports[id] && !safe[`port:${id}`]) out.ports[id] = p;
  if (on('faders')) {
    out.dcas = sc.dcas;
    out.muteGroups = sc.muteGroups;
  }
  if (on('sends')) out.pairLinked = sc.pairLinked;
  if (on('outpatch')) out.outPorts = sc.outPorts;
  if (on('fx')) out.fx = sc.fx;
  out.monitor = sc.monitor;
  out.talkback = sc.talkback;
  out.osc = sc.osc;
  return out;
}

export type Screen =
  | 'overview'
  | 'channel'
  | 'routing'
  | 'io'
  | 'fx'
  | 'sources'
  | 'scenes'
  | 'flow';

/** Learning dock (bottom section): which learning panel is open, null = collapsed. */
export type Learn = null | 'academy' | 'training';

export type Layer = 'all' | '1-8' | '9-16' | 'st-fx' | 'out';

export interface UiState {
  screen: Screen;
  selected: string; // channel id or bus id
  sof: string | null; // bus id when Sends-on-Fader is active
  layer: Layer;
  learning: boolean;
  topic: string | null; // last interacted control kind (coach panel)
  focus: string | null; // section to scroll to on the channel screen
  pane: 'mix' | 'screen' | 'master' | 'learn'; // which part is visible on phones
  learn: Learn; // learning dock state
  meterIn: 'prehpf' | 'prefader' | 'poston'; // input-channel meter point (METER screen)
  meterOut: 'preeq' | 'prefader' | 'poston'; // output-bus meter point
  peakHold: boolean;
}

interface Store {
  model: ConsoleModel;
  console: ConsoleState;
  rig: RigState;
  ui: UiState;
  scenes: Scene[];
  safe: Record<string, boolean>; // recall safe (not stored in scenes)
  status: string; // last user-facing status message
  set: (fn: (c: ConsoleState) => void) => void;
  setRig: (fn: (r: RigState) => void) => void;
  setUi: (fn: (u: UiState) => void) => void;
  replaceConsole: (c: ConsoleState) => void;
  resetConsole: () => void;
  resetRig: () => void;
  setModel: (id: 'DM3' | 'DM3S') => void;
  storeScene: (name: string) => void;
  recallScene: (id: string) => void;
  deleteScene: (id: string) => void;
  setSceneFocus: (id: string, cat: FocusCat, on: boolean) => void;
  setSafe: (id: string, on: boolean) => void;
  importScenes: (json: string) => string;
  flash: (msg: string) => void;
}

function load<T>(key: string): T | null {
  try {
    const s = localStorage.getItem(key);
    return s ? (JSON.parse(s) as T) : null;
  } catch {
    return null;
  }
}

function save(key: string, v: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* storage unavailable (private mode / quota): keep working in memory */
  }
}

/** Accept a stored console state only if it matches the current model shape. */
export function validState(model: ConsoleModel, s: unknown): s is ConsoleState {
  if (!s || typeof s !== 'object') return false;
  const c = s as ConsoleState;
  if (c.version !== STATE_VERSION || !c.channels || !c.buses || !c.outPorts || !c.ports) return false;
  return (
    model.channels.every((ch) => c.channels[ch.id]?.sends) &&
    model.buses.every((b) => c.buses[b.id]) &&
    model.outPorts.every((p) => c.outPorts[p.id] !== undefined) &&
    model.inPorts.every((p) => c.ports[p.id] !== undefined)
  );
}

const modelId = (load<string>(LS_MODEL) === 'DM3S' ? 'DM3S' : 'DM3') as 'DM3' | 'DM3S';
const initialModel = buildDm3Model(modelId === 'DM3');
const storedState = migrateConsole(initialModel, load<unknown>(LS_STATE));
const storedRig = migrateRig(load<unknown>(LS_RIG));
const storedScenes = (load<Scene[]>(LS_SCENES) ?? [])
  .map((sc) => ({ ...sc, state: migrateConsole(initialModel, sc.state) }))
  .filter((sc): sc is Scene => !!sc.state);

export const useStore = create<Store>()(
  immer((set, get) => ({
    model: initialModel,
    console: validState(initialModel, storedState) ? storedState : defaultConsoleState(initialModel),
    rig: storedRig ?? defaultRig(),
    ui: { screen: 'overview', selected: 'ch1', sof: null, layer: 'all', learning: true, topic: null, focus: null, pane: 'mix', learn: null, meterIn: 'prefader', meterOut: 'poston', peakHold: true },
    scenes: storedScenes,
    safe: load<Record<string, boolean>>(LS_SAFE) ?? {},
    status: '',
    set: (fn) => set((s) => void fn(s.console)),
    setRig: (fn) => set((s) => void fn(s.rig)),
    setUi: (fn) => set((s) => void fn(s.ui)),
    replaceConsole: (c) => set((s) => void (s.console = c)),
    resetConsole: () =>
      set((s) => {
        s.console = defaultConsoleState(s.model);
        s.ui.sof = null;
        s.status = 'Console reset to the simulator default scene.';
      }),
    resetRig: () =>
      set((s) => {
        s.rig = defaultRig();
      }),
    setModel: (id) => {
      save(LS_MODEL, id);
      location.reload();
    },
    storeScene: (name) =>
      set((s) => {
        if (s.scenes.length >= s.model.maxScenes) {
          s.status = `Scene memory is full (${s.model.maxScenes} scenes). Delete a scene first.`;
          return;
        }
        const sc: Scene = {
          id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
          name: name.trim() || `Scene ${s.scenes.length + 1}`,
          savedAt: Date.now(),
          state: JSON.parse(JSON.stringify(s.console)),
        };
        s.scenes.push(sc);
        s.status = `Stored scene "${sc.name}".`;
      }),
    recallScene: (id) =>
      set((s) => {
        const sc = s.scenes.find((x) => x.id === id);
        if (!sc) return;
        if (!validState(s.model, sc.state)) {
          s.status = `Scene "${sc.name}" was saved for a different console model and cannot be recalled.`;
          return;
        }
        s.console = applyScene(JSON.parse(JSON.stringify(s.console)), sc.state, sc.focus, s.safe);
        s.ui.sof = null;
        const nSafe = Object.values(s.safe).filter(Boolean).length;
        const nFocus = sc.focus ? Object.values(sc.focus).filter((v) => v === false).length : 0;
        s.status = `Recalled scene "${sc.name}"${nFocus ? ` (focus: ${nFocus} group(s) excluded)` : ''}${nSafe ? ` · ${nSafe} recall-safe item(s) kept` : ''}.`;
      }),
    deleteScene: (id) =>
      set((s) => {
        s.scenes = s.scenes.filter((x) => x.id !== id);
      }),
    setSceneFocus: (id, cat, on) =>
      set((s) => {
        const sc = s.scenes.find((x) => x.id === id);
        if (sc) sc.focus = { ...sc.focus, [cat]: on };
      }),
    setSafe: (id, on) =>
      set((s) => {
        s.safe[id] = on;
      }),
    importScenes: (json) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(json);
      } catch {
        return 'That file is not valid JSON.';
      }
      const list = (Array.isArray(parsed) ? parsed : [parsed]) as Scene[];
      const model = get().model;
      const ok = list
        .map((x) => (x && typeof x.name === 'string' ? { ...x, state: migrateConsole(model, x.state) } : null))
        .filter((x): x is Scene => !!x && validState(model, x.state));
      if (!ok.length) return 'No compatible scenes found in that file.';
      set((s) => {
        for (const sc of ok) s.scenes.push({ ...sc, id: `${sc.id}-${Date.now().toString(36)}` });
      });
      return `Imported ${ok.length} scene(s).`;
    },
    flash: (msg) => set((s) => void (s.status = msg)),
  })),
);

// ---- persistence (debounced) ----
let t = 0;
useStore.subscribe((s, prev) => {
  if (s.console === prev.console && s.rig === prev.rig && s.scenes === prev.scenes && s.safe === prev.safe) return;
  clearTimeout(t);
  t = window.setTimeout(() => {
    const st = useStore.getState();
    save(LS_STATE, st.console);
    save(LS_RIG, st.rig);
    save(LS_SCENES, st.scenes);
    save(LS_SAFE, st.safe);
  }, 400);
});

export const getState = () => useStore.getState();
