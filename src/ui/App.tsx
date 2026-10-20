import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { useStore, type Screen, type Learn } from '../state/store';
import { useRuntime, startAudio, getEngine } from '../state/engine';
import { StripBank } from './Strips';
import { MasterSection } from './Master';
import { Key, useViewport } from './controls';
import { TOPICS } from './topics';
import { useProgress } from './progress';
import { OverviewScreen } from './screens/Overview';
import { ChannelScreen } from './screens/ChannelScreen';
import { SourcesScreen } from './screens/Sources';

// less-used screens load on demand to keep the first load small on phones
const RoutingScreen = lazy(() => import('./screens/Routing').then((m) => ({ default: m.RoutingScreen })));
const IOScreen = lazy(() => import('./screens/IO').then((m) => ({ default: m.IOScreen })));
const FxScreen = lazy(() => import('./screens/FxScreen').then((m) => ({ default: m.FxScreen })));
const ScenesScreen = lazy(() => import('./screens/Scenes').then((m) => ({ default: m.ScenesScreen })));
const FlowScreen = lazy(() => import('./screens/Flow').then((m) => ({ default: m.FlowScreen })));
const TrainingScreen = lazy(() => import('./screens/Training').then((m) => ({ default: m.TrainingScreen })));
const AcademyScreen = lazy(() => import('./screens/Training').then((m) => ({ default: m.AcademyScreen })));
import { buildRoutingGraph, findLoops } from '../engine/routing';

/** Display tabs, grouped the way a console operator thinks about them. */
const TAB_GROUPS: { label: string; tabs: { id: Screen; label: string }[] }[] = [
  {
    label: 'MIX',
    tabs: [
      { id: 'overview', label: 'OVERVIEW' },
      { id: 'channel', label: 'SELECTED CH' },
      { id: 'routing', label: 'ROUTING' },
      { id: 'io', label: 'I/O PATCH' },
      { id: 'fx', label: 'FX RACK' },
    ],
  },
  {
    label: 'SETUP',
    tabs: [
      { id: 'sources', label: 'SOURCES' },
      { id: 'scenes', label: 'SCENES' },
      { id: 'flow', label: 'SIGNAL FLOW' },
    ],
  },
];

const INTRO =
  'Touch any control and an explanation pops up over the display. Start with POWER, then SOURCES → PLAY ALL. Gain-staging tip: every stage has its own meter; follow the signal left to right and find where it stops or overloads.';

function TopBar() {
  const rt = useRuntime();
  const model = useStore((s) => s.model);
  const learning = useStore((s) => s.ui.learning);
  const setUi = useStore((s) => s.setUi);
  const status = useStore((s) => s.status);
  const loops = useStore((s) => findLoops(buildRoutingGraph(s.model, s.console, s.rig)).length);
  const flash = useStore((s) => s.flash);
  useEffect(() => {
    if (!status) return;
    const t = setTimeout(() => flash(''), 6000);
    return () => clearTimeout(t);
  }, [status, flash]);
  return (
    <header className="topbar">
      <div className="brand">
        <b>DM3</b> SIM
        <small>{model.name} · training simulator</small>
      </div>
      <Key kind="on" on={rt.running} testid="power" onClick={() => void startAudio()} title="Start the audio engine (browsers require a click)">
        {rt.starting ? 'STARTING…' : rt.running ? '● AUDIO ON' : '⏻ POWER'}
      </Key>
      {rt.running ? <span className="sr">{(rt.sampleRate / 1000).toFixed(1)} kHz</span> : null}
      {loops ? (
        <span className="tag bad blink" data-testid="loop-warning" title="A live feedback loop exists in the routing">
          FEEDBACK LOOP
        </span>
      ) : null}
      <span className="status" data-testid="status" role="status">
        {rt.error || status}
      </span>
      <Key small on={learning} onClick={() => setUi((u) => void (u.learning = !learning))} testid="learning" title="Explain every control as you touch it">
        LEARNING MODE
      </Key>
    </header>
  );
}

/** Learning-mode explanation: a toast over the display, shown only while a topic is set. */
function Coach() {
  const topic = useStore((s) => s.ui.topic);
  const learning = useStore((s) => s.ui.learning);
  const setUi = useStore((s) => s.setUi);
  const t = topic ? TOPICS[topic] : null;
  if (!learning || !t) return null;
  return (
    <aside className="coach" data-testid="coach" role="status" aria-live="polite">
      <div className="coach-head">
        <span className="coach-eyebrow">LEARN</span>
        <b>{t.title}</b>
        <button className="coach-x" aria-label="Dismiss explanation" title="Dismiss" onClick={() => setUi((u) => void (u.topic = null))}>
          ×
        </button>
      </div>
      <p>{t.text}</p>
    </aside>
  );
}

/** Exercise / scenario totals live in the (lazy) training chunk; fetch them after first paint. */
function useTotals() {
  const [tot, setTot] = useState<{ ex: number; sc: number } | null>(null);
  useEffect(() => {
    let alive = true;
    const t = setTimeout(() => {
      void import('./screens/Training').then((m) => alive && setTot({ ex: m.ACADEMY_TOTAL, sc: m.TRAINING_TOTAL }));
    }, 800);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, []);
  return tot;
}

/**
 * LEARN dock: the academy and troubleshooting training live in their own
 * section below the console (a pane of its own on phones). Panels stay mounted
 * once opened so collapsing the dock never loses an exercise in progress.
 */
function LearnDock({ inPane }: { inPane?: boolean }) {
  const learn = useStore((s) => s.ui.learn);
  const learning = useStore((s) => s.ui.learning);
  const setUi = useStore((s) => s.setUi);
  const progress = useProgress();
  const totals = useTotals();
  const [mounted, setMounted] = useState<Partial<Record<'academy' | 'training', boolean>>>({});
  const [tipOpen, setTipOpen] = useState(false);
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    if (learn && !mounted[learn]) setMounted((m) => ({ ...m, [learn]: true }));
  }, [learn, mounted]);
  useEffect(() => {
    if (learn && !inPane) requestAnimationFrame(() => ref.current?.scrollIntoView({ block: 'end', behavior: 'smooth' }));
  }, [learn, inPane]);

  const toggle = (k: Exclude<Learn, null>) => setUi((u) => void (u.learn = u.learn === k ? null : k));
  const exDone = Object.keys(progress.ex).length;
  const scFixed = Object.keys(progress.sc).length;
  const status = `Academy ${exDone}${totals ? `/${totals.ex}` : ''} · Training ${scFixed}${totals ? `/${totals.sc}` : ''} fixed`;

  return (
    <section ref={ref} className={`learn ${learn ? 'open' : ''} ${inPane ? 'in-pane' : ''}`} aria-label="Learning">
      <div className="learn-bar">
        <span className="learn-eyebrow">LEARN</span>
        <div className="learn-keys" role="tablist" aria-label="Learning panels">
          {(
            [
              ['academy', 'ACADEMY', 'Guided exercises, checked live against the console'],
              ['training', 'TRAINING', 'Troubleshooting scenarios with a real fault to find'],
            ] as const
          ).map(([id, label, title]) => (
            <button
              key={id}
              role="tab"
              aria-selected={learn === id}
              className={`learn-key ${learn === id ? 'active' : ''}`}
              data-testid={`tab-${id}`}
              title={title}
              onClick={() => toggle(id)}
            >
              {label}
            </button>
          ))}
        </div>
        <span className="learn-status" data-testid="learn-status">
          {status}
        </span>
        {learning && !learn ? (
          <button className={`learn-tip ${tipOpen ? 'open' : ''}`} onClick={() => setTipOpen(!tipOpen)} title={tipOpen ? 'Show less' : INTRO}>
            <b>Tip</b> {INTRO}
          </button>
        ) : (
          <span className="learn-spacer" />
        )}
        {learn ? (
          <button className="learn-close" aria-label="Collapse the learning panel" title="Collapse" onClick={() => setUi((u) => void (u.learn = null))}>
            ×
          </button>
        ) : (
          <span className="learn-chev" aria-hidden>
            ▴
          </span>
        )}
      </div>
      <div className="learn-body" hidden={!learn}>
        <Suspense fallback={<p className="note">Loading…</p>}>
          {mounted.academy ? (
            <div hidden={learn !== 'academy'}>
              <AcademyScreen />
            </div>
          ) : null}
          {mounted.training ? (
            <div hidden={learn !== 'training'}>
              <TrainingScreen />
            </div>
          ) : null}
        </Suspense>
      </div>
      {inPane && !learn ? <p className="note learn-empty">Choose ACADEMY for guided exercises or TRAINING for fault-finding scenarios.</p> : null}
    </section>
  );
}

export default function App() {
  const screen = useStore((s) => s.ui.screen);
  const setUi = useStore((s) => s.setUi);
  const peakHold = useStore((s) => s.ui.peakHold);
  const learn = useStore((s) => s.ui.learn);
  const rt = useRuntime();
  // meter peak-hold lives in the engine; keep it in sync whatever is on screen
  useEffect(() => {
    const e = getEngine();
    if (e) e.meters.holdEnabled = peakHold;
  }, [peakHold, rt.running]);
  let body;
  switch (screen) {
    case 'overview':
      body = <OverviewScreen />;
      break;
    case 'channel':
      body = <ChannelScreen />;
      break;
    case 'routing':
      body = <RoutingScreen />;
      break;
    case 'io':
      body = <IOScreen />;
      break;
    case 'fx':
      body = <FxScreen />;
      break;
    case 'sources':
      body = <SourcesScreen />;
      break;
    case 'scenes':
      body = <ScenesScreen />;
      break;
    case 'flow':
      body = <FlowScreen />;
      break;
  }
  const vp = useViewport();
  const pane = useStore((s) => s.ui.pane);
  const show = (p: 'mix' | 'screen' | 'master') => !vp.mobile || pane === p;
  return (
    <div className={`app ${vp.mobile ? 'mobile' : ''} ${learn ? 'learn-open' : ''}`}>
      <div className="surface">
        <TopBar />
        {!rt.running && !rt.starting ? (
          <div className="power-banner">
            Audio engine is off. Browsers only start audio after a tap: press <b>POWER</b>, then open <b>SOURCES</b> and press <b>PLAY ALL</b>.
          </div>
        ) : null}
        <div className={`workspace ${vp.mobile ? `mobile pane-${pane}` : ''}`}>
          {show('screen') ? (
            <div className="center">
              <nav className="tabs" aria-label="Screens">
                {TAB_GROUPS.map((g) => (
                  <div className="tab-group" role="group" aria-label={g.label} key={g.label}>
                    <span className="tab-eyebrow">{g.label}</span>
                    {g.tabs.map((s) => (
                      <button
                        key={s.id}
                        className={`tab ${screen === s.id ? 'active' : ''}`}
                        aria-current={screen === s.id ? 'page' : undefined}
                        onClick={() => setUi((u) => void (u.screen = s.id))}
                        data-testid={`tab-${s.id}`}
                      >
                        {s.label}
                      </button>
                    ))}
                  </div>
                ))}
              </nav>
              <div className="display-wrap">
                <div className="display">
                  <Suspense fallback={<p className="note">Loading…</p>}>{body}</Suspense>
                </div>
                <Coach />
              </div>
            </div>
          ) : null}
          {show('master') ? <MasterSection /> : null}
          {show('mix') ? <StripBank /> : null}
          {vp.mobile ? (
            <div className="learn-pane" hidden={pane !== 'learn'}>
              <LearnDock inPane />
            </div>
          ) : null}
        </div>
      </div>
      {vp.mobile ? null : <LearnDock />}
      {vp.mobile ? (
        <nav className="mobile-nav" aria-label="Console sections">
          {(
            [
              ['mix', 'FADERS'],
              ['screen', 'SCREENS'],
              ['master', 'MASTER'],
              ['learn', 'LEARN'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              className={pane === id ? 'active' : ''}
              data-testid={`pane-${id}`}
              onClick={() =>
                setUi((u) => {
                  u.pane = id;
                  if (id === 'learn' && !u.learn) u.learn = 'academy';
                })
              }
            >
              {label}
            </button>
          ))}
        </nav>
      ) : null}
    </div>
  );
}
