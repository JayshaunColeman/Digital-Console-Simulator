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
  'multi-dca-and-patch': (s) => {
    s.dcas[0].on = true;
    s.outPorts.omni1.source = 'mix1';
  },
  'multi-keys-wedge-dead': (s) => {
    s.channels.ch6.sends.mix2.level = -3;
    s.channels.stin.sends.mix2.on = true;
    s.outPorts.omni2.att = 0;
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
  'multi-dca-and-patch': [
    (s) => {
      s.dcas[0].on = true; // patch still wrong
    },
    (s) => {
      s.outPorts.omni1.source = 'mix1'; // DCA still muted
    },
  ],
  'multi-keys-wedge-dead': [
    (s) => {
      s.channels.ch6.sends.mix2.level = -3;
      s.channels.stin.sends.mix2.on = true; // output attenuator still at -inf
    },
  ],
};

describe('scenarios', () => {
  it('has the required ids, unique', () => {
    const ids = SCENARIOS.map((x) => x.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBeGreaterThanOrEqual(13);
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
  'drum-mix-and-dca': (s) => {
    for (const id of ['ch2', 'ch3', 'ch4']) {
      s.channels[id].sends.mix3 = { on: true, level: -3, pre: true, pan: 0 };
      s.channels[id].dca = [1];
    }
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
};

/** Exercises that are pure state/routing: signal only matters while audio runs. */
const HARD = new Set([
  'connect-microphone',
  'confirm-input-signal',
  'adjust-input-gain',
  'trace-input-to-output',
  'clipping-and-gain-staging',
]);
/** Whose initial (post-setup) state already satisfies the check once signal is stubbed in. */
const SIGNAL_ONLY = new Set(['confirm-input-signal', 'adjust-input-gain', 'trace-input-to-output']);
/** No signal items at all. */
const NO_SIGNAL = new Set(['fader-and-mute', 'sends-on-fader', 'patch-bus-to-output', 'compare-main-vs-monitor']);

describe('exercises', () => {
  it('counts and ordering', () => {
    const byLevel = (l: string) => EXERCISES.filter((e) => e.level === l).length;
    expect(byLevel('beginner')).toBe(10);
    expect(byLevel('intermediate')).toBe(6);
    expect(byLevel('advanced')).toBe(5);
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
});
