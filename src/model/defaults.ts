import type {
  BusState,
  ChannelState,
  CompState,
  ConsoleModel,
  GateState,
  ConsoleState,
  EqBand,
  OutPortState,
  RigState,
} from './types';
import { NEG_INF } from './types';

export const STATE_VERSION = 2;

/** ISO 1/3-octave centre frequencies used by the 31-band GEQ. */
export const GEQ_FREQS = [20, 25, 31.5, 40, 50, 63, 80, 100, 125, 160, 200, 250, 315, 400, 500, 630, 800, 1000, 1250, 1600, 2000, 2500, 3150, 4000, 5000, 6300, 8000, 10000, 12500, 16000, 20000];

export const defaultEq = (): EqBand[] => [
  { type: 'lowshelf', freq: 100, gain: 0, q: 0.7 },
  { type: 'peak', freq: 400, gain: 0, q: 2 },
  { type: 'peak', freq: 2500, gain: 0, q: 2 },
  { type: 'highshelf', freq: 8000, gain: 0, q: 0.7 },
];

export const defaultComp = (): CompState => ({
  on: false,
  threshold: -20,
  ratio: 4,
  attack: 10,
  release: 150,
  knee: 2,
  makeup: 0,
  key: 'post',
  oneKnob: false,
  amount: 3,
});

export const defaultGate = (): GateState => ({
  on: false,
  mode: 'gate',
  threshold: -40,
  range: -60,
  attack: 1,
  hold: 50,
  decay: 150,
  key: 'self',
});

const CH_PRESET: Record<string, { name: string; color: string; fader?: number }> = {
  ch1: { name: 'Vocal', color: '#e0457b', fader: -10 },
  ch2: { name: 'Kick', color: '#e08a2c', fader: -10 },
  ch3: { name: 'Snare', color: '#e08a2c', fader: -10 },
  ch4: { name: 'Hi-Hat', color: '#e08a2c', fader: -15 },
  ch5: { name: 'Bass', color: '#3fae5a', fader: -10 },
  ch6: { name: 'Keys', color: '#3f8fe0', fader: -12 },
  ch8: { name: 'Mic', color: '#c9c9c9' },
  ch16: { name: 'Gen', color: '#8a8a8a' },
  stin: { name: 'Backing', color: '#9b6be0', fader: -12 },
  fxr1: { name: 'Reverb', color: '#2fb8b0', fader: 0 },
  fxr2: { name: 'Delay', color: '#2fb8b0', fader: 0 },
};

export function defaultChannel(model: ConsoleModel, id: string): ChannelState {
  const def = model.channels.find((c) => c.id === id)!;
  const preset = CH_PRESET[id];
  const sends: ChannelState['sends'] = {};
  for (const b of model.buses) {
    if (b.kind === 'mix' || b.kind === 'fx' || b.kind === 'matrix') {
      sends[b.id] = { on: true, level: NEG_INF, pre: b.kind === 'mix', pan: 0 };
    }
  }
  let patchL: string | null = null;
  let patchR: string | null = null;
  const m = /^ch(\d+)$/.exec(id);
  if (m) patchL = `in${m[1]}`;
  if (id === 'stin') {
    patchL = 'usb17';
    patchR = 'usb18';
  }
  return {
    name: preset?.name ?? def.defaultName,
    color: preset?.color ?? '#5a6270',
    patchL,
    patchR,
    digitalGain: 0,
    polarity: false,
    hpfOn: false,
    hpfFreq: 80,
    eqOn: true,
    eq: defaultEq(),
    gate: defaultGate(),
    comp: defaultComp(),
    delayOn: false,
    delayMs: 0,
    muteGroups: [],
    on: true,
    fader: preset?.fader ?? NEG_INF,
    pan: 0,
    toSt: true,
    cue: false,
    dca: [],
    sends,
  };
}

export function defaultBus(model: ConsoleModel, id: string): BusState {
  const def = model.buses.find((b) => b.id === id)!;
  const mtxSends: BusState['mtxSends'] = {};
  if (def.kind === 'stereo' || def.kind === 'mix') {
    for (const b of model.buses) if (b.kind === 'matrix') mtxSends[b.id] = { on: true, level: NEG_INF };
  }
  return {
    name: def.defaultName,
    color: def.kind === 'stereo' ? '#d8d8d8' : def.kind === 'mix' ? '#d9b43a' : def.kind === 'fx' ? '#2fb8b0' : '#b05ad9',
    on: true,
    fader: 0,
    eqOn: true,
    eq: defaultEq(),
    comp: defaultComp(),
    geqOn: false,
    geq: GEQ_FREQS.map(() => 0),
    prePoint: 'fader',
    delayOn: false,
    delayMs: 0,
    muteGroups: [],
    cue: false,
    mtxSends,
    balance: 0,
  };
}

export function defaultOutPatch(model: ConsoleModel): Record<string, OutPortState> {
  const out: Record<string, OutPortState> = {};
  for (const p of model.outPorts) out[p.id] = { source: null, att: 0 };
  for (let n = 1; n <= 6; n++) out[`omni${n}`].source = `mix${n}`;
  out.omni7.source = 'st_l';
  out.omni8.source = 'st_r';
  for (let n = 1; n <= 16; n++) if (out[`usbo${n}`]) out[`usbo${n}`].source = `dir_ch${n}`;
  out.usbo17.source = 'st_l';
  out.usbo18.source = 'st_r';
  return out;
}

export function defaultConsoleState(model: ConsoleModel): ConsoleState {
  const channels: ConsoleState['channels'] = {};
  for (const c of model.channels) channels[c.id] = defaultChannel(model, c.id);
  const buses: ConsoleState['buses'] = {};
  for (const b of model.buses) buses[b.id] = defaultBus(model, b.id);
  const ports: ConsoleState['ports'] = {};
  for (const p of model.inPorts) ports[p.id] = { gain: 0, phantom: false };
  ports.in8.gain = 24; // browser microphone arrives at "mic level"
  return {
    version: STATE_VERSION,
    channels,
    buses,
    pairLinked: { mix12: false, mix34: false, mix56: false, mtx12: true },
    ports,
    outPorts: defaultOutPatch(model),
    dcas: Array.from({ length: model.dcaCount }, (_, i) => ({ name: `DCA ${i + 1}`, level: 0, on: true })),
    muteGroups: Array.from({ length: model.muteGroupCount }, (_, i) => ({ name: `MUTE ${i + 1}`, on: false })),
    talkback: { on: false, source: 'in8', level: 0, assign: ['mix1', 'mix2', 'mix3', 'mix4'] },
    osc: { on: false, type: 'pink', freq: 1000, level: -20, assign: [] },
    fx: [
      { type: 'reverb-hall', time: 2.2, predelay: 20, feedback: 0, hiCut: 7000, loCut: 150, rate: 0.5, depth: 0.5 },
      { type: 'delay-stereo', time: 400, predelay: 0, feedback: 0.35, hiCut: 5000, loCut: 150, rate: 0.5, depth: 0.5 },
    ],
    monitor: { source: 'st', cueMode: 'PFL', level: -10 },
  };
}

export function defaultRig(): RigState {
  return {
    plugs: {
      in1: { device: 'p1', ch: 'SUM' },
      in2: { device: 'p2', ch: 'SUM' },
      in3: { device: 'p3', ch: 'SUM' },
      in4: { device: 'p4', ch: 'SUM' },
      in5: { device: 'p5', ch: 'SUM' },
      in6: { device: 'p6', ch: 'SUM' },
      in8: { device: 'mic', ch: 'SUM' },
      in16: { device: 'gen', ch: 'SUM' },
      usb17: { device: 'p7', ch: 'L' },
      usb18: { device: 'p7', ch: 'R' },
    },
    kinds: { mic: 'dynamic' },
    generator: { type: 'sine', freq: 1000, level: -18, on: false },
    players: [
      { name: 'Vocal (synth)', source: 'stem', stem: 'vox', loop: true, level: 0 },
      { name: 'Kick', source: 'stem', stem: 'kick', loop: true, level: 0 },
      { name: 'Snare', source: 'stem', stem: 'snare', loop: true, level: 0 },
      { name: 'Hi-Hat', source: 'stem', stem: 'hats', loop: true, level: 0 },
      { name: 'Bass', source: 'stem', stem: 'bass', loop: true, level: 0 },
      { name: 'Keys', source: 'stem', stem: 'keys', loop: true, level: 0 },
      { name: 'Backing Track', source: 'stem', stem: 'backing', loop: true, level: 0 },
      { name: 'Player 8', source: 'none', loop: true, level: 0 },
    ],
    micLevel: -20,
    listen: { mode: 'ports', l: 'omni7', r: 'omni8', volume: -6 },
    output: { sinkId: '', mode: 'stereo' },
    outNames: {
      omni1: 'Wedge 1 (Vocal)',
      omni2: 'Wedge 2 (Keys)',
      omni3: 'Wedge 3 (Drums)',
      omni4: 'Wedge 4 (Bass)',
      omni5: 'IEM L',
      omni6: 'IEM R',
      omni7: 'FOH PA L',
      omni8: 'FOH PA R',
    },
  };
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** Fill anything missing in `target` from `defaults` (recursively, objects only). */
function fill(target: Record<string, unknown>, defaults: Record<string, unknown>) {
  for (const [k, dv] of Object.entries(defaults)) {
    const tv = target[k];
    if (tv === undefined) target[k] = structuredClone(dv);
    else if (isObj(tv) && isObj(dv)) fill(tv, dv);
  }
}

/**
 * Upgrade a stored console state (autosave, scene, import) from an older
 * version of the simulator by filling every missing parameter with its default.
 * Returns null if it is not a console state at all.
 */
export function migrateConsole(model: ConsoleModel, raw: unknown): ConsoleState | null {
  if (!isObj(raw) || !isObj(raw.channels) || !isObj(raw.buses) || !isObj(raw.outPorts)) return null;
  const v = typeof raw.version === 'number' ? raw.version : 0;
  if (v < 1 || v > STATE_VERSION) return null;
  const s = structuredClone(raw) as Record<string, unknown>;
  fill(s, defaultConsoleState(model) as unknown as Record<string, unknown>);
  s.version = STATE_VERSION;
  const c = s as unknown as ConsoleState;
  // drop features the console does not have / clamp to its ranges
  c.dcas = c.dcas.slice(0, model.dcaCount);
  for (const ch of Object.values(c.channels)) {
    ch.dca = ch.dca.filter((n) => n <= model.dcaCount);
    ch.digitalGain = Math.max(model.digitalGainRange[0], Math.min(model.digitalGainRange[1], ch.digitalGain));
  }
  if (!model.features.talkback) c.talkback.on = false;
  return c;
}

export function migrateRig(raw: unknown): RigState | null {
  if (!isObj(raw) || !isObj(raw.plugs) || !Array.isArray(raw.players) || raw.players.length !== 8) return null;
  const r = structuredClone(raw) as Record<string, unknown>;
  fill(r, defaultRig() as unknown as Record<string, unknown>);
  return r as unknown as RigState;
}
