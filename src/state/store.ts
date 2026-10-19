// Single source of truth for the console. The audio engine, the routing
// resolver, the meters' labels and every screen read from this store.

import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import type { ConsoleModel, ConsoleState, RigState } from '../model/types';
import { buildDm3Model } from '../model/dm3';
import { defaultConsoleState, defaultRig, STATE_VERSION } from '../model/defaults';

const LS_STATE = 'dm3sim.console.v1';
const LS_RIG = 'dm3sim.rig.v1';
const LS_SCENES = 'dm3sim.scenes.v1';
const LS_MODEL = 'dm3sim.model.v1';

export interface Scene {
  id: string;
  name: string;
  savedAt: number;
  state: ConsoleState;
}

export type Screen =
  | 'overview'
  | 'channel'
  | 'routing'
  | 'io'
  | 'fx'
  | 'sources'
  | 'scenes'
  | 'flow'
  | 'training'
  | 'academy';

export type Layer = 'all' | '1-8' | '9-16' | 'st-fx' | 'out';

export interface UiState {
  screen: Screen;
  selected: string; // channel id or bus id
  sof: string | null; // bus id when Sends-on-Fader is active
  layer: Layer;
  learning: boolean;
  topic: string | null; // last interacted control kind (coach panel)
  focus: string | null; // section to scroll to on the channel screen
}

interface Store {
  model: ConsoleModel;
  console: ConsoleState;
  rig: RigState;
  ui: UiState;
  scenes: Scene[];
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
const storedState = load<ConsoleState>(LS_STATE);
const storedRig = load<RigState>(LS_RIG);

export const useStore = create<Store>()(
  immer((set, get) => ({
    model: initialModel,
    console: validState(initialModel, storedState) ? storedState : defaultConsoleState(initialModel),
    rig: storedRig && storedRig.plugs && storedRig.players?.length === 8 ? storedRig : defaultRig(),
    ui: { screen: 'overview', selected: 'ch1', sof: null, layer: 'all', learning: true, topic: null, focus: null },
    scenes: load<Scene[]>(LS_SCENES) ?? [],
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
        s.console = JSON.parse(JSON.stringify(sc.state));
        s.ui.sof = null;
        s.status = `Recalled scene "${sc.name}".`;
      }),
    deleteScene: (id) =>
      set((s) => {
        s.scenes = s.scenes.filter((x) => x.id !== id);
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
      const ok = list.filter((x) => x && typeof x.name === 'string' && validState(model, x.state));
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
  if (s.console === prev.console && s.rig === prev.rig && s.scenes === prev.scenes) return;
  clearTimeout(t);
  t = window.setTimeout(() => {
    const st = useStore.getState();
    save(LS_STATE, st.console);
    save(LS_RIG, st.rig);
    save(LS_SCENES, st.scenes);
  }, 400);
});

export const getState = () => useStore.getState();
