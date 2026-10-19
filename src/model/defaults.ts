import type {
  BusState,
  ChannelState,
  CompState,
  ConsoleModel,
  ConsoleState,
  EqBand,
  OutPortState,
  RigState,
} from './types';
import { NEG_INF } from './types';

export const STATE_VERSION = 1;

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
    if (b.kind === 'mix' || b.kind === 'fx') {
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
    comp: defaultComp(),
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
  for (const p of model.inPorts) ports[p.id] = { gain: 0 };
  ports.in8.gain = 24; // browser microphone arrives at "mic level"
  return {
    version: STATE_VERSION,
    channels,
    buses,
    pairLinked: { mix12: false, mix34: false, mix56: false, mtx12: true },
    ports,
    outPorts: defaultOutPatch(model),
    dcas: Array.from({ length: model.dcaCount }, (_, i) => ({ name: `DCA ${i + 1}`, level: 0, on: true })),
    fx: [
      { type: 'reverb-hall', time: 2.2, predelay: 20, feedback: 0, hiCut: 7000, loCut: 150 },
      { type: 'delay-stereo', time: 400, predelay: 0, feedback: 0.35, hiCut: 5000, loCut: 150 },
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
