// Generic console data model. Nothing in here is DM3-specific: the hardware
// description (counts, port names, patch rules) lives in ./dm3.ts and is
// consumed by the generic engine through the ConsoleModel interface.

export const NEG_INF = -140; // dB value treated as -infinity (fully off)

export type ChannelKind = 'mono' | 'stereo' | 'fxreturn';
export type BusKind = 'stereo' | 'mix' | 'fx' | 'matrix';

export interface ChannelDef {
  id: string; // e.g. ch1, stin, fxr1
  kind: ChannelKind;
  defaultName: string;
  short: string; // label on strip
  fxRack?: number; // for FX return channels: which rack feeds it
}

export interface BusDef {
  id: string; // st, mix1.., fx1.., mtx1..
  kind: BusKind;
  defaultName: string;
  short: string;
  pair?: number; // stereo-link pair index (mix/matrix)
}

export interface InPortDef {
  id: string;
  group: 'analog' | 'usb' | 'dante';
  label: string;
  hasPreamp: boolean; // analog head amp (gain range below) vs digital port
}

export interface OutPortDef {
  id: string;
  group: 'analog' | 'usb' | 'dante';
  label: string;
}

export interface PatchSourceDef {
  id: string;
  label: string;
  group: string;
  allowed: boolean; // false = listed but not routable on this hardware
  reason?: string; // shown when not allowed
}

export interface ConsoleModel {
  id: string;
  name: string;
  channels: ChannelDef[];
  buses: BusDef[];
  inPorts: InPortDef[];
  outPorts: OutPortDef[];
  patchSources: PatchSourceDef[];
  dcaCount: number; // 0 = the console has no DCA groups
  muteGroupCount: number;
  maxScenes: number;
  features: {
    talkback: boolean; // dedicated talkback function
    focus: boolean; // per-scene recall focus
  };
  geqBuses: string[]; // buses that can take the 31-band GEQ
  maxDelayMs: number;
  fxRackCount: number;
  haGainRange: [number, number];
  digitalGainRange: [number, number];
  notes: string[];
}

// ---------------------------------------------------------------- state ----

export interface EqBand {
  type: 'peak' | 'lowshelf' | 'highshelf' | 'lowpass';
  freq: number;
  gain: number;
  q: number;
}

export interface CompState {
  on: boolean;
  threshold: number; // dBFS
  ratio: number;
  attack: number; // ms
  release: number; // ms
  knee: number; // dB (soft-knee width)
  makeup: number; // dB ("OUT GAIN")
  key: 'post' | 'pre'; // key-in: self post-EQ (normal) or self pre-EQ
  oneKnob: boolean; // 1-knob mode: one control drives threshold / ratio / out gain
  amount: number; // 0..10 in 1-knob mode
}

export interface GateState {
  on: boolean;
  mode: 'gate' | 'ducker';
  threshold: number; // dBFS
  range: number; // dB of attenuation when closed (gate) / ducked (ducker), negative
  attack: number; // ms
  hold: number; // ms
  decay: number; // ms
  // key-in: 'self' (self post-EQ), 'self-pre' (self pre-EQ), a channel id
  // (that channel after its digital gain) or a mix bus id (bus output)
  key: string;
}

export interface SendState {
  on: boolean;
  level: number; // dB
  pre: boolean; // pre-fader (true) / post-fader (false)
  pan: number; // used only when the destination mix pair is stereo-linked
}

export interface ChannelState {
  name: string;
  color: string;
  patchL: string | null; // input port feeding the channel (L for stereo)
  patchR: string | null; // stereo channels only
  digitalGain: number;
  polarity: boolean; // true = inverted
  hpfOn: boolean;
  hpfFreq: number;
  eqOn: boolean;
  eq: EqBand[];
  gate: GateState; // Dynamics 1
  comp: CompState; // Dynamics 2
  delayOn: boolean;
  delayMs: number; // input delay 0..1000 ms
  muteGroups: number[]; // 1-based
  on: boolean; // Yamaha "ON" key: true = channel live, false = muted
  fader: number; // dB
  pan: number; // -63..63
  toSt: boolean;
  cue: boolean;
  dca: number[]; // DCA group membership (1-based)
  sends: Record<string, SendState>; // keyed by mix / fx / matrix bus id
}

export interface BusState {
  name: string;
  color: string;
  on: boolean;
  fader: number;
  eqOn: boolean;
  eq: EqBand[];
  comp: CompState;
  geqOn: boolean;
  geq: number[]; // 31-band graphic EQ gains (dB), STEREO + MIX buses only
  prePoint: 'fader' | 'eq'; // mix buses: where PRE sends are taken (BUS SETUP)
  delayOn: boolean;
  delayMs: number; // output delay 0..1000 ms
  muteGroups: number[];
  cue: boolean;
  // matrix sends from this bus (stereo + mix buses only)
  mtxSends: Record<string, { on: boolean; level: number }>;
  balance: number; // stereo bus / linked pairs: L-R balance
}

export interface PortState {
  gain: number; // analog head-amp gain (dB) - only for ports with preamps
  phantom: boolean; // +48V
}

export interface OutPortState {
  source: string | null; // patch source id
  att: number; // output port attenuation dB (<= 0)
}

export interface DcaState {
  name: string;
  level: number;
  on: boolean;
}

export type FxType =
  | 'reverb-hall'
  | 'reverb-room'
  | 'reverb-plate'
  | 'early-ref'
  | 'delay-stereo'
  | 'delay-mono'
  | 'chorus'
  | 'flanger'
  | 'phaser'
  | 'tremolo';

export interface FxState {
  type: FxType;
  time: number; // reverb decay (s) or delay time (ms)
  predelay: number; // ms (reverb)
  feedback: number; // 0..0.95 (delay)
  hiCut: number; // Hz damping
  loCut: number; // Hz
  rate: number; // Hz (modulation effects)
  depth: number; // 0..1 (modulation effects)
}

export interface MuteGroupState {
  name: string;
  on: boolean; // engaged = members muted
}

export interface TalkbackState {
  on: boolean;
  source: string | null; // input port id used as talkback mic
  level: number; // dB
  assign: string[]; // bus ids
}

export interface OscState {
  on: boolean;
  type: 'sine' | 'pink' | 'burst';
  freq: number;
  level: number; // dBFS
  assign: string[]; // bus ids
}

export interface ConsoleState {
  version: number;
  channels: Record<string, ChannelState>;
  buses: Record<string, BusState>;
  pairLinked: Record<string, boolean>; // 'mix12','mix34','mix56','mtx12' -> stereo
  ports: Record<string, PortState>;
  outPorts: Record<string, OutPortState>;
  dcas: DcaState[];
  muteGroups: MuteGroupState[];
  talkback: TalkbackState;
  osc: OscState;
  fx: FxState[];
  monitor: {
    source: string; // 'st' | mix bus id
    cueMode: 'PFL' | 'AFL';
    level: number; // monitor / phones level dB
  };
}

// --------------------------------------------------------- rig (physical) --
// What is physically plugged into the console. Not part of console scenes.

export type DeviceId = string; // 'mic' | 'gen' | 'p1'..'p8' | 'loop:<outPortId>'

export interface Plug {
  device: DeviceId;
  ch: 'L' | 'R' | 'SUM';
}

export interface GeneratorState {
  type: 'sine' | 'pink' | 'white' | 'impulse' | 'sweep' | 'burst';
  freq: number;
  level: number; // dBFS
  on: boolean;
}

export interface PlayerState {
  name: string;
  source: 'none' | 'stem' | 'file';
  stem?: string;
  loop: boolean;
  level: number; // dB trim of the playback device itself
}

export type DeviceKind = 'line' | 'dynamic' | 'condenser';

export interface RigState {
  plugs: Record<string, Plug | null>; // keyed by input port id
  kinds: Record<string, DeviceKind>; // what each device behaves like electrically
  generator: GeneratorState;
  players: PlayerState[];
  micLevel: number; // dB offset applied to the browser microphone ("mic level")
  listen: {
    mode: 'ports' | 'phones';
    l: string | null; // output port id
    r: string | null;
    volume: number; // browser output volume dB
  };
  output: {
    sinkId: string; // '' = system default audio device
    mode: 'stereo' | 'multi'; // multi: OMNI OUT n -> interface output n
  };
  outNames: Record<string, string>; // what is connected to each output ("Wedge 1")
}
