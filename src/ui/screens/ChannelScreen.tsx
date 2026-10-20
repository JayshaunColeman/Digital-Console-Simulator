import { useEffect } from 'react';
import { useStore } from '../../state/store';
import { Key, Knob, Meter, MeterScale, GrMeter, Section, Select, SignalLed, PeakText } from '../controls';
import { EqCurve, CompCurve } from '../curves';
import { fmtDb, fmtHz, fmtPan } from '../../lib/db';
import { NEG_INF, type CompState, type EqBand, type GateState } from '../../model/types';
import { deviceKind, deviceLabel, governingBusId, isLinked, plugProblem } from '../../engine/routing';
import { GEQ_FREQS } from '../../model/defaults';
import { effectiveComp } from '../../engine/compParams';
import { pairKeyOf, pairPartner } from '../../model/dm3';
import { defaultEq, defaultComp } from '../../model/defaults';

const BAND_NAMES = ['LOW', 'LO-MID', 'HI-MID', 'HIGH'];

export function EqSection({ bands, eqOn, onToggle, onBand, onReset, hpf }: {
  bands: EqBand[];
  eqOn: boolean;
  onToggle: () => void;
  onBand: (i: number, b: Partial<EqBand>) => void;
  onReset: () => void;
  hpf?: { on: boolean; freq: number };
}) {
  return (
    <Section
      title="EQ"
      id="sec-eq"
      right={
        <div className="row">
          <Key small on={eqOn} kind="on" onClick={onToggle} topic="eq" testid="eq-on">
            EQ {eqOn ? 'ON' : 'OFF'}
          </Key>
          <Key small onClick={onReset} topic="eq">
            FLAT
          </Key>
        </div>
      }
    >
      <EqCurve bands={bands} eqOn={eqOn} hpf={hpf} />
      <div className="eq-bands">
        {bands.map((b, i) => (
          <div className="eq-band" key={i}>
            <div className={`band-name b${i}`}>{BAND_NAMES[i]}</div>
            {i === 0 || i === 3 ? (
              <Key
                small
                on={b.type !== 'peak'}
                topic="eq"
                testid={`eq-type-${i}`}
                onClick={() =>
                  onBand(i, {
                    type: i === 0 ? (b.type === 'peak' ? 'lowshelf' : 'peak') : b.type === 'peak' ? 'highshelf' : b.type === 'highshelf' ? 'lowpass' : 'peak',
                  })
                }
              >
                {b.type === 'peak' ? 'BELL' : b.type === 'lowpass' ? 'LPF' : 'SHELF'}
              </Key>
            ) : (
              <span className="spacer-key">PEAK</span>
            )}
            <Knob label="GAIN" value={b.gain} min={-18} max={18} step={0.5} reset={0} fmt={(v) => fmtDb(v)} topic="eq" testid={`eq-gain-${i}`} disabled={b.type === 'lowpass'} onChange={(v) => onBand(i, { gain: v })} />
            <Knob label="FREQ" value={b.freq} min={20} max={20000} log reset={[100, 400, 2500, 8000][i]} fmt={fmtHz} topic="eq" testid={`eq-freq-${i}`} onChange={(v) => onBand(i, { freq: Math.round(v) })} />
            <Knob label="Q" value={b.q} min={0.1} max={16} log reset={i === 0 || i === 3 ? 0.7 : 2} fmt={(v) => v.toFixed(2)} topic="eq" disabled={b.type !== 'peak' && b.type !== 'lowpass'} onChange={(v) => onBand(i, { q: v })} />
          </div>
        ))}
      </div>
    </Section>
  );
}

export function CompSection({ c, onChange, grId, meterTap }: { c: CompState; onChange: (p: Partial<CompState>) => void; grId: string; meterTap: string }) {
  const e = effectiveComp(c);
  const k = c.oneKnob; // in 1-knob mode the individual controls are driven by AMOUNT
  return (
    <Section
      title="DYNAMICS 2 · COMP"
      id="sec-dyn"
      right={
        <div className="row">
          <Key small on={c.oneKnob} kind="accent" onClick={() => onChange({ oneKnob: !c.oneKnob })} topic="comp" testid="comp-1knob">
            1-KNOB
          </Key>
          <Key small on={c.key === 'pre'} onClick={() => onChange({ key: c.key === 'pre' ? 'post' : 'pre' })} topic="comp" testid="comp-key" title="Key in: self post-EQ (normal) or self pre-EQ">
            KEY {c.key === 'pre' ? 'PRE EQ' : 'POST EQ'}
          </Key>
          <Key small on={c.on} kind="on" onClick={() => onChange({ on: !c.on })} topic="comp" testid="comp-on">
            COMP {c.on ? 'ON' : 'OFF'}
          </Key>
        </div>
      }
    >
      <div className="comp-wrap">
        <CompCurve c={{ ...c, ...e }} />
        <div className="comp-meters">
          <Meter tap={meterTap} height={120} label="Signal after dynamics (PRE-fader)" />
          <div>
            <GrMeter id={grId} height={120} />
            <small>GR</small>
          </div>
        </div>
        {k ? (
          <div className="knob-grid">
            <Knob label="AMOUNT" size={56} value={c.amount} min={0} max={10} step={0.1} reset={3} fmt={(v) => v.toFixed(1)} topic="comp" testid="comp-amount" onChange={(v) => onChange({ amount: v })} />
            <div className="note mono">
              THR {e.threshold.toFixed(1)} dB
              <br />
              RATIO {e.ratio.toFixed(1)}:1
              <br />
              OUT {fmtDb(e.makeup)} dB
              <br />
              ATK 25 ms · REL 296 ms · KNEE MED
            </div>
          </div>
        ) : (
          <div className="knob-grid">
            <Knob label="THRESH" value={c.threshold} min={-60} max={0} step={0.5} reset={-20} fmt={(v) => `${v.toFixed(1)}`} topic="comp" testid="comp-threshold" onChange={(v) => onChange({ threshold: v })} />
            <Knob label="RATIO" value={c.ratio} min={1} max={20} log reset={4} fmt={(v) => `${v.toFixed(1)}:1`} topic="comp" testid="comp-ratio" onChange={(v) => onChange({ ratio: v })} />
            <Knob label="ATTACK" value={c.attack} min={0.1} max={120} log reset={10} fmt={(v) => `${v.toFixed(1)}ms`} topic="comp" onChange={(v) => onChange({ attack: v })} />
            <Knob label="RELEASE" value={c.release} min={5} max={5000} log reset={150} fmt={(v) => (v >= 1000 ? `${(v / 1000).toFixed(2)}s` : `${Math.round(v)}ms`)} topic="comp" onChange={(v) => onChange({ release: v })} />
            <Knob label="KNEE" value={c.knee} min={0} max={20} step={0.5} reset={2} fmt={(v) => (v === 0 ? 'HARD' : `${v.toFixed(1)}`)} topic="comp" onChange={(v) => onChange({ knee: v })} />
            <Knob label="OUT GAIN" value={c.makeup} min={-20} max={24} step={0.5} reset={0} fmt={(v) => fmtDb(v)} topic="comp" testid="comp-makeup" onChange={(v) => onChange({ makeup: v })} />
          </div>
        )}
      </div>
      <p className="note">
        Feed-forward compressor, stereo-linked, no hidden make-up gain. 1-KNOB uses Yamaha&apos;s fixed attack 25 ms / release 296 ms / knee
        Med; the amount → threshold/ratio/gain mapping is an approximation.
      </p>
    </Section>
  );
}

export function GateSection({ g, onChange, grId, keyOptions }: {
  g: GateState;
  onChange: (p: Partial<GateState>) => void;
  grId: string;
  keyOptions: { value: string; label: string }[];
}) {
  return (
    <Section
      title="DYNAMICS 1 · GATE / DUCKER"
      id="sec-gate"
      right={
        <div className="row">
          <Key small on={g.mode === 'gate'} topic="gate" testid="gate-mode-gate" onClick={() => onChange({ mode: 'gate', range: g.mode === 'gate' ? g.range : -60 })}>
            GATE
          </Key>
          <Key small on={g.mode === 'ducker'} topic="ducker" testid="gate-mode-ducker" onClick={() => onChange({ mode: 'ducker', range: g.mode === 'ducker' ? g.range : -12 })}>
            DUCKER
          </Key>
          <Key small on={g.on} kind="on" topic={g.mode} testid="gate-on" onClick={() => onChange({ on: !g.on })}>
            {g.on ? 'ON' : 'OFF'}
          </Key>
        </div>
      }
    >
      <div className="comp-wrap">
        <div>
          <GrMeter id={grId} height={110} />
          <small>{g.mode === 'gate' ? 'ATTEN' : 'DUCK'}</small>
        </div>
        <div className="knob-grid">
          <Knob label="THRESH" value={g.threshold} min={-72} max={0} step={0.5} reset={-40} fmt={(v) => v.toFixed(1)} topic={g.mode} testid="gate-threshold" onChange={(v) => onChange({ threshold: v })} />
          <Knob label="RANGE" value={g.range} min={-80} max={0} step={1} reset={g.mode === 'gate' ? -60 : -12} fmt={(v) => fmtDb(v, 0)} topic={g.mode} testid="gate-range" onChange={(v) => onChange({ range: v })} />
          <Knob label="ATTACK" value={g.attack} min={0} max={120} step={0.5} reset={1} fmt={(v) => `${v}ms`} topic={g.mode} onChange={(v) => onChange({ attack: v })} />
          <Knob label="HOLD" value={g.hold} min={0} max={2000} step={5} reset={50} fmt={(v) => `${Math.round(v)}ms`} topic={g.mode} onChange={(v) => onChange({ hold: v })} />
          <Knob label="DECAY" value={g.decay} min={5} max={4000} log reset={150} fmt={(v) => `${Math.round(v)}ms`} topic={g.mode} onChange={(v) => onChange({ decay: v })} />
        </div>
        <label className="field">
          <span>KEY IN</span>
          <Select label="Key in source" testid="gate-key" topic="ducker" value={g.key} options={keyOptions} onChange={(v) => onChange({ key: v })} />
        </label>
      </div>
      <p className="note">
        {g.mode === 'gate'
          ? 'GATE: below the threshold the channel is attenuated by RANGE (closes between notes / hits).'
          : 'DUCKER: when the KEY IN signal exceeds the threshold, this channel is turned down by RANGE (e.g. music under a voice).'}{' '}
        Order on this simulator: HPF → EQ → DYN 1 → DYN 2 → DELAY.
      </p>
    </Section>
  );
}

export function GroupKeys({ label, count, value, onToggle, topic, prefix }: {
  label: string;
  count: number;
  value: number[];
  onToggle: (n: number) => void;
  topic: string;
  prefix: string;
}) {
  return (
    <div className="dca-row">
      <span>{label}</span>
      {Array.from({ length: count }, (_, i) => (
        <Key key={i} small on={value.includes(i + 1)} topic={topic} testid={`${prefix}-${i + 1}`} onClick={() => onToggle(i + 1)}>
          {i + 1}
        </Key>
      ))}
    </div>
  );
}

const toggleIn = (arr: number[], n: number) => (arr.includes(n) ? arr.filter((x) => x !== n) : [...arr, n].sort((a, b) => a - b));

export function DelaySection({ on, ms, onToggle, onMs, title }: { on: boolean; ms: number; onToggle: () => void; onMs: (v: number) => void; title: string }) {
  return (
    <Section
      title={title}
      id="sec-delay"
      right={
        <Key small kind="on" on={on} topic="delay" testid="delay-on" onClick={onToggle}>
          {on ? 'ON' : 'OFF'}
        </Key>
      }
    >
      <div className="row">
        <Knob label="TIME" value={ms} min={0} max={1000} step={0.1} reset={0} fmt={(v) => `${v.toFixed(1)}ms`} topic="delay" testid="delay-ms" disabled={!on} onChange={onMs} />
        <span className="note">
          ≈ {((ms / 1000) * 343).toFixed(1)} m / {((ms / 1000) * 1125).toFixed(0)} ft of sound travel at 343 m/s.
        </span>
      </div>
    </Section>
  );
}

export function GeqSection({ on, gains, onToggle, onBand, onFlat }: { on: boolean; gains: number[]; onToggle: () => void; onBand: (i: number, v: number) => void; onFlat: () => void }) {
  return (
    <Section
      title="GEQ · 31 BAND"
      id="sec-geq"
      right={
        <div className="row">
          <Key small kind="on" on={on} topic="geq" testid="geq-on" onClick={onToggle}>
            GEQ {on ? 'ON' : 'OFF'}
          </Key>
          <Key small topic="geq" onClick={onFlat}>
            FLAT
          </Key>
        </div>
      }
    >
      <div className={`geq ${on ? '' : 'off'}`}>
        {GEQ_FREQS.map((f, i) => (
          <label key={f} className="geq-band" title={`${fmtHz(f)} Hz: ${fmtDb(gains[i] ?? 0)} dB`}>
            <input
              type="range"
              min={-15}
              max={15}
              step={0.5}
              value={gains[i] ?? 0}
              aria-label={`GEQ ${fmtHz(f)} Hz`}
              data-testid={`geq-${i}`}
              onChange={(e) => onBand(i, Number(e.target.value))}
              onDoubleClick={() => onBand(i, 0)}
            />
            <span>{fmtHz(f).replace('.00', '')}</span>
          </label>
        ))}
      </div>
      <p className="note">1/3-octave peaking filters, ±15 dB. Double-click a slider to zero it. Available on STEREO and MIX 1-6.</p>
    </Section>
  );
}

export function ChannelScreen() {
  const sel = useStore((s) => s.ui.selected);
  const isCh = useStore((s) => !!s.console.channels[sel]);
  return isCh ? <ChannelView id={sel} /> : <BusView id={sel} />;
}

function ChannelView({ id }: { id: string }) {
  const ch = useStore((s) => s.console.channels[id]);
  const def = useStore((s) => s.model.channels.find((c) => c.id === id)!);
  const model = useStore((s) => s.model);
  const ports = useStore((s) => s.console.ports);
  const rig = useStore((s) => s.rig);
  const consoleState = useStore((s) => s.console);
  const focus = useStore((s) => s.ui.focus);
  const learning = useStore((s) => s.ui.learning);
  const set = useStore((s) => s.set);
  const setUi = useStore((s) => s.setUi);
  const upd = (fn: (c: typeof ch) => void) => set((c) => fn(c.channels[id]));

  useEffect(() => {
    if (!focus) return;
    document.getElementById(focus)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setUi((u) => void (u.focus = null));
  }, [focus, setUi]);

  const portOpts = [
    { value: '', label: '— none —' },
    ...model.inPorts.map((p) => ({
      value: p.id,
      label: `${p.label}${rig.plugs[p.id] ? ` · ${deviceLabel(rig, rig.plugs[p.id]!.device)}` : ''}`,
    })),
  ];
  const portBlock = (port: string | null, side: 'L' | 'R' | null) => {
    const pdef = port ? model.inPorts.find((p) => p.id === port) : null;
    return (
      <div className="port-block" key={side ?? 'M'}>
        <label className="field">
          <span>Input patch{side ? ` ${side}` : ''}</span>
          <Select
            label={`Input patch ${side ?? ''}`}
            testid={`inpatch-${id}${side ? `-${side}` : ''}`}
            topic="input-patch"
            value={port ?? ''}
            options={portOpts}
            onChange={(v) => upd((c) => (side === 'R' ? (c.patchR = v || null) : (c.patchL = v || null)))}
          />
        </label>
        {port ? (
          <div className="row">
            <Meter tap={`port.${port}`} height={80} label={`${pdef?.label} after head amp`} />
            {pdef?.hasPreamp ? (
              <Knob
                label="HA GAIN"
                value={ports[port].gain}
                min={model.haGainRange[0]}
                max={model.haGainRange[1]}
                step={1}
                reset={0}
                fmt={(v) => fmtDb(v, 0)}
                topic="ha-gain"
                testid={`ha-${port}`}
                onChange={(v) => set((c) => void (c.ports[port].gain = v))}
              />
            ) : (
              <span className="note">Digital port: no head amp. Use DIGITAL GAIN.</span>
            )}
            {pdef?.hasPreamp ? (
              <Key small kind="warn" on={ports[port].phantom} topic="phantom" testid={`phantom-${port}`} onClick={() => set((c) => void (c.ports[port].phantom = !ports[port].phantom))}>
                +48V
              </Key>
            ) : null}
            <span className="note">
              Plugged in: <b>{rig.plugs[port] ? deviceLabel(rig, rig.plugs[port]!.device) : 'nothing'}</b>
              {rig.plugs[port] && !rig.plugs[port]!.device.startsWith('loop:') ? ` (${deviceKind(rig, rig.plugs[port]!.device)})` : ''}
            </span>
          </div>
        ) : null}
        {port && plugProblem(consoleState, rig, port) ? <div className="alert bad">{plugProblem(consoleState, rig, port)}.</div> : null}
        {port && ports[port]?.phantom && rig.plugs[port] && deviceKind(rig, rig.plugs[port]!.device) === 'line' ? (
          <div className="alert">+48V is on for a line-level device. Phantom power into unbalanced line outputs can damage equipment on a real stage.</div>
        ) : null}
      </div>
    );
  };

  const sendBuses = model.buses.filter((b) => b.kind === 'mix' || b.kind === 'fx' || b.kind === 'matrix');

  return (
    <div className="screen channel-screen" data-testid="channel-screen">
      <div className="screen-head">
        <input className="name-edit" value={ch.name} aria-label="Channel name" onChange={(e) => upd((c) => (c.name = e.target.value.slice(0, 12)))} />
        <span className="chip" style={{ background: ch.color }}>
          {def.defaultName} · {def.kind === 'mono' ? 'MONO' : 'STEREO'}
        </span>
        <input type="color" value={ch.color} aria-label="Channel color" onChange={(e) => upd((c) => (c.color = e.target.value))} />
        <Key small onClick={() => setUi((u) => void (u.screen = 'flow'))}>
          TRACE SIGNAL →
        </Key>
      </div>
      <div className="screen-grid">
        <Section title="INPUT" id="sec-input">
          {def.kind === 'fxreturn' ? (
            <p className="note">Fed internally by FX rack {def.fxRack}. Adjust the effect on the FX RACK screen.</p>
          ) : def.kind === 'stereo' ? (
            <>
              {portBlock(ch.patchL, 'L')}
              {portBlock(ch.patchR, 'R')}
            </>
          ) : (
            portBlock(ch.patchL, null)
          )}
          <div className="row">
            <Knob label="DIGITAL GAIN" value={ch.digitalGain} min={model.digitalGainRange[0]} max={model.digitalGainRange[1]} step={0.5} reset={0} fmt={(v) => fmtDb(v)} topic="digital-gain" testid="digital-gain" onChange={(v) => upd((c) => (c.digitalGain = v))} />
            <Key on={ch.polarity} kind="warn" onClick={() => upd((c) => (c.polarity = !ch.polarity))} topic="polarity" testid="polarity">
              Ø
            </Key>
            {def.kind === 'mono' ? (
              <>
                <Key on={ch.hpfOn} kind="on" onClick={() => upd((c) => (c.hpfOn = !ch.hpfOn))} topic="hpf" testid="hpf-on">
                  HPF
                </Key>
                <Knob label="HPF FREQ" value={ch.hpfFreq} min={20} max={600} log reset={80} fmt={fmtHz} topic="hpf" testid="hpf-freq" disabled={!ch.hpfOn} onChange={(v) => upd((c) => (c.hpfFreq = Math.round(v)))} />
              </>
            ) : (
              <span className="note">HPF and DYN 1 are on CH 1-16 only.</span>
            )}
            <div className="meter-labeled">
              <Meter tap={`ch.${id}.in`} height={80} label="Channel IN (after digital gain)" />
              <small>IN</small>
            </div>
          </div>
        </Section>

        {learning ? <GainStaging id={id} port={def.kind === 'fxreturn' ? null : ch.patchL} /> : null}

        <EqSection
          bands={ch.eq}
          eqOn={ch.eqOn}
          hpf={{ on: def.kind === 'mono' && ch.hpfOn, freq: ch.hpfFreq }}
          onToggle={() => upd((c) => (c.eqOn = !ch.eqOn))}
          onBand={(i, b) => upd((c) => Object.assign(c.eq[i], b))}
          onReset={() => upd((c) => (c.eq = defaultEq()))}
        />

        {def.kind === 'mono' ? (
          <GateSection
            g={ch.gate}
            grId={`ch.${id}.gate`}
            onChange={(p) => upd((c) => Object.assign(c.gate, p))}
            keyOptions={[
              { value: 'self', label: 'SELF POST EQ' },
              { value: 'self-pre', label: 'SELF PRE EQ' },
              ...model.channels.filter((k) => k.id !== id && k.kind !== 'fxreturn').map((k) => ({ value: k.id, label: `${k.short} ${consoleState.channels[k.id].name}` })),
              ...model.buses.filter((b) => b.kind === 'mix').map((b) => ({ value: b.id, label: consoleState.buses[b.id].name })),
            ]}
          />
        ) : null}

        <CompSection c={ch.comp} grId={`ch.${id}.gr`} meterTap={`ch.${id}.pre`} onChange={(p) => upd((c) => Object.assign(c.comp, p))} />

        <DelaySection title="INPUT DELAY" on={ch.delayOn} ms={ch.delayMs} onToggle={() => upd((c) => (c.delayOn = !ch.delayOn))} onMs={(v) => upd((c) => (c.delayMs = v))} />

        <Section title="ROUTING · SENDS" id="sec-routing">
          <div className="row">
            <Key on={ch.on} kind="on" onClick={() => upd((c) => (c.on = !ch.on))} topic="on-key" testid="sc-on">
              ON
            </Key>
            <Key on={ch.toSt} onClick={() => upd((c) => (c.toSt = !ch.toSt))} topic="st-assign" testid="sc-st">
              TO STEREO
            </Key>
            <Knob label="PAN" value={ch.pan} min={-63} max={63} step={1} reset={0} fmt={fmtPan} topic="pan" onChange={(v) => upd((c) => (c.pan = v))} />
            <Knob label="FADER" value={Math.max(-96, ch.fader)} min={-96} max={10} step={0.5} reset={0} fmt={() => fmtDb(ch.fader)} topic="channel-fader" onChange={(v) => upd((c) => (c.fader = v <= -95.9 ? NEG_INF : v))} />
            <div className="meter-labeled">
              <Meter tap={`ch.${id}.post`} height={80} label="POST fader" />
              <small>POST</small>
            </div>
          </div>
          {consoleState.dcas.length ? (
          <div className="dca-row">
            <span>DCA</span>
            {consoleState.dcas.map((d, i) => (
              <Key
                key={i}
                small
                on={ch.dca.includes(i + 1)}
                topic="dca"
                title={d.name}
                testid={`dca-assign-${i + 1}`}
                onClick={() => upd((c) => (c.dca = c.dca.includes(i + 1) ? c.dca.filter((x) => x !== i + 1) : [...c.dca, i + 1].sort()))}
              >
                {i + 1}
              </Key>
            ))}
          </div>
          ) : null}
          <GroupKeys label="MUTE GRP" prefix="mg-assign" count={consoleState.muteGroups.length} value={ch.muteGroups} topic="mute-group" onToggle={(n) => upd((c) => (c.muteGroups = toggleIn(c.muteGroups, n)))} />
          <table className="sends">
            <thead>
              <tr>
                <th>Bus</th>
                <th>ON</th>
                <th>Level</th>
                <th>Point</th>
                <th>Bus sig</th>
              </tr>
            </thead>
            <tbody>
              {sendBuses.map((b) => {
                const gov = b.kind === 'fx' ? b.id : governingBusId(consoleState, b.id);
                if (gov !== b.id) return null; // right side of a stereo-linked pair
                const s = ch.sends[gov];
                const linked = isLinked(consoleState, b.id);
                const pp = pairPartner(b.id);
                return (
                  <tr key={b.id} data-testid={`send-row-${b.id}`}>
                    <td>
                      <button className="linkish" onClick={() => setUi((u) => void ((u.selected = gov), (u.screen = 'channel')))}>
                        {consoleState.buses[gov].name}
                        {linked && pp ? ` (ST ${pp.left.slice(-1)}/${pp.right.slice(-1)})` : ''}
                      </button>
                    </td>
                    <td>
                      <Key small on={s.on} kind="on" topic={b.kind === 'fx' ? 'fx-send' : b.kind === 'matrix' ? 'matrix' : 'send-level'} testid={`send-on-${b.id}`} onClick={() => upd((c) => (c.sends[gov].on = !s.on))}>
                        ON
                      </Key>
                    </td>
                    <td className="send-level">
                      <input
                        type="range"
                        min={-61}
                        max={10}
                        step={0.5}
                        value={Math.max(-61, s.level)}
                        aria-label={`Send level to ${b.id}`}
                        data-testid={`send-level-${b.id}`}
                        onPointerDown={() => setUi((u) => void (u.topic = b.kind === 'fx' ? 'fx-send' : 'send-level'))}
                        onChange={(e) => {
                          const v = Number(e.target.value);
                          upd((c) => (c.sends[gov].level = v <= -61 ? NEG_INF : v));
                        }}
                      />
                      <span className="val">{fmtDb(s.level)}</span>
                      {linked ? (
                        <Knob size={22} label="PAN" value={s.pan} min={-63} max={63} step={1} reset={0} fmt={fmtPan} topic="stereo-link" onChange={(v) => upd((c) => (c.sends[gov].pan = v))} />
                      ) : null}
                    </td>
                    <td>
                      <Key small kind="accent" on={s.pre} topic="pre-post" testid={`send-pre-${b.id}`} onClick={() => upd((c) => (c.sends[gov].pre = !s.pre))}>
                        {s.pre ? 'PRE' : 'POST'}
                      </Key>
                    </td>
                    <td>
                      <SignalLed tap={`bus.${gov}.in`} title={`${b.id} bus has signal`} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Section>
      </div>
    </div>
  );
}

function BusView({ id }: { id: string }) {
  const model = useStore((s) => s.model);
  const def = model.buses.find((b) => b.id === id);
  const consoleState = useStore((s) => s.console);
  const outNames = useStore((s) => s.rig.outNames);
  const set = useStore((s) => s.set);
  const setUi = useStore((s) => s.setUi);
  if (!def) return <div className="screen">Select a channel or bus.</div>;
  const b = consoleState.buses[id];
  const upd = (fn: (x: typeof b) => void) => set((c) => fn(c.buses[id]));
  const pk = pairKeyOf(id);
  const pp = pairPartner(id);
  const psrcIds = def.kind === 'stereo' ? ['st_l', 'st_r'] : [id];
  const patchedTo = model.outPorts.filter((p) => psrcIds.includes(consoleState.outPorts[p.id].source ?? ''));
  const contributors = model.channels.filter((c) => {
    if (def.kind === 'stereo') return consoleState.channels[c.id].toSt;
    const s = consoleState.channels[c.id].sends[id];
    return s && s.on && s.level > NEG_INF;
  });

  return (
    <div className="screen channel-screen" data-testid="bus-screen">
      <div className="screen-head">
        <input className="name-edit" value={b.name} aria-label="Bus name" onChange={(e) => upd((x) => (x.name = e.target.value.slice(0, 12)))} />
        <span className="chip" style={{ background: b.color, color: '#111' }}>
          {def.defaultName} · {def.kind.toUpperCase()} BUS
        </span>
        <Key small onClick={() => setUi((u) => void (u.screen = 'flow'))}>
          TRACE SIGNAL →
        </Key>
      </div>
      <div className="screen-grid">
        <Section title="BUS MASTER" id="sec-master">
          <div className="row">
            <MeterScale height={120} />
            <div className="meter-labeled">
              <Meter tap={`bus.${id}.in`} height={120} label="Bus input (summed sends)" />
              <small>IN</small>
            </div>
            <div className="meter-labeled">
              <Meter tap={`bus.${id}.out`} height={120} label="After master" />
              <small>OUT</small>
            </div>
            <div className="col">
              <Key on={b.on} kind="on" onClick={() => upd((x) => (x.on = !b.on))} topic="bus-master" testid="bus-on">
                ON
              </Key>
              <Knob label="MASTER" value={Math.max(-96, b.fader)} min={-96} max={10} step={0.5} reset={0} fmt={() => fmtDb(b.fader)} topic="bus-master" testid="bus-master" onChange={(v) => upd((x) => (x.fader = v <= -95.9 ? NEG_INF : v))} />
              {def.kind === 'stereo' ? (
                <Knob label="BALANCE" value={b.balance} min={-63} max={63} step={1} reset={0} fmt={fmtPan} topic="pan" onChange={(v) => upd((x) => (x.balance = v))} />
              ) : null}
            </div>
            {pk && pp ? (
              <div className="col">
                <Key
                  on={!!consoleState.pairLinked[pk]}
                  topic="stereo-link"
                  testid="stereo-link"
                  onClick={() => set((c) => void (c.pairLinked[pk] = !c.pairLinked[pk]))}
                >
                  STEREO LINK {pp.left.toUpperCase()}/{pp.right.slice(-1)}
                </Key>
                <p className="note">When linked, {pp.left.toUpperCase()} controls both and is the LEFT side.</p>
              </div>
            ) : null}
          </div>
          {def.kind === 'mix' ? (
            <div className="dca-row">
              <span>PRE SENDS FROM</span>
              <Key small on={b.prePoint === 'fader'} topic="pre-post" testid="prepoint-fader" onClick={() => upd((x) => (x.prePoint = 'fader'))}>
                PRE FADER
              </Key>
              <Key small on={b.prePoint === 'eq'} topic="pre-post" testid="prepoint-eq" onClick={() => upd((x) => (x.prePoint = 'eq'))}>
                PRE EQ
              </Key>
            </div>
          ) : null}
                    <GroupKeys label="MUTE GRP" prefix="bus-mg-assign" count={consoleState.muteGroups.length} value={b.muteGroups} topic="mute-group" onToggle={(n) => upd((x) => (x.muteGroups = toggleIn(x.muteGroups, n)))} />
          <p className="note">
            Feeding this bus:{' '}
            {contributors.length ? contributors.map((c) => consoleState.channels[c.id].name).join(', ') : <b className="bad">no channels</b>}
          </p>
          {def.kind === 'fx' ? (
            <p className="note">
              This FX bus feeds FX rack {id.slice(2)} internally; its return comes back on FX{id.slice(2)} RTN.{' '}
              <button className="linkish" onClick={() => setUi((u) => void (u.screen = 'fx'))}>
                Open FX RACK
              </button>
            </p>
          ) : (
            <p className="note" data-testid="bus-patched-to">
              Patched to:{' '}
              {patchedTo.length ? (
                patchedTo.map((p) => `${p.label}${outNames[p.id] ? ` (${outNames[p.id]})` : ''}`).join(', ')
              ) : (
                <b className="bad">no output socket — this bus is not leaving the console</b>
              )}{' '}
              <button className="linkish" onClick={() => setUi((u) => void (u.screen = 'io'))}>
                Edit output patch
              </button>
            </p>
          )}
          <p className="note">
            Bus level now: <PeakText tap={`bus.${id}.out`} /> dBFS
          </p>
        </Section>
        {def.kind !== 'fx' ? (
          <>
            <EqSection
              bands={b.eq}
              eqOn={b.eqOn}
              onToggle={() => upd((x) => (x.eqOn = !b.eqOn))}
              onBand={(i, nb) => upd((x) => Object.assign(x.eq[i], nb))}
              onReset={() => upd((x) => (x.eq = defaultEq()))}
            />
            <CompSection
              c={b.comp}
              grId={`bus.${id}.gr`}
              meterTap={`bus.${id}.out`}
              onChange={(p) => upd((x) => Object.assign(x.comp, p))}
            />
          </>
        ) : null}
        {def.kind === 'stereo' || def.kind === 'mix' ? (
          <Section title="TO MATRIX">
            {model.buses
              .filter((m) => m.kind === 'matrix' && governingBusId(consoleState, m.id) === m.id)
              .map((m) => {
                const ms = b.mtxSends[m.id];
                return (
                  <div className="row" key={m.id}>
                    <span className="lbl">{consoleState.buses[m.id].name}{isLinked(consoleState, m.id) ? ' (stereo)' : ''}</span>
                    <Key small kind="on" on={ms.on} topic="matrix" onClick={() => upd((x) => (x.mtxSends[m.id].on = !ms.on))}>
                      ON
                    </Key>
                    <input
                      type="range"
                      min={-61}
                      max={10}
                      step={0.5}
                      value={Math.max(-61, ms.level)}
                      aria-label={`Matrix send ${m.id}`}
                      onChange={(e) => {
                        const v = Number(e.target.value);
                        upd((x) => (x.mtxSends[m.id].level = v <= -61 ? NEG_INF : v));
                      }}
                    />
                    <span className="val">{fmtDb(ms.level)}</span>
                  </div>
                );
              })}
          </Section>
        ) : null}
        {model.geqBuses.includes(id) ? (
          <GeqSection
            on={b.geqOn}
            gains={b.geq}
            onToggle={() => upd((x) => (x.geqOn = !b.geqOn))}
            onBand={(i, v) => upd((x) => (x.geq[i] = v))}
            onFlat={() => upd((x) => (x.geq = x.geq.map(() => 0)))}
          />
        ) : null}
        {def.kind !== 'fx' ? (
          <DelaySection title="OUTPUT DELAY" on={b.delayOn} ms={b.delayMs} onToggle={() => upd((x) => (x.delayOn = !b.delayOn))} onMs={(v) => upd((x) => (x.delayMs = v))} />
        ) : null}
        <Key small onClick={() => upd((x) => ((x.eq = defaultEq()), (x.comp = defaultComp())))}>
          RESET BUS PROCESSING
        </Key>
      </div>
    </div>
  );
}

/** Live level at every gain stage of the selected channel (learning mode). */
function GainStaging({ id, port }: { id: string; port: string | null }) {
  const ch = useStore((s) => s.console.channels[id]);
  const stages: [string, string, string][] = [
    ...(port ? ([[`port.${port}`, 'Input socket (after HA)', 'A/D converter: clips hard at 0 dBFS. Aim for -18…-6 peaks.']] as [string, string, string][]) : []),
    [`ch.${id}.in`, 'After digital gain', 'Digital trim adds to (or removes from) the converter level.'],
    [`ch.${id}.pre`, 'After EQ + dynamics (PRE fader)', 'EQ boosts and compressor make-up add gain here.'],
    [`ch.${id}.post`, 'After fader (POST)', `Fader ${fmtDb(ch.fader)} dB. Feeds STEREO and post-fader sends.`],
    ['bus.st.out', 'STEREO bus output', 'Sum of every assigned channel: gain accumulates as channels add up.'],
  ];
  return (
    <Section title="GAIN STAGING · LIVE" id="sec-gain">
      <table className="io-table">
        <tbody>
          {stages.map(([tap, label, note]) => (
            <tr key={tap}>
              <td>
                <SignalLed tap={tap} /> {label}
              </td>
              <td className="mono">
                <PeakText tap={tap} /> dBFS
              </td>
              <td>
                <Meter tap={tap} height={10} width={100} />
              </td>
              <td>
                <small>{note}</small>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="note">
        Input level and fader level are different things: HA gain sets how hot the signal is converted (fixing noise vs clipping); the fader only
        sets how much of it goes into the mix. Clipping at the input socket is permanent distortion; an OVER on an internal channel/bus meter is
        floating-point headroom, but it will clip at the output socket if nothing downstream brings it back down. A bus can show signal while an
        output stays silent when the bus is not patched to a socket, its master is OFF/-∞, or you are listening to a different socket.
      </p>
    </Section>
  );
}
