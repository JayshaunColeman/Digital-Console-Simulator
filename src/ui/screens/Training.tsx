import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../../state/store';
import { startAudio, playAll, useRuntime } from '../../state/engine';
import { Key, Section } from '../controls';
import { makeCheckCtx } from '../../training/context';
import type { CheckCtx, CheckResult, Exercise, Scenario } from '../../training/types';
import { SCENARIOS } from '../../training/scenarios';
import { EXERCISES } from '../../training/exercises';
import { defaultConsoleState, defaultRig } from '../../model/defaults';
import { buildRoutingGraph, findBreaks, gainToDb, pathGain } from '../../engine/routing';
import { fmtDb } from '../../lib/db';
import { loadProgress, saveProgress } from '../progress';

function useLiveCheck(check: ((ctx: CheckCtx) => CheckResult) | null): CheckResult | null {
  const [res, setRes] = useState<CheckResult | null>(null);
  useEffect(() => {
    if (!check) {
      setRes(null);
      return;
    }
    const run = () => {
      try {
        setRes(check(makeCheckCtx()));
      } catch (e) {
        setRes({ ok: false, detail: [`Check error: ${(e as Error).message}`] });
      }
    };
    run();
    const t = setInterval(run, 500);
    return () => clearInterval(t);
  }, [check]);
  return res;
}

/** Load a fresh default console + rig, apply a setup, start audio + demo band. */
async function loadSetup(setup?: Exercise['setup']) {
  const st = useStore.getState();
  const cs = defaultConsoleState(st.model);
  const rig = defaultRig();
  if (setup) setup(cs, rig, st.model);
  st.replaceConsole(cs);
  st.setRig((r) => void Object.assign(r, rig));
  st.setUi((u) => void (u.sof = null));
  await startAudio();
  const wait = async () => {
    for (let i = 0; i < 40 && !useRuntime.getState().stemsReady; i++) await new Promise((r) => setTimeout(r, 100));
  };
  await wait();
  playAll();
}

// ------------------------------------------------------------- training ----

export function TrainingScreen() {
  const [active, setActive] = useState<Scenario | null>(null);
  const [hints, setHints] = useState(0);
  const [showPath, setShowPath] = useState(false);
  const [showSolution, setShowSolution] = useState(false);
  const [progress, setProgress] = useState(loadProgress);
  const [solvedAt, setSolvedAt] = useState<number | null>(null);
  const [startedAt, setStartedAt] = useState(0);
  const res = useLiveCheck(active ? active.check : null);
  const c = useStore((s) => s.console);
  const rig = useStore((s) => s.rig);
  const model = useStore((s) => s.model);

  useEffect(() => {
    if (!active || !res?.ok || solvedAt) return;
    const t = Date.now();
    setSolvedAt(t);
    const p = loadProgress();
    const prev = p.sc[active.id];
    p.sc[active.id] = { fixed: (prev?.fixed ?? 0) + 1, hints, revealed: showSolution, at: t };
    saveProgress(p);
    setProgress(p);
  }, [res, active, solvedAt, hints, showSolution]);

  const start = async (s: Scenario) => {
    setActive(s);
    setHints(0);
    setShowPath(false);
    setShowSolution(false);
    setSolvedAt(null);
    setStartedAt(Date.now());
    await loadSetup(s.setup);
  };

  const pathInfo = useMemo(() => {
    if (!active || !showPath) return null;
    const g = buildRoutingGraph(model, c, rig);
    const db = gainToDb(pathGain(g, active.trace.from, active.trace.to));
    const breaks = findBreaks(g, active.trace.from, active.trace.to);
    return { g, db, breaks };
  }, [active, showPath, c, rig, model]);

  return (
    <div className="screen" data-testid="training-screen">
      {!active ? (
        <Section title="TROUBLESHOOTING TRAINING">
          <p className="note">
            Each scenario loads a show with a real fault injected into the console or stage wiring. You get the symptom only. Inspect meters,
            routing, patching and the SIGNAL FLOW view, change settings, and the simulator tells you when the symptom is genuinely fixed (judged
            from the routing graph and, while audio runs, from the live meters). Starting a scenario replaces the current console settings — store
            a scene first if you want to keep them.
          </p>
          <div className="row">
            <Key kind="accent" testid="random-fault" onClick={() => void start(SCENARIOS[Math.floor(Math.random() * SCENARIOS.length)])}>
              RANDOM FAULT
            </Key>
          </div>
          <div className="card-list">
            {SCENARIOS.map((s) => {
              const p = progress.sc[s.id];
              return (
                <div key={s.id} className="card" data-testid={`scenario-${s.id}`}>
                  <div className="card-head">
                    <b>{s.title}</b>
                    <span className="tag">{'★'.repeat(s.difficulty)}</span>
                    {p ? <span className="tag good">fixed ×{p.fixed}</span> : null}
                  </div>
                  <p>{s.brief}</p>
                  <Key small kind="on" onClick={() => void start(s)} testid={`start-${s.id}`}>
                    START
                  </Key>
                </div>
              );
            })}
          </div>
        </Section>
      ) : (
        <Section
          title={`FAULT: ${active.title}`}
          right={
            <Key small onClick={() => setActive(null)} testid="scenario-exit">
              ← ALL SCENARIOS
            </Key>
          }
        >
          <div className="brief">“{active.brief}”</div>
          <div className={`alert ${res?.ok ? 'good' : 'bad'}`} data-testid="scenario-status">
            {res?.ok ? (
              <b>
                FIXED ✓ {solvedAt ? `in ${Math.round((solvedAt - startedAt) / 1000)} s` : ''} {hints ? `· ${hints} hint(s)` : '· no hints'}
              </b>
            ) : (
              <b>Not fixed yet.</b>
            )}
            <ul>
              {res?.detail.map((d, i) => (
                <li key={i}>{d}</li>
              ))}
            </ul>
          </div>
          <div className="row">
            <Key small disabled={hints >= active.hints.length} onClick={() => setHints(hints + 1)} testid="hint">
              HINT ({hints}/{active.hints.length})
            </Key>
            <Key small on={showPath} onClick={() => setShowPath(!showPath)} testid="reveal-path">
              REVEAL SIGNAL PATH
            </Key>
            <Key small kind="warn" on={showSolution} onClick={() => setShowSolution(!showSolution)} testid="reveal-solution">
              REVEAL SOLUTION
            </Key>
            <Key small onClick={() => void start(active)}>
              RESTART SCENARIO
            </Key>
          </div>
          {active.hints.slice(0, hints).map((h, i) => (
            <div key={i} className="hint-box">
              Hint {i + 1}: {h}
            </div>
          ))}
          {pathInfo ? (
            <div className="hint-box" data-testid="path-box">
              <b>
                Path {pathInfo.g.labels.get(active.trace.from) ?? active.trace.from} → {pathInfo.g.labels.get(active.trace.to) ?? active.trace.to}:
              </b>{' '}
              {pathInfo.db > -140 ? `connected (nominal ${fmtDb(pathInfo.db)} dB)` : 'BROKEN'}
              {pathInfo.breaks.length ? (
                <ul>
                  {pathInfo.breaks.map((b, i) => (
                    <li key={i}>
                      {pathInfo.g.labels.get(b.from) ?? b.from} → {pathInfo.g.labels.get(b.to) ?? b.to}: <b>{b.label}</b> {b.why ? `— ${b.why}` : 'is off'}
                    </li>
                  ))}
                </ul>
              ) : pathInfo.db <= -140 ? (
                <p>No connection exists along this path at all — something is unpatched or plugged into the wrong place.</p>
              ) : null}
              <p className="note">Open SIGNAL FLOW with the channel selected for the full visual trace.</p>
            </div>
          ) : null}
          {showSolution ? <div className="hint-box solution">{active.solution}</div> : null}
        </Section>
      )}
    </div>
  );
}

// -------------------------------------------------------------- academy ----

const LEVELS: Exercise['level'][] = ['beginner', 'intermediate', 'advanced'];

export function AcademyScreen() {
  const [active, setActive] = useState<Exercise | null>(null);
  const [hints, setHints] = useState(0);
  const [progress, setProgress] = useState(loadProgress);
  const res = useLiveCheck(active ? active.check : null);

  useEffect(() => {
    if (!active || !res?.ok) return;
    const p = loadProgress();
    const cur = p.ex[active.id];
    if (cur && Date.now() - cur.at < 5000) return;
    p.ex[active.id] = { done: (cur?.done ?? 0) + 1, at: Date.now() };
    saveProgress(p);
    setProgress(p);
  }, [res?.ok, active]);

  const done = Object.keys(progress.ex).length;

  return (
    <div className="screen" data-testid="academy-screen">
      {!active ? (
        <Section title={`LEARNING ACADEMY · ${done}/${EXERCISES.length} completed`}>
          <p className="note">
            Practical exercises verified live against the console. Exercises without a setup continue from the current console state; exercises
            with a setup load a prepared console. Repeat any exercise at any time.
          </p>
          {LEVELS.map((lv) => (
            <div key={lv}>
              <h4 className="level-title">{lv.toUpperCase()}</h4>
              <div className="card-list">
                {EXERCISES.filter((e) => e.level === lv).map((e, i) => (
                  <div key={e.id} className="card" data-testid={`exercise-${e.id}`}>
                    <div className="card-head">
                      <b>
                        {i + 1}. {e.title}
                      </b>
                      {progress.ex[e.id] ? <span className="tag good">✓ ×{progress.ex[e.id].done}</span> : null}
                      {e.setup ? <span className="tag">setup</span> : null}
                    </div>
                    <p>{e.goal}</p>
                    <Key
                      small
                      kind="on"
                      testid={`open-${e.id}`}
                      onClick={() => {
                        setActive(e);
                        setHints(0);
                        if (e.setup) void loadSetup(e.setup);
                      }}
                    >
                      {progress.ex[e.id] ? 'REPEAT' : 'START'}
                    </Key>
                  </div>
                ))}
              </div>
            </div>
          ))}
          <Key
            small
            kind="warn"
            onClick={() => {
              if (confirm('Clear all academy and training progress?')) {
                saveProgress({ ex: {}, sc: {} });
                setProgress(loadProgress());
              }
            }}
          >
            RESET PROGRESS
          </Key>
        </Section>
      ) : (
        <Section
          title={`${active.level.toUpperCase()}: ${active.title}`}
          right={
            <Key small onClick={() => setActive(null)} testid="exercise-exit">
              ← ALL EXERCISES
            </Key>
          }
        >
          <p className="brief">{active.goal}</p>
          <ol className="steps">
            {active.steps.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ol>
          <div className={`alert ${res?.ok ? 'good' : ''}`} data-testid="exercise-status">
            {res?.ok ? <b>COMPLETE ✓</b> : <b>In progress…</b>}
            <ul>
              {res?.detail.map((d, i) => (
                <li key={i}>{d}</li>
              ))}
            </ul>
          </div>
          <div className="row">
            <Key small disabled={hints >= active.hints.length} onClick={() => setHints(hints + 1)}>
              HINT ({hints}/{active.hints.length})
            </Key>
            {active.setup ? (
              <Key small onClick={() => void loadSetup(active.setup)}>
                RELOAD SETUP
              </Key>
            ) : null}
            {!useRuntime.getState().running ? (
              <Key small kind="on" onClick={() => void startAudio()}>
                POWER ON AUDIO
              </Key>
            ) : null}
          </div>
          {active.hints.slice(0, hints).map((h, i) => (
            <div key={i} className="hint-box">
              Hint {i + 1}: {h}
            </div>
          ))}
        </Section>
      )}
    </div>
  );
}

export const ACADEMY_TOTAL = EXERCISES.length;
export const TRAINING_TOTAL = SCENARIOS.length;
