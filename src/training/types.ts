// Contracts for guided exercises (Academy) and fault-finding scenarios (Training).
//
// ROUTING GRAPH NODE IDS (see src/engine/routing.ts):
//   dev:<device>        device: 'mic' | 'gen' | 'p1'..'p8' (p1 vocal, p2 kick, p3 snare,
//                       p4 hats, p5 bass, p6 keys, p7 backing track (stereo), p8 empty)
//   port:<inPortId>     input sockets: in1..in16, usb1..usb18, dante1..dante16 (DM3 only)
//   ch:<chId>           channel input (after input patch) - ch1..ch16, stin, fxr1, fxr2
//   ch:<chId>:pre       after channel ON (pre-fader point)
//   ch:<chId>:post      after channel fader
//   bus:<busId>         bus sum: st, mix1..mix6, fx1, fx2, mtx1, mtx2, cue
//   bus:<busId>:out     after bus master ON + fader
//   fx:<n>              FX rack 1/2 (fed by bus:fx<n>:out, returns into ch:fxr<n>)
//   psrc:<id>           output-patch source: st_l st_r mix1..6 mtx1 mtx2 mon_l mon_r dir_ch1..16
//   out:<outPortId>     output sockets: omni1..omni8, usbo1..usbo18, danteo1..16
//   mon / phones        monitor bus / headphone out
//   listen              the browser speakers (whatever output the user is listening to)
//
// LIVE METER TAP IDS (dBFS measured from audio, NEG_INF when silent/audio off):
//   dev.p1..dev.p8, dev.mic, dev.gen        device outputs
//   port.<inPortId>                          after head amp
//   ch.<chId>.in / .pre / .post              channel: after digital gain / before ON / after fader
//   ch.<chId>.gr                             compressor gain reduction (use ctx.gr)
//   bus.<busId>.in / .out                    bus sum / after master
//   fx.1.out, fx.2.out                       FX rack outputs
//   out.<outPortId>                          output sockets
//   listen                                   browser output (post protective limiter)
//
// Default rig (src/model/defaults.ts): p1..p6 -> in1..in6 (ch1 Vocal, ch2 Kick, ch3 Snare,
// ch4 Hi-Hat, ch5 Bass, ch6 Keys), mic -> in8 (ch8), gen -> in16 (ch16), p7 L/R -> usb17/18
// -> ST IN "Backing". Outputs: omni1..6 <- MIX1..6 (Wedge 1 Vocal, Wedge 2 Keys, Wedge 3 Drums,
// Wedge 4 Bass, IEM L, IEM R), omni7/8 <- STEREO L/R (FOH PA). Browser listens to omni7/8.

import type { ConsoleModel, ConsoleState, RigState } from '../model/types';
import type { RGraph } from '../engine/routing';

export interface CheckCtx {
  model: ConsoleModel;
  state: ConsoleState;
  rig: RigState;
  graph: RGraph;
  /** Nominal routing gain in dB between two graph nodes (NEG_INF if no live path). */
  gain: (from: string, to: string) => number;
  /** Live measured peak in dBFS at a meter tap (NEG_INF if silent or audio not running). */
  peak: (tap: string) => number;
  /** Live compressor gain reduction in dB (<= 0) for 'ch.<id>.gr' / 'bus.<id>.gr'. */
  gr: (tap: string) => number;
  /** True when the audio engine is running. */
  audio: boolean;
  /** Whether player i (0-based) is currently playing. */
  playing: (i: number) => boolean;
}

export interface CheckResult {
  ok: boolean;
  /** Short status lines shown to the learner (what is satisfied / still missing). */
  detail: string[];
}

export interface Exercise {
  id: string;
  level: 'beginner' | 'intermediate' | 'advanced';
  title: string;
  goal: string;
  steps: string[];
  hints: string[];
  /** Optional: prepare the console (mutates a fresh default console + rig). */
  setup?: (s: ConsoleState, r: RigState, m: ConsoleModel) => void;
  check: (ctx: CheckCtx) => CheckResult;
}

export interface Scenario {
  id: string;
  title: string;
  difficulty: 1 | 2 | 3;
  /** The complaint as a performer / director would report it. Does not reveal the cause. */
  brief: string;
  /** Inject the fault(s) into a fresh default console + rig. */
  setup: (s: ConsoleState, r: RigState, m: ConsoleModel) => void;
  hints: string[]; // progressively more specific
  solution: string; // full explanation, revealed on request
  /** The signal path the learner should trace (graph node ids) - used by "reveal path". */
  trace: { from: string; to: string };
  check: (ctx: CheckCtx) => CheckResult;
}
