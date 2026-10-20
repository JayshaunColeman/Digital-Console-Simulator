import { lazy, Suspense, useEffect } from 'react';
import { useStore, type Screen } from '../state/store';
import { useRuntime, startAudio } from '../state/engine';
import { StripBank } from './Strips';
import { MasterSection } from './Master';
import { Key, useViewport } from './controls';
import { TOPICS } from './topics';
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

const SCREENS: { id: Screen; label: string }[] = [
  { id: 'overview', label: 'OVERVIEW' },
  { id: 'channel', label: 'SELECTED CH' },
  { id: 'routing', label: 'ROUTING' },
  { id: 'io', label: 'I/O PATCH' },
  { id: 'fx', label: 'FX RACK' },
  { id: 'sources', label: 'SOURCES' },
  { id: 'scenes', label: 'SCENES' },
  { id: 'flow', label: 'SIGNAL FLOW' },
  { id: 'training', label: 'TRAINING' },
  { id: 'academy', label: 'ACADEMY' },
];

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
      <Key small on={learning} onClick={() => setUi((u) => void (u.learning = !learning))} testid="learning">
        LEARNING MODE
      </Key>
    </header>
  );
}

function Coach() {
  const topic = useStore((s) => s.ui.topic);
  const learning = useStore((s) => s.ui.learning);
  const setUi = useStore((s) => s.setUi);
  if (!learning) return null;
  const t = topic ? TOPICS[topic] : null;
  return (
    <div className="coach" data-testid="coach">
      <b>{t ? t.title : 'Learning mode'}</b>
      <p>
        {t
          ? t.text
          : 'Touch any control and an explanation appears here. Start with POWER, then SOURCES → PLAY ALL. Gain-staging tip: every stage has its own meter; follow the signal left to right and find where it stops or overloads.'}
      </p>
      {t ? (
        <button className="linkish" onClick={() => setUi((u) => void (u.topic = null))}>
          dismiss
        </button>
      ) : null}
    </div>
  );
}

export default function App() {
  const screen = useStore((s) => s.ui.screen);
  const setUi = useStore((s) => s.setUi);
  const rt = useRuntime();
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
    case 'training':
      body = <TrainingScreen />;
      break;
    case 'academy':
      body = <AcademyScreen />;
      break;
  }
  const vp = useViewport();
  const pane = useStore((s) => s.ui.pane);
  const show = (p: 'mix' | 'screen' | 'master') => !vp.mobile || pane === p;
  return (
    <div className={`app ${vp.mobile ? 'mobile' : ''}`}>
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
              {SCREENS.map((s) => (
                <button key={s.id} className={`tab ${screen === s.id ? 'active' : ''}`} onClick={() => setUi((u) => void (u.screen = s.id))} data-testid={`tab-${s.id}`}>
                  {s.label}
                </button>
              ))}
            </nav>
            <div className="display">
              <Suspense fallback={<p className="note">Loading…</p>}>{body}</Suspense>
            </div>
            <Coach />
          </div>
        ) : null}
        {show('master') ? <MasterSection /> : null}
        {show('mix') ? <StripBank /> : null}
      </div>
      {vp.mobile ? (
        <nav className="mobile-nav" aria-label="Console sections">
          {(
            [
              ['mix', 'FADERS'],
              ['screen', 'SCREENS'],
              ['master', 'MASTER'],
            ] as const
          ).map(([id, label]) => (
            <button key={id} className={pane === id ? 'active' : ''} data-testid={`pane-${id}`} onClick={() => setUi((u) => void (u.pane = id))}>
              {label}
            </button>
          ))}
        </nav>
      ) : null}
    </div>
  );
}
