import { useEffect, useRef, useCallback, useState, type ReactNode } from 'react';
import { FADER_MARKS, clamp, faderDbToPos, faderPosToDb, fmtDb } from '../lib/db';
import { NEG_INF } from '../model/types';
import { getEngine, useRuntime } from '../state/engine';
import { useStore } from '../state/store';

export function useTopic() {
  const setUi = useStore((s) => s.setUi);
  return useCallback((t: string | undefined) => {
    if (t) setUi((u) => void (u.topic = t));
  }, [setUi]);
}

// ---------------------------------------------------------------- fader ----

interface FaderProps {
  value: number;
  onChange: (db: number) => void;
  color?: string;
  topic?: string;
  testid?: string;
  label?: string;
  height?: number;
  accent?: string; // cap color (e.g. sends-on-fader mode)
  reset?: number;
}

export function Fader({ value, onChange, color, topic, testid, label, height = 220, accent, reset = 0 }: FaderProps) {
  const track = useRef<HTMLDivElement>(null);
  const drag = useRef<{ y: number; pos: number } | null>(null);
  const setTopic = useTopic();
  const pos = faderDbToPos(value);

  const onDown = (e: React.PointerEvent) => {
    setTopic(topic);
    const el = track.current!;
    el.setPointerCapture(e.pointerId);
    const r = el.getBoundingClientRect();
    const capY = r.top + (1 - pos) * r.height;
    if (Math.abs(e.clientY - capY) > 18) {
      // click on track jumps the cap there
      const p = clamp(1 - (e.clientY - r.top) / r.height, 0, 1);
      onChange(round(faderPosToDb(p)));
      drag.current = { y: e.clientY, pos: p };
    } else drag.current = { y: e.clientY, pos };
  };
  const onMove = (e: React.PointerEvent) => {
    if (!drag.current) return;
    const r = track.current!.getBoundingClientRect();
    const scale = e.shiftKey ? 0.2 : 1;
    const p = clamp(drag.current.pos - ((e.clientY - drag.current.y) / r.height) * scale, 0, 1);
    drag.current = { y: e.clientY, pos: p };
    onChange(round(faderPosToDb(p)));
  };
  const onUp = () => (drag.current = null);
  const onKey = (e: React.KeyboardEvent) => {
    const step = e.shiftKey ? 0.1 : 1;
    if (e.key === 'ArrowUp' || e.key === 'ArrowRight') onChange(nudge(value, step));
    else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') onChange(nudge(value, -step));
    else if (e.key === 'Home') onChange(reset);
    else if (e.key === 'End') onChange(NEG_INF);
    else return;
    e.preventDefault();
  };
  const onWheel = (e: React.WheelEvent) => {
    onChange(nudge(value, (e.deltaY < 0 ? 1 : -1) * (e.shiftKey ? 0.1 : 0.5)));
  };

  return (
    <div className="fader" style={{ height }}>
      <div className="fader-scale">
        {FADER_MARKS.map((m) => (
          <span key={m} style={{ top: `${(1 - faderDbToPos(m)) * 100}%` }}>
            {m > 0 ? `+${m}` : m}
          </span>
        ))}
        <span style={{ top: '100%' }}>∞</span>
      </div>
      <div
        ref={track}
        className="fader-track"
        role="slider"
        tabIndex={0}
        aria-label={label ?? 'fader'}
        aria-valuemin={-140}
        aria-valuemax={10}
        aria-valuenow={Math.round(value * 10) / 10}
        aria-valuetext={`${fmtDb(value)} dB`}
        data-testid={testid}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onDoubleClick={() => onChange(reset)}
        onKeyDown={onKey}
        onWheel={onWheel}
        onFocus={() => setTopic(topic)}
        title="Drag (Shift = fine). Double-click = reset. Arrow keys / wheel to nudge."
      >
        <div className="fader-slot" />
        <div className="fader-cap" style={{ top: `${(1 - pos) * 100}%`, background: accent, borderColor: color }} />
      </div>
    </div>
  );
}

const round = (db: number) => (db <= NEG_INF ? NEG_INF : Math.round(db * 10) / 10);
function nudge(db: number, step: number) {
  if (db <= NEG_INF) return step > 0 ? -60 : NEG_INF;
  const n = db + step;
  if (n < -60) return NEG_INF;
  return Math.min(10, Math.round(n * 10) / 10);
}

// ----------------------------------------------------------------- knob ----

interface KnobProps {
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
  label: string;
  fmt?: (v: number) => string;
  log?: boolean;
  step?: number;
  reset?: number;
  topic?: string;
  testid?: string;
  size?: number;
  disabled?: boolean;
}

export function Knob({ value, min, max, onChange, label, fmt, log, step, reset, topic, testid, size = 40, disabled }: KnobProps) {
  const drag = useRef<{ y: number; n: number } | null>(null);
  const setTopic = useTopic();
  const toN = (v: number) => (log ? Math.log(v / min) / Math.log(max / min) : (v - min) / (max - min));
  const fromN = (n: number) => {
    n = clamp(n, 0, 1);
    let v = log ? min * Math.pow(max / min, n) : min + n * (max - min);
    if (step) v = Math.round(v / step) * step;
    return clamp(v, min, max);
  };
  const n = clamp(toN(value), 0, 1);
  const ang = -135 + n * 270;
  const commit = (v: number) => {
    if (!disabled) onChange(Number(v.toFixed(4)));
  };
  return (
    <div className={`knob ${disabled ? 'disabled' : ''}`} style={{ width: size + 16 }}>
      <div
        className="knob-dial"
        role="slider"
        tabIndex={0}
        aria-label={label}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        data-testid={testid}
        style={{ width: size, height: size }}
        onPointerDown={(e) => {
          setTopic(topic);
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
          drag.current = { y: e.clientY, n };
        }}
        onPointerMove={(e) => {
          if (!drag.current) return;
          const nn = drag.current.n - ((e.clientY - drag.current.y) / 160) * (e.shiftKey ? 0.2 : 1);
          drag.current = { y: e.clientY, n: clamp(nn, 0, 1) };
          commit(fromN(nn));
        }}
        onPointerUp={() => (drag.current = null)}
        onDoubleClick={() => reset !== undefined && commit(reset)}
        onWheel={(e) => commit(fromN(n + (e.deltaY < 0 ? 1 : -1) * 0.02))}
        onKeyDown={(e) => {
          if (e.key === 'ArrowUp' || e.key === 'ArrowRight') commit(fromN(n + 0.01));
          else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') commit(fromN(n - 0.01));
          else return;
          e.preventDefault();
        }}
        onFocus={() => setTopic(topic)}
        title="Drag up/down (Shift = fine). Double-click = reset."
      >
        <div className="knob-arc" style={{ ['--n' as string]: n }} />
        <div className="knob-pointer" style={{ transform: `rotate(${ang}deg)` }} />
      </div>
      <div className="knob-label">{label}</div>
      <div className="knob-value">{fmt ? fmt(value) : value.toFixed(1)}</div>
    </div>
  );
}

// --------------------------------------------------------------- button ----

export function Key({
  on,
  onClick,
  children,
  kind = 'default',
  topic,
  testid,
  title,
  disabled,
  small,
}: {
  on?: boolean;
  onClick: () => void;
  children: ReactNode;
  kind?: 'default' | 'on' | 'cue' | 'sel' | 'warn' | 'accent';
  topic?: string;
  testid?: string;
  title?: string;
  disabled?: boolean;
  small?: boolean;
}) {
  const setTopic = useTopic();
  return (
    <button
      className={`key key-${kind} ${on ? 'lit' : ''} ${small ? 'small' : ''}`}
      aria-pressed={on}
      data-testid={testid}
      title={title}
      disabled={disabled}
      onClick={() => {
        setTopic(topic);
        onClick();
      }}
    >
      {children}
    </button>
  );
}

// ---------------------------------------------------------------- meter ----

const dbToFrac = (db: number) => clamp((db + 60) / 60, 0, 1);

/** Vertical peak meter bound to a live audio tap. */
export function Meter({ tap, height = 160, width, label, testid }: { tap: string; height?: number; width?: number; label?: string; testid?: string }) {
  const running = useRuntime((r) => r.running);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const eng = getEngine();
    if (!eng || !running) return;
    const el = root.current!;
    const bars = el.querySelectorAll<HTMLDivElement>('.mbar-fill');
    const holds = el.querySelectorAll<HTMLDivElement>('.mbar-hold');
    const clips = el.querySelectorAll<HTMLDivElement>('.mbar-clip');
    const horiz = el.classList.contains('h');
    return eng.meters.subscribe(tap, (r) => {
      r.peak.forEach((p, i) => {
        if (!bars[i]) return;
        bars[i].style.transform = horiz ? `scaleX(${dbToFrac(p)})` : `scaleY(${dbToFrac(p)})`;
        holds[i].style[horiz ? 'left' : 'bottom'] = `${dbToFrac(r.hold[i]) * 100}%`;
        holds[i].style.opacity = r.hold[i] > -60 ? '1' : '0';
        clips[i].classList.toggle('lit', r.clip[i]);
      });
      el.dataset.peak = Math.max(...r.raw).toFixed(1);
    });
  }, [tap, running]);
  const n = getEngine()?.meters.reading(tap)?.peak.length ?? (/^(bus\.st|listen|mon|fx\.|ch\.(stin|fxr))/.test(tap) ? 2 : 1);
  return (
    <div className={`meter ${width && width > height ? 'h' : ''}`} ref={root} style={{ height, width }} data-testid={testid} data-tap={tap} title={label ?? tap}>
      {Array.from({ length: n }, (_, i) => (
        <div className="mbar" key={i}>
          <div className="mbar-clip" />
          <div className="mbar-track">
            <div className="mbar-fill" />
            <div className="mbar-hold" />
          </div>
        </div>
      ))}
    </div>
  );
}

export const METER_MARKS = [0, -6, -12, -18, -30, -40, -50, -60];
export function MeterScale({ height = 160 }: { height?: number }) {
  return (
    <div className="meter-scale" style={{ height }}>
      {METER_MARKS.map((m) => (
        <span key={m} style={{ bottom: `${dbToFrac(m) * 100}%` }}>
          {m}
        </span>
      ))}
    </div>
  );
}

/** Small LED that lights when a tap carries signal above -60 dBFS. */
export function SignalLed({ tap, thresh = -60, title }: { tap: string; thresh?: number; title?: string }) {
  const running = useRuntime((r) => r.running);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const eng = getEngine();
    if (!eng || !running) return;
    return eng.meters.subscribe(tap, (r) => {
      const p = Math.max(...r.raw);
      const el = ref.current;
      if (!el) return;
      el.classList.toggle('sig', p > thresh);
      el.classList.toggle('hot', p > -6);
      el.classList.toggle('clip', r.clip.some(Boolean));
    });
  }, [tap, running, thresh]);
  return <span ref={ref} className="led" data-tap={tap} title={title ?? `Signal at ${tap}`} />;
}

/** Live numeric readout of a tap's peak. */
export function PeakText({ tap }: { tap: string }) {
  const running = useRuntime((r) => r.running);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const eng = getEngine();
    if (!eng || !running) return;
    return eng.meters.subscribe(tap, (r) => {
      const p = Math.max(...r.peak);
      if (ref.current) ref.current.textContent = p <= -99 ? '—' : `${p.toFixed(1)}`;
    });
  }, [tap, running]);
  return (
    <span ref={ref} className="peak-text">
      —
    </span>
  );
}

/** Compressor / limiter gain reduction meter (0 to -24 dB, grows downward). */
export function GrMeter({ id, height = 120, horizontal }: { id: string; height?: number; horizontal?: boolean }) {
  const running = useRuntime((r) => r.running);
  const ref = useRef<HTMLDivElement>(null);
  const txt = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const eng = getEngine();
    if (!eng || !running) return;
    return eng.meters.subscribeGr(id, (db) => {
      const f = clamp(-db / 24, 0, 1);
      if (ref.current) ref.current.style.transform = horizontal ? `scaleX(${f})` : `scaleY(${f})`;
      if (txt.current) txt.current.textContent = db < -0.1 ? db.toFixed(1) : '0.0';
    });
  }, [id, running, horizontal]);
  return (
    <div className={`gr ${horizontal ? 'h' : ''}`} style={horizontal ? undefined : { height }} data-gr={id}>
      <div className="gr-track">
        <div className="gr-fill" ref={ref} />
      </div>
      <span className="gr-text" ref={txt}>
        0.0
      </span>
    </div>
  );
}

export function Section({ title, children, right, id }: { title: string; children: ReactNode; right?: ReactNode; id?: string }) {
  return (
    <section className="panel" id={id}>
      <header className="panel-head">
        <h3>{title}</h3>
        {right}
      </header>
      <div className="panel-body">{children}</div>
    </section>
  );
}

export function Select({
  value,
  onChange,
  options,
  testid,
  topic,
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string; disabled?: boolean; title?: string }[];
  testid?: string;
  topic?: string;
  label?: string;
}) {
  const setTopic = useTopic();
  return (
    <select
      className="sel"
      value={value}
      aria-label={label}
      data-testid={testid}
      onFocus={() => setTopic(topic)}
      onChange={(e) => {
        setTopic(topic);
        onChange(e.target.value);
      }}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value} disabled={o.disabled} title={o.title}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

// ------------------------------------------------------------- viewport ----

function measure() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  // phones (portrait) and phones in landscape get the single-pane mobile layout
  return { w, h, mobile: w < 760 || (h < 500 && w < 1000) };
}

export function useViewport() {
  const [vp, setVp] = useState(measure);
  useEffect(() => {
    const on = () => setVp(measure());
    window.addEventListener('resize', on);
    window.addEventListener('orientationchange', on);
    return () => {
      window.removeEventListener('resize', on);
      window.removeEventListener('orientationchange', on);
    };
  }, []);
  return vp;
}

/** Fader / meter heights for the channel strips (taller on phones to use the screen). */
export function useStripSize(): { fader: number; meter: number; compact: boolean; sel: boolean } {
  const vp = useViewport();
  if (!vp.mobile) {
    // Desktop: size the bank so the touchscreen display keeps ~45 % of the height
    // (and never less than 320 px). Short laptop screens drop the PAN row.
    const compact = vp.h < 860;
    const display = Math.max(320, Math.round(vp.h * 0.45));
    const fader = Math.round(clamp(vp.h - display - (compact ? 296 : 366), 88, 170));
    return { fader, meter: fader - 20, compact, sel: true };
  }
  // phone in landscape: drop pan / patch / SEL rows so the fader still has travel
  if (vp.h < 520) {
    const fader = Math.max(80, Math.min(260, vp.h - 250));
    return { fader, meter: fader - 20, compact: true, sel: false };
  }
  // portrait phone: the strip has three rows fewer than it used to, so the fader gets that height back
  const fader = Math.max(130, Math.min(400, vp.h - 330));
  return { fader, meter: fader - 20, compact: false, sel: true };
}
