import { describe, expect, it } from 'vitest';
import { buildDm3Model } from '../model/dm3';
import { defaultConsoleState, defaultRig } from '../model/defaults';
import type { ConsoleModel, ConsoleState, RigState } from '../model/types';
import { NEG_INF } from '../model/types';
import { buildRoutingGraph, gainToDb, pathGain } from '../engine/routing';
import type { CheckCtx } from './types';
import { SCENARIOS } from './scenarios';
import { EXERCISES } from './exercises';

type Fix = (s: ConsoleState, r: RigState) => void;

interface Opts {
  audio?: boolean;
  peak?: (tap: string) => number;
  gr?: (tap: string) => number;
  playing?: boolean;
}

function fresh(): { model: ConsoleModel; s: ConsoleState; r: RigState } {
  const model = buildDm3Model(true);
  return { model, s: defaultConsoleState(model), r: defaultRig() };
}

function makeCtx(model: ConsoleModel, s: ConsoleState, r: RigState, o: Opts = {}): CheckCtx {
  const graph = buildRoutingGraph(model, s, r);
  const audio = o.audio ?? false;
  return {
    model,
    state: s,
    rig: r,
    graph,
    gain: (a, b) => gainToDb(pathGain(graph, a, b)),
    peak: (tap) => (audio && o.peak ? o.peak(tap) : NEG_INF),
    gr: (tap) => (audio && o.gr ? o.gr(tap) : 0),
    audio,
    playing: () => audio && !!o.playing,
  };
}

const goodPeaks = (tap: string): number => (tap === 'dev.mic' ? -30 : -12);
const loud: Opts = { audio: true, peak: goodPeaks, playing: true };
const silent: Opts = { audio: true, peak: () => NEG_INF, playing: false };

// ------------------------------------------------------------- scenarios ----

const SCENARIO_FIX: Record<string, Fix> = {
  'silent-in-main-mix': (s) => {
    s.channels.ch1.toSt = true;
  },
  'missing-from-monitor': (s) => {
    s.channels.ch1.sends.mix1.on = true;
  },
  'bus-moving-no-output': (s) => {
    s.outPorts.omni1.source = 'mix1';
  },
  'wrong-output-patch': (s) => {
    s.outPorts.omni1.source = 'mix1';
  },
  'muted-bus-master': (s) => {
    s.buses.mix1.on = true;
  },
  'wrong-send-destination': (s) => {
    s.channels.ch1.sends.mix1.level = -3;
    s.channels.ch1.sends.mix2.level = NEG_INF;
  },
  'kick-vanishes-drum-wedge': (s) => {
    s.channels.ch2.sends.mix3.pre = true;
  },
  'clipping-input-gain': (s) => {
    s.ports.in1.gain = 10;
    s.channels.ch1.fader = -10;
  },
  'compressor-squashing': (s) => {
    s.channels.ch1.comp.on = false;
  },
  'feedback-loop': (_s, r) => {
    r.plugs.in12 = null;
  },
  'reverb-return-silent': (s) => {
    s.channels.fxr1.on = true;
  },
  'multi-mutegroup-and-patch': (s) => {
    s.muteGroups[2].on = false;
    s.outPorts.omni1.source = 'mix1';
  },
  'multi-keys-wedge-dead': (s) => {
    s.channels.ch6.sends.mix2.level = -3;
    s.channels.stin.sends.mix2.on = true;
    s.outPorts.omni2.att = 0;
  },
  'phantom-off-condenser': (s) => {
    s.ports.in1.phantom = true;
  },
  'mute-group-engaged': (s) => {
    s.muteGroups[0].on = false;
  },
  'gate-chopping-vocal': (s) => {
    s.channels.ch1.gate.on = false;
  },
  'oscillator-left-on': (s) => {
    s.osc.on = false;
  },
  'talkback-channel-left-on': (s) => {
    s.channels.ch8.on = false;
  },
  'ducker-wrong-key': (s) => {
    s.channels.ch6.gate.key = 'ch1';
  },
  'delay-misaligned': (s) => {
    s.buses.mtx1.delayMs = 30;
  },
};

/** Plausible wrong "fixes" that must be rejected. */
const SCENARIO_BAD: Record<string, Fix[]> = {
  'silent-in-main-mix': [
    (s) => {
      s.channels.ch1.toSt = true;
      s.channels.ch1.fader = 10;
    },
    (s) => {
      s.channels.ch1.fader = 0; // still not assigned
    },
  ],
  'missing-from-monitor': [
    (s) => {
      s.channels.ch1.sends.mix1.on = true;
      s.channels.ch1.sends.mix1.level = 10;
    },
  ],
  'kick-vanishes-drum-wedge': [
    (s) => {
      s.channels.ch2.fader = 0; // raising the FOH fader is not the fix
    },
  ],
  'clipping-input-gain': [
    (s) => {
      s.channels.ch1.fader = -10; // fader only, gain still hot
    },
    (s) => {
      s.ports.in1.gain = 10; // gain only, fader still way down
    },
  ],
  'compressor-squashing': [
    (s) => {
      s.channels.ch1.comp.makeup = 20; // makeup does not cure the squash
    },
  ],
  'reverb-return-silent': [
    (s) => {
      s.channels.fxr1.fader = NEG_INF;
      s.channels.fxr1.on = true;
    },
  ],
  'multi-mutegroup-and-patch': [
    (s) => {
      s.muteGroups[2].on = false; // patch still wrong
    },
    (s) => {
      s.outPorts.omni1.source = 'mix1'; // mute group still engaged
    },
    (s) => {
      s.channels.ch1.muteGroups = [];
      s.buses.mix2.on = false; // patch still wrong, keys wedge killed
    },
  ],
  'multi-keys-wedge-dead': [
    (s) => {
      s.channels.ch6.sends.mix2.level = -3;
      s.channels.stin.sends.mix2.on = true; // output attenuator still at -inf
    },
  ],
  'phantom-off-condenser': [
    (_s, r) => {
      r.kinds.p1 = 'line'; // pretending it is a line source hides the lesson
    },
    (s, r) => {
      r.plugs.in1 = { device: 'p2', ch: 'SUM' }; // plug something else in
      s.ports.in1.phantom = true;
    },
    (s) => {
      s.ports.in1.phantom = true;
      s.ports.in1.gain = 60; // phantom on but gain absurd
    },
    (s) => {
      s.ports.in1.phantom = true;
      s.channels.ch1.on = false;
    },
  ],
  'mute-group-engaged': [
    (s) => {
      s.muteGroups[0].on = false;
      s.channels.ch2.on = false; // fixed it by muting the drums
    },
    (s) => {
      s.muteGroups[0].on = false;
      s.channels.ch6.on = false; // keys muted again
    },
    (s) => {
      s.channels.ch1.muteGroups = []; // keys still stuck in the engaged group
    },
    (s) => {
      s.muteGroups[0].on = false;
      s.buses.mix3.on = false; // drum wedge killed
    },
  ],
  'gate-chopping-vocal': [
    (s) => {
      s.channels.ch1.gate.threshold = -25; // still too high
    },
    (s) => {
      s.channels.ch1.gate.range = -10; // threshold still way too high
    },
    (s) => {
      s.channels.ch1.gate.on = false;
      s.channels.ch1.fader = NEG_INF;
    },
    (s) => {
      s.channels.ch1.gate.mode = 'ducker'; // a ducker keyed from itself is no cure
      s.channels.ch1.gate.threshold = -50;
    },
  ],
  'oscillator-left-on': [
    (s) => {
      s.osc.level = -80; // still on and assigned to the wedges
    },
    (s) => {
      for (const b of ['mix1', 'mix2', 'mix3', 'mix4']) s.buses[b].on = false; // muting the wedges
    },
    (s) => {
      s.osc.assign = ['st']; // moved the noise into the PA
    },
    (s) => {
      s.outPorts.omni1.source = null;
      s.osc.on = false;
    },
  ],
  'talkback-channel-left-on': [
    (s) => {
      for (const b of ['mix1', 'mix2', 'mix3', 'mix4']) s.buses[b].on = false; // muting the wedges
    },
    (s) => {
      s.channels.ch8.fader = NEG_INF; // pre-fader sends ignore the fader
      s.channels.ch8.toSt = false;
    },
    (s) => {
      for (const b of ['mix1', 'mix2', 'mix3']) s.channels.ch8.sends[b].on = false; // Wedge 4 still gets chatter
    },
    (_s, r) => {
      r.plugs.in8 = null; // unplugged the mic: no talkback at all
    },
    (s) => {
      s.channels.ch8.on = false;
      s.channels.ch1.sends.mix1.on = false; // lost the vocal wedge
    },
  ],
  'ducker-wrong-key': [
    (s) => {
      s.channels.ch6.gate.key = 'self';
    },
    (s) => {
      s.channels.ch6.gate.key = 'self-pre';
    },
    (s) => {
      s.channels.ch6.gate.key = 'mix1'; // a wedge bus is not the singer
    },
    (s) => {
      s.channels.ch6.gate.key = 'ch1';
      s.channels.ch6.gate.mode = 'gate'; // a gate keyed by the vocal does the opposite
    },
    (s) => {
      s.channels.ch6.gate.key = 'ch1';
      s.channels.ch6.gate.range = -80; // ducks the keys out completely
    },
    (s) => {
      s.channels.ch6.gate.on = false;
      s.channels.ch6.on = false; // keys muted instead
    },
  ],
  'delay-misaligned': [
    (s) => {
      s.buses.mtx1.delayOn = false; // echo gone, alignment lost
    },
    (s) => {
      s.buses.mtx1.delayMs = 0;
    },
    (s) => {
      s.buses.mtx1.delayMs = 400; // still an echo
    },
    (s) => {
      s.buses.mtx1.delayMs = 30;
      s.buses.mtx1.on = false; // silenced the speakers
    },
  ],
};

describe('scenarios', () => {
  it('has the required ids, unique', () => {
    const ids = SCENARIOS.map((x) => x.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBeGreaterThanOrEqual(20);
    for (const sc of SCENARIOS) {
      expect(sc.hints.length).toBe(3);
      expect(sc.id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(SCENARIO_FIX[sc.id], `fix for ${sc.id}`).toBeTypeOf('function');
    }
  });

  describe.each(SCENARIOS)('$id', (sc) => {
    it('fault present after setup', () => {
      const { model, s, r } = fresh();
      sc.setup(s, r, model);
      const res = sc.check(makeCtx(model, s, r));
      expect(res.ok).toBe(false);
      expect(res.detail.length).toBeGreaterThan(0);
      const res2 = sc.check(makeCtx(model, s, r, loud));
      expect(res2.ok).toBe(false);
    });

    it('trace nodes exist in the graph', () => {
      const { model, s, r } = fresh();
      sc.setup(s, r, model);
      const g = buildRoutingGraph(model, s, r);
      const nodes = new Set<string>();
      for (const e of g.edges) {
        nodes.add(e.from);
        nodes.add(e.to);
      }
      expect(nodes.has(sc.trace.from), sc.trace.from).toBe(true);
      // an unpatched output has no incoming edge (that is the fault), so accept real output ports
      const isPort = model.outPorts.some((o) => `out:${o.id}` === sc.trace.to);
      expect(nodes.has(sc.trace.to) || isPort, sc.trace.to).toBe(true);
    });

    it('documented fix resolves it (audio off and on)', () => {
      const { model, s, r } = fresh();
      sc.setup(s, r, model);
      SCENARIO_FIX[sc.id](s, r);
      const off = sc.check(makeCtx(model, s, r));
      expect(off.detail.join('\n')).toBeTruthy();
      expect(off.ok, off.detail.join(' | ')).toBe(true);
      const on = sc.check(makeCtx(model, s, r, loud));
      expect(on.ok, on.detail.join(' | ')).toBe(true);
    });

    it('rejects bad fixes', () => {
      for (const bad of SCENARIO_BAD[sc.id] ?? []) {
        const { model, s, r } = fresh();
        sc.setup(s, r, model);
        bad(s, r);
        const res = sc.check(makeCtx(model, s, r));
        expect(res.ok, res.detail.join(' | ')).toBe(false);
      }
    });

    it('detail does not leak the answer before the fix', () => {
      const { model, s, r } = fresh();
      sc.setup(s, r, model);
      const text = sc.check(makeCtx(model, s, r)).detail.join(' ').toLowerCase();
      expect(text).not.toMatch(/switched off|muted|unpatched|post-fader|pre-fader/);
    });
  });

  it('multi-fault scenarios need every fix; loop accepts any break', () => {
    const sc = SCENARIOS.find((x) => x.id === 'feedback-loop')!;
    const fixes: Fix[] = [
      (_s, r) => {
        r.plugs.in12 = null;
      },
      (s) => {
        s.channels.ch12.sends.mix4.on = false;
      },
      (s) => {
        s.outPorts.omni4.source = null;
      },
      (s) => {
        s.channels.ch12.on = false;
      },
    ];
    for (const f of fixes) {
      const { model, s, r } = fresh();
      sc.setup(s, r, model);
      f(s, r);
      expect(sc.check(makeCtx(model, s, r)).ok).toBe(true);
    }
  });

  it('audio on but signal absent keeps routing scenarios unresolved; compressor GR matters', () => {
    const { model, s, r } = fresh();
    const sc = SCENARIOS.find((x) => x.id === 'silent-in-main-mix')!;
    sc.setup(s, r, model);
    SCENARIO_FIX[sc.id](s, r);
    expect(sc.check(makeCtx(model, s, r, silent)).ok).toBe(false);

    const comp = SCENARIOS.find((x) => x.id === 'compressor-squashing')!;
    const f2 = fresh();
    comp.setup(f2.s, f2.r, f2.model);
    f2.s.channels.ch1.comp.threshold = -18;
    f2.s.channels.ch1.comp.ratio = 3;
    expect(comp.check(makeCtx(f2.model, f2.s, f2.r, { ...loud, gr: () => -20 })).ok).toBe(false);
    expect(comp.check(makeCtx(f2.model, f2.s, f2.r, { ...loud, gr: () => -6 })).ok).toBe(true);
  });
});

// ------------------------------------------------------------- exercises ----

const EX_SOLUTION: Record<string, Fix> = {
  'connect-microphone': (_s, r) => {
    r.plugs.in8 = { device: 'mic', ch: 'SUM' };
  },
  'confirm-input-signal': () => {},
  'adjust-input-gain': (s) => {
    s.ports.in1.gain = 10;
  },
  'route-to-stereo': (s) => {
    s.channels.ch1.toSt = true;
  },
  'fader-and-mute': (s) => {
    s.channels.ch1.fader = -10;
    s.channels.ch1.on = false;
  },
  'route-to-mix-bus': (s) => {
    s.channels.ch1.sends.mix1 = { on: true, level: 0, pre: true, pan: 0 };
  },
  'build-monitor-mix': (s) => {
    s.outPorts.omni1.source = 'mix1';
    s.channels.ch1.sends.mix1 = { on: true, level: 0, pre: true, pan: 0 };
    s.channels.ch6.sends.mix1.level = -9;
    s.channels.stin.sends.mix1 = { on: true, level: -6, pre: true, pan: 0 };
  },
  'sends-on-fader': (s) => {
    for (const id of ['ch1', 'ch5', 'ch6']) s.channels[id].sends.mix2 = { on: true, level: -6, pre: true, pan: 0 };
  },
  'patch-bus-to-output': (s) => {
    s.outPorts.omni3.source = 'mix3';
  },
  'trace-input-to-output': () => {},
  'vocal-monitor-mix': (s) => {
    s.channels.ch1.sends.mix1 = { on: true, level: 0, pre: true, pan: 0 };
    s.channels.stin.sends.mix1 = { on: true, level: -9, pre: true, pan: 0 };
  },
  'drum-mix-and-mute-group': (s) => {
    for (const id of ['ch2', 'ch3', 'ch4']) {
      s.channels[id].sends.mix3 = { on: true, level: -3, pre: true, pan: 0 };
      s.channels[id].muteGroups = [1];
    }
  },
  'one-knob-compressor': (s) => {
    s.channels.ch1.comp.on = true;
    s.channels.ch1.comp.oneKnob = true;
    s.channels.ch1.comp.amount = 5;
  },
  'pre-fader-sends': (s) => {
    s.channels.ch1.sends.mix1.pre = true;
    s.channels.ch1.fader = -25;
  },
  'reverb-send-return': (s) => {
    s.channels.ch1.sends.fx1 = { on: true, level: -10, pre: false, pan: 0 };
    s.channels.fxr1.toSt = true;
  },
  'fix-incorrect-output-patch': (s) => {
    s.outPorts.omni1.source = 'mix1';
  },
  'compare-main-vs-monitor': (s) => {
    s.channels.ch1.sends.mix1 = { on: true, level: 0, pre: true, pan: 0 };
    s.channels.ch6.sends.mix1 = { on: true, level: -9, pre: true, pan: 0 };
    s.channels.ch6.fader = -8;
  },
  'diagnose-multiple-faults': (s) => {
    s.channels.ch1.sends.mix1.on = true;
    s.buses.mix1.on = true;
    s.outPorts.omni1.source = 'mix1';
  },
  'trace-iem-pair': (s) => {
    s.buses.mix5.fader = 0;
    s.outPorts.omni6.source = 'mix6';
  },
  'post-fader-fx-send': (s) => {
    s.channels.ch1.sends.fx1.pre = false;
  },
  'clipping-and-gain-staging': (s) => {
    s.ports.in1.gain = 10;
    s.channels.ch1.fader = -10;
    s.buses.st.fader = 0;
  },
  'complete-small-event': (s) => {
    for (const id of ['ch1', 'ch2', 'ch3', 'ch4', 'ch5', 'ch6', 'stin']) s.channels[id].toSt = true;
    s.channels.fxr1.toSt = true;
    s.outPorts.omni1.source = 'mix1';
    s.outPorts.omni3.source = 'mix3';
    s.outPorts.omni7.source = 'st_l';
    s.outPorts.omni8.source = 'st_r';
    s.channels.ch1.sends.mix1 = { on: true, level: 0, pre: true, pan: 0 };
    for (const id of ['ch2', 'ch3', 'ch4']) s.channels[id].sends.mix3 = { on: true, level: -3, pre: true, pan: 0 };
    s.channels.ch1.sends.fx1 = { on: true, level: -10, pre: false, pan: 0 };
  },
  'phantom-power': (s) => {
    s.ports.in1.phantom = true;
    s.ports.in1.gain = 10;
  },
  'noise-gate': (s) => {
    s.channels.ch3.gate = { on: true, mode: 'gate', threshold: -30, range: -40, attack: 1, hold: 50, decay: 150, key: 'self' };
  },
  'mute-groups': (s) => {
    for (const id of ['ch2', 'ch3', 'ch4']) s.channels[id].muteGroups = [2];
    s.muteGroups[1].on = true;
  },
  'input-to-matrix': (s) => {
    s.channels.ch1.sends.mtx1 = { on: true, level: -6, pre: false, pan: 0 };
  },
  'ducking-keys': (s) => {
    s.channels.ch6.gate = { on: true, mode: 'ducker', threshold: -30, range: -12, attack: 10, hold: 100, decay: 400, key: 'ch1' };
  },
  'ring-out-with-osc': (s) => {
    s.osc = { on: true, type: 'pink', freq: 1000, level: -20, assign: ['mix1'] };
    s.buses.mix1.geqOn = true;
    s.buses.mix1.geq[17] = -6;
  },
  'delay-speaker-alignment': (s) => {
    s.buses.st.mtxSends.mtx1 = { on: true, level: 0 };
    s.outPorts.omni5.source = 'mtx1';
    s.buses.mtx1.delayOn = true;
    s.buses.mtx1.delayMs = 40;
  },
};

/** Exercises that are pure state/routing: signal only matters while audio runs. */
const HARD = new Set([
  'connect-microphone',
  'confirm-input-signal',
  'adjust-input-gain',
  'trace-input-to-output',
  'clipping-and-gain-staging',
  'phantom-power',
]);
/** Whose initial (post-setup) state already satisfies the check once signal is stubbed in. */
const SIGNAL_ONLY = new Set(['confirm-input-signal', 'adjust-input-gain', 'trace-input-to-output']);
/** No signal items at all. */
const NO_SIGNAL = new Set(['fader-and-mute', 'sends-on-fader', 'patch-bus-to-output', 'compare-main-vs-monitor']);

describe('exercises', () => {
  it('counts and ordering', () => {
    const byLevel = (l: string) => EXERCISES.filter((e) => e.level === l).length;
    expect(byLevel('beginner')).toBe(11);
    expect(byLevel('intermediate')).toBe(10);
    expect(byLevel('advanced')).toBe(8);
    expect(new Set(EXERCISES.map((e) => e.id)).size).toBe(EXERCISES.length);
    const order = EXERCISES.map((e) => e.level);
    expect(order).toEqual([...order].sort((a, b) => ['beginner', 'intermediate', 'advanced'].indexOf(a) - ['beginner', 'intermediate', 'advanced'].indexOf(b)));
    for (const ex of EXERCISES) {
      expect(EX_SOLUTION[ex.id], `solution for ${ex.id}`).toBeTypeOf('function');
      expect(ex.steps.length).toBeGreaterThan(2);
      expect(ex.hints.length).toBeGreaterThan(0);
    }
  });

  describe.each(EXERCISES)('$id', (ex) => {
    it('is not complete right after setup', () => {
      const { model, s, r } = fresh();
      ex.setup?.(s, r, model);
      expect(ex.check(makeCtx(model, s, r)).ok).toBe(false);
      if (!SIGNAL_ONLY.has(ex.id)) {
        const res = ex.check(makeCtx(model, s, r, loud));
        expect(res.ok, res.detail.join(' | ')).toBe(false);
      }
    });

    it('solution passes', () => {
      const { model, s, r } = fresh();
      ex.setup?.(s, r, model);
      EX_SOLUTION[ex.id](s, r);
      const off = ex.check(makeCtx(model, s, r));
      if (HARD.has(ex.id)) {
        expect(off.ok).toBe(false);
        expect(off.detail).toContain('Start audio (POWER button) to verify by signal');
      } else {
        expect(off.ok, off.detail.join(' | ')).toBe(true);
      }
      const on = ex.check(makeCtx(model, s, r, loud));
      expect(on.ok, on.detail.join(' | ')).toBe(true);
    });

    it('requires live signal when audio is running', () => {
      if (NO_SIGNAL.has(ex.id)) return;
      const { model, s, r } = fresh();
      ex.setup?.(s, r, model);
      EX_SOLUTION[ex.id](s, r);
      const res = ex.check(makeCtx(model, s, r, silent));
      expect(res.ok, res.detail.join(' | ')).toBe(false);
    });
  });

  it('specific negative cases', () => {
    const get = (id: string) => EXERCISES.find((e) => e.id === id)!;
    // patch-bus-to-output: stealing OMNI 1 breaks Wedge 1
    {
      const { model, s, r } = fresh();
      const ex = get('patch-bus-to-output');
      ex.setup?.(s, r, model);
      s.outPorts.omni1.source = 'mix3';
      expect(ex.check(makeCtx(model, s, r)).ok).toBe(false);
    }
    // post-fader fx send: pre send rejected
    {
      const { model, s, r } = fresh();
      const ex = get('post-fader-fx-send');
      ex.setup?.(s, r, model);
      s.channels.ch1.fader = -5;
      expect(ex.check(makeCtx(model, s, r)).ok).toBe(false);
    }
    // iem pair: only one side fixed
    {
      const { model, s, r } = fresh();
      const ex = get('trace-iem-pair');
      ex.setup?.(s, r, model);
      s.buses.mix5.fader = 0;
      const res = ex.check(makeCtx(model, s, r));
      expect(res.ok).toBe(false);
      expect(res.detail.some((d) => d.startsWith('✓'))).toBe(true);
      expect(res.detail.some((d) => d.startsWith('✗'))).toBe(true);
    }
    // connect mic: no device -> cannot pass even with signal
    {
      const { model, s, r } = fresh();
      const ex = get('connect-microphone');
      ex.setup?.(s, r, model);
      expect(ex.check(makeCtx(model, s, r, loud)).ok).toBe(false);
    }
  });

  it('new-feature exercises: specific negative cases', () => {
    const get = (id: string) => EXERCISES.find((e) => e.id === id)!;
    const run = (id: string, mutate: Fix, o?: Opts) => {
      const { model, s, r } = fresh();
      const ex = get(id);
      ex.setup?.(s, r, model);
      EX_SOLUTION[id](s, r);
      mutate(s, r);
      return ex.check(makeCtx(model, s, r, o)).ok;
    };
    // phantom: gain too hot / too quiet by signal; phantom missing
    expect(run('phantom-power', (s) => { s.ports.in1.phantom = false; }, loud)).toBe(false);
    expect(run('phantom-power', () => {}, { audio: true, peak: () => -2, playing: true })).toBe(false);
    expect(run('phantom-power', () => {}, { audio: true, peak: () => -40, playing: true })).toBe(false);
    expect(run('phantom-power', () => {}, { audio: true, peak: () => -20, playing: true })).toBe(true);
    // gate: threshold out of range, wrong mode, shallow range
    expect(run('noise-gate', (s) => { s.channels.ch3.gate.threshold = -50; })).toBe(false);
    expect(run('noise-gate', (s) => { s.channels.ch3.gate.threshold = -10; })).toBe(false);
    expect(run('noise-gate', (s) => { s.channels.ch3.gate.range = -10; })).toBe(false);
    expect(run('noise-gate', (s) => { s.channels.ch3.gate.mode = 'ducker'; })).toBe(false);
    expect(run('noise-gate', (s) => { s.channels.ch3.gate.on = false; })).toBe(false);
    // mute group: group not engaged, one drum missing, muted with ON key instead, vocal in group
    expect(run('mute-groups', (s) => { s.muteGroups[1].on = false; })).toBe(false);
    expect(run('mute-groups', (s) => { s.channels.ch4.muteGroups = []; })).toBe(false);
    expect(run('mute-groups', (s) => { s.channels.ch1.muteGroups = [2]; })).toBe(false);
    expect(run('mute-groups', (s) => { s.channels.ch2.on = false; })).toBe(false);
    // matrix send
    expect(run('input-to-matrix', (s) => { s.channels.ch1.sends.mtx1.on = false; })).toBe(false);
    expect(run('input-to-matrix', (s) => { s.channels.ch1.sends.mtx1.level = -30; })).toBe(false);
    expect(run('input-to-matrix', (s) => { s.channels.ch1.toSt = false; })).toBe(false);
    // ducker (on a mono channel: Dynamics 1 does not exist on ST IN)
    expect(run('ducking-keys', (s) => { s.channels.ch6.gate.mode = 'gate'; })).toBe(false);
    expect(run('ducking-keys', (s) => { s.channels.ch6.gate.key = 'self'; })).toBe(false);
    expect(run('ducking-keys', (s) => { s.channels.ch6.gate.key = 'self-pre'; })).toBe(false);
    expect(run('ducking-keys', (s) => { s.channels.ch6.gate.key = 'ch2'; })).toBe(false);
    expect(run('ducking-keys', (s) => { s.channels.ch6.gate.range = -40; })).toBe(false);
    expect(run('ducking-keys', (s) => { s.channels.ch6.gate.range = -3; })).toBe(false);
    expect(run('ducking-keys', (s) => { s.channels.ch6.gate.on = false; })).toBe(false);
    // drum mute group: not shared, engaged (drums silent), vocal included
    expect(run('drum-mix-and-mute-group', (s) => { s.channels.ch4.muteGroups = [2]; })).toBe(false);
    expect(run('drum-mix-and-mute-group', (s) => { s.muteGroups[0].on = true; })).toBe(false);
    expect(run('drum-mix-and-mute-group', (s) => { s.channels.ch1.muteGroups = [1]; })).toBe(false);
    expect(run('drum-mix-and-mute-group', (s) => { s.channels.ch3.sends.mix3.on = false; })).toBe(false);
    // 1-knob compressor
    expect(run('one-knob-compressor', (s) => { s.channels.ch1.comp.oneKnob = false; })).toBe(false);
    expect(run('one-knob-compressor', (s) => { s.channels.ch1.comp.on = false; })).toBe(false);
    expect(run('one-knob-compressor', (s) => { s.channels.ch1.comp.amount = 10; })).toBe(false);
    expect(run('one-knob-compressor', (s) => { s.channels.ch1.comp.amount = 1; })).toBe(false);
    expect(run('one-knob-compressor', (s) => { s.channels.ch1.toSt = false; })).toBe(false);
    expect(run('one-knob-compressor', () => {}, { ...loud, gr: () => -20 })).toBe(false);
    expect(run('one-knob-compressor', () => {}, { ...loud, gr: () => -6 })).toBe(true);
    // oscillator ring-out
    expect(run('ring-out-with-osc', (s) => { s.osc.assign = ['mix1', 'mix2']; })).toBe(false);
    expect(run('ring-out-with-osc', (s) => { s.osc.assign = ['st']; })).toBe(false);
    expect(run('ring-out-with-osc', (s) => { s.osc.on = false; })).toBe(false);
    expect(run('ring-out-with-osc', (s) => { s.osc.type = 'sine'; })).toBe(false);
    expect(run('ring-out-with-osc', (s) => { s.buses.mix1.geqOn = false; })).toBe(false);
    expect(run('ring-out-with-osc', (s) => { s.buses.mix1.geq[17] = -1; })).toBe(false);
    expect(run('ring-out-with-osc', (s) => { s.buses.mix1.on = false; })).toBe(false);
    // delay speakers
    expect(run('delay-speaker-alignment', (s) => { s.buses.mtx1.delayMs = 5; })).toBe(false);
    expect(run('delay-speaker-alignment', (s) => { s.buses.mtx1.delayMs = 200; })).toBe(false);
    expect(run('delay-speaker-alignment', (s) => { s.buses.mtx1.delayOn = false; })).toBe(false);
    expect(run('delay-speaker-alignment', (s) => { s.outPorts.omni5.source = 'mix5'; })).toBe(false);
    expect(run('delay-speaker-alignment', (s) => { s.buses.st.mtxSends.mtx1.level = -40; })).toBe(false);
  });

  it('new-feature exercises: soft ones pass with audio off', () => {
    for (const id of ['noise-gate', 'mute-groups', 'drum-mix-and-mute-group', 'one-knob-compressor', 'input-to-matrix', 'ducking-keys', 'ring-out-with-osc', 'delay-speaker-alignment']) {
      const { model, s, r } = fresh();
      const ex = EXERCISES.find((e) => e.id === id)!;
      ex.setup?.(s, r, model);
      EX_SOLUTION[id](s, r);
      const res = ex.check(makeCtx(model, s, r));
      expect(res.ok, `${id}: ${res.detail.join(' | ')}`).toBe(true);
    }
  });
});

describe('new-feature scenarios: extra checks', () => {
  const get = (id: string) => SCENARIOS.find((x) => x.id === id)!;

  it('phantom: setup gives a silent condenser at +24 dB', () => {
    const { model, s, r } = fresh();
    get('phantom-off-condenser').setup(s, r, model);
    expect(r.kinds.p1).toBe('condenser');
    expect(s.ports.in1.gain).toBe(24);
    expect(s.ports.in1.phantom).toBe(false);
    const g = buildRoutingGraph(model, s, r);
    expect(gainToDb(pathGain(g, 'dev:p1', 'ch:ch1'))).toBe(NEG_INF);
  });

  it('phantom: live level must have headroom', () => {
    const sc = get('phantom-off-condenser');
    const { model, s, r } = fresh();
    sc.setup(s, r, model);
    s.ports.in1.phantom = true;
    expect(sc.check(makeCtx(model, s, r, { audio: true, peak: () => -1, playing: true })).ok).toBe(false);
    expect(sc.check(makeCtx(model, s, r, { audio: true, peak: () => -14, playing: true })).ok).toBe(true);
  });

  it('mute group: either disengaging or removing the members works', () => {
    const sc = get('mute-group-engaged');
    for (const fix of [
      (s: ConsoleState) => {
        s.muteGroups[0].on = false;
      },
      (s: ConsoleState) => {
        s.channels.ch1.muteGroups = [];
        s.channels.ch6.muteGroups = [];
      },
    ]) {
      const { model, s, r } = fresh();
      sc.setup(s, r, model);
      fix(s);
      expect(sc.check(makeCtx(model, s, r)).ok).toBe(true);
    }
  });

  it('gate: threshold fix and live gate reduction', () => {
    const sc = get('gate-chopping-vocal');
    const { model, s, r } = fresh();
    sc.setup(s, r, model);
    s.channels.ch1.gate.threshold = -40;
    expect(sc.check(makeCtx(model, s, r)).ok).toBe(true);
    expect(sc.check(makeCtx(model, s, r, { ...loud, gr: () => -5 })).ok).toBe(true);
    expect(sc.check(makeCtx(model, s, r, { ...loud, gr: () => -45 })).ok).toBe(false);
    s.channels.ch1.gate.threshold = -35;
    expect(sc.check(makeCtx(model, s, r)).ok).toBe(true);
    s.channels.ch1.gate.threshold = -34;
    expect(sc.check(makeCtx(model, s, r)).ok).toBe(false);
  });

  it('oscillator: unassigning wedges also fixes', () => {
    const sc = get('oscillator-left-on');
    const { model, s, r } = fresh();
    sc.setup(s, r, model);
    s.osc.assign = [];
    expect(sc.check(makeCtx(model, s, r)).ok).toBe(true);
  });

  it('talkback: the engineer mic is channel 8 sent pre-fader to the wedges; any real fix works', () => {
    const sc = get('talkback-channel-left-on');
    {
      const { model, s, r } = fresh();
      sc.setup(s, r, model);
      expect(s.channels.ch8.name).toBe('Mic');
      expect(s.channels.ch8.on).toBe(true);
      for (const b of ['mix1', 'mix2', 'mix3', 'mix4']) expect(s.channels.ch8.sends[b].pre).toBe(true);
      expect(r.plugs.in8?.device).toBe('mic');
      // nothing audible in the PA: the fader is parked
      expect(gainToDb(pathGain(buildRoutingGraph(model, s, r), 'ch:ch8', 'out:omni7'))).toBe(NEG_INF);
    }
    const fixes: Fix[] = [
      (s) => {
        s.channels.ch8.on = false;
      },
      (s) => {
        for (const b of ['mix1', 'mix2', 'mix3', 'mix4']) s.channels.ch8.sends[b].on = false;
      },
      (s) => {
        for (const b of ['mix1', 'mix2', 'mix3', 'mix4']) s.channels.ch8.sends[b].level = NEG_INF;
      },
      (s) => {
        s.channels.ch8.muteGroups = [4];
        s.muteGroups[3].on = true;
      },
    ];
    for (const f of fixes) {
      const { model, s, r } = fresh();
      sc.setup(s, r, model);
      f(s, r);
      const res = sc.check(makeCtx(model, s, r));
      expect(res.ok, res.detail.join(' | ')).toBe(true);
      expect(sc.check(makeCtx(model, s, r, loud)).ok).toBe(true);
    }
  });

  it('mute-group multi-fault: removing ch1 from the group also works', () => {
    const sc = get('multi-mutegroup-and-patch');
    const { model, s, r } = fresh();
    sc.setup(s, r, model);
    s.channels.ch1.muteGroups = [];
    s.outPorts.omni1.source = 'mix1';
    expect(sc.check(makeCtx(model, s, r)).ok).toBe(true);
  });

  it('ducker: switching it off is accepted', () => {
    const sc = get('ducker-wrong-key');
    const { model, s, r } = fresh();
    sc.setup(s, r, model);
    expect(s.channels.ch6.gate.mode).toBe('ducker');
    expect(s.channels.ch6.gate.key).toBe('ch2');
    s.channels.ch6.gate.on = false;
    expect(sc.check(makeCtx(model, s, r)).ok).toBe(true);
  });

  it('delay: matrix feeds OMNI 5 at setup and the alignment window is 10-80 ms', () => {
    const sc = get('delay-misaligned');
    const { model, s, r } = fresh();
    sc.setup(s, r, model);
    expect(s.outPorts.omni5.source).toBe('mtx1');
    for (const [ms, ok] of [[10, true], [80, true], [9, false], [81, false]] as const) {
      s.buses.mtx1.delayMs = ms;
      expect(sc.check(makeCtx(model, s, r)).ok, `${ms} ms`).toBe(ok);
    }
  });
});

describe('DM3 fact-check: content only uses features the DM3 has', () => {
  const all = [
    ...SCENARIOS.map((x) => ({ id: x.id, setup: x.setup })),
    ...EXERCISES.map((x) => ({ id: x.id, setup: x.setup ?? (() => {}) })),
  ];
  const sol = (id: string): Fix | undefined => SCENARIO_FIX[id] ?? EX_SOLUTION[id];

  it.each(all)('$id: no DCAs, no talkback, valid gains, complete comp/gate state, ids exist', ({ id, setup }) => {
    const { model, s, r } = fresh();
    expect(model.dcaCount).toBe(0);
    expect(model.features.talkback).toBe(false);
    setup(s, r, model);
    sol(id)?.(s, r);
    expect(s.dcas).toEqual([]);
    expect(s.talkback.on).toBe(false);
    expect(s.muteGroups.length).toBe(model.muteGroupCount);
    const [lo, hi] = model.digitalGainRange;
    for (const [cid, ch] of Object.entries(s.channels)) {
      expect(ch.dca, `${id} ${cid} dca`).toEqual([]);
      expect(ch.digitalGain).toBeGreaterThanOrEqual(lo);
      expect(ch.digitalGain).toBeLessThanOrEqual(hi);
      expect(['post', 'pre']).toContain(ch.comp.key);
      expect(typeof ch.comp.oneKnob).toBe('boolean');
      expect(ch.comp.amount).toBeGreaterThanOrEqual(0);
      expect(ch.comp.amount).toBeLessThanOrEqual(10);
      expect(ch.gate.key).toMatch(/^(self|self-pre|ch\d+|stin|mix\d)$/);
      // Dynamics 1 only exists on CH 1-16
      if (/^(stin|fxr)/.test(cid)) expect(ch.gate.on, `${id} ${cid} gate`).toBe(false);
    }
    for (const [bid, b] of Object.entries(s.buses)) {
      expect(['post', 'pre']).toContain(b.comp.key);
      expect(['fader', 'eq'], bid).toContain(b.prePoint);
    }
  });
});
