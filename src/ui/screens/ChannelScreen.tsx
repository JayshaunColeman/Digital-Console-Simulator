import { useEffect } from 'react';
import { useStore } from '../../state/store';
import { Key, Knob, Meter, MeterScale, GrMeter, Section, Select, SignalLed, PeakText } from '../controls';
import { EqCurve, CompCurve } from '../curves';
import { fmtDb, fmtHz, fmtPan } from '../../lib/db';
import { NEG_INF, type CompState, type EqBand } from '../../model/types';
import { deviceLabel, governingBusId, isLinked } from '../../engine/routing';
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
                onClick={() => onBand(i, { type: b.type === 'peak' ? (i === 0 ? 'lowshelf' : 'highshelf') : 'peak' })}
              >
                {b.type === 'peak' ? 'PEAK' : 'SHELF'}
              </Key>
            ) : (
              <span className="spacer-key">PEAK</span>
            )}
            <Knob label="GAIN" value={b.gain} min={-18} max={18} step={0.5} reset={0} fmt={(v) => fmtDb(v)} topic="eq" testid={`eq-gain-${i}`} onChange={(v) => onBand(i, { gain: v })} />
            <Knob label="FREQ" value={b.freq} min={20} max={20000} log reset={[100, 400, 2500, 8000][i]} fmt={fmtHz} topic="eq" testid={`eq-freq-${i}`} onChange={(v) => onBand(i, { freq: Math.round(v) })} />
            <Knob label="Q" value={b.q} min={0.1} max={16} log reset={i === 0 || i === 3 ? 0.7 : 2} fmt={(v) => v.toFixed(2)} topic="eq" disabled={b.type !== 'peak'} onChange={(v) => onBand(i, { q: v })} />
          </div>
        ))}
      </div>
    </Section>
  );
}

export function CompSection({ c, onChange, grId, meterTap }: { c: CompState; onChange: (p: Partial<CompState>) => void; grId: string; meterTap: string }) {
  return (
    <Section
      title="DYNAMICS · COMP"
      id="sec-dyn"
      right={
        <Key small on={c.on} kind="on" onClick={() => onChange({ on: !c.on })} topic="comp" testid="comp-on">
          COMP {c.on ? 'ON' : 'OFF'}
        </Key>
      }
    >
      <div className="comp-wrap">
        <CompCurve c={c} />
        <div className="comp-meters">
          <Meter tap={meterTap} height={120} label="Signal after dynamics (PRE-fader)" />
          <div>
            <GrMeter id={grId} height={120} />
            <small>GR</small>
          </div>
        </div>
        <div className="knob-grid">
          <Knob label="THRESH" value={c.threshold} min={-60} max={0} step={0.5} reset={-20} fmt={(v) => `${v.toFixed(1)}`} topic="comp" testid="comp-threshold" onChange={(v) => onChange({ threshold: v })} />
          <Knob label="RATIO" value={c.ratio} min={1} max={20} log reset={4} fmt={(v) => `${v.toFixed(1)}:1`} topic="comp" testid="comp-ratio" onChange={(v) => onChange({ ratio: v })} />
          <Knob label="ATTACK" value={c.attack} min={0.1} max={200} log reset={10} fmt={(v) => `${v.toFixed(1)}ms`} topic="comp" onChange={(v) => onChange({ attack: v })} />
          <Knob label="RELEASE" value={c.release} min={10} max={1000} log reset={150} fmt={(v) => `${Math.round(v)}ms`} topic="comp" onChange={(v) => onChange({ release: v })} />
          <Knob label="KNEE" value={c.knee} min={0} max={20} step={0.5} reset={2} fmt={(v) => `${v.toFixed(1)}`} topic="comp" onChange={(v) => onChange({ knee: v })} />
          <Knob label="MAKEUP" value={c.makeup} min={0} max={24} step={0.5} reset={0} fmt={(v) => fmtDb(v)} topic="comp" testid="comp-makeup" onChange={(v) => onChange({ makeup: v })} />
        </div>
      </div>
      <p className="note">Gate / ducker (DM3 Dynamics 1) is not simulated.</p>
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
            <span className="note">
              Plugged in: <b>{rig.plugs[port] ? deviceLabel(rig, rig.plugs[port]!.device) : 'nothing'}</b>
            </span>
          </div>
        ) : null}
      </div>
    );
  };

  const sendBuses = model.buses.filter((b) => b.kind === 'mix' || b.kind === 'fx');

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
            <Knob label="DIGITAL GAIN" value={ch.digitalGain} min={-96} max={24} step={0.5} reset={0} fmt={(v) => fmtDb(v)} topic="digital-gain" testid="digital-gain" onChange={(v) => upd((c) => (c.digitalGain = v))} />
            <Key on={ch.polarity} kind="warn" onClick={() => upd((c) => (c.polarity = !ch.polarity))} topic="polarity" testid="polarity">
              Ø
            </Key>
            <Key on={ch.hpfOn} kind="on" onClick={() => upd((c) => (c.hpfOn = !ch.hpfOn))} topic="hpf" testid="hpf-on">
              HPF
            </Key>
            <Knob label="HPF FREQ" value={ch.hpfFreq} min={20} max={600} log reset={80} fmt={fmtHz} topic="hpf" testid="hpf-freq" disabled={!ch.hpfOn} onChange={(v) => upd((c) => (c.hpfFreq = Math.round(v)))} />
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
          hpf={{ on: ch.hpfOn, freq: ch.hpfFreq }}
          onToggle={() => upd((c) => (c.eqOn = !ch.eqOn))}
          onBand={(i, b) => upd((c) => Object.assign(c.eq[i], b))}
          onReset={() => upd((c) => (c.eq = defaultEq()))}
        />

        <CompSection c={ch.comp} grId={`ch.${id}.gr`} meterTap={`ch.${id}.pre`} onChange={(p) => upd((c) => Object.assign(c.comp, p))} />

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
                const gov = b.kind === 'mix' ? governingBusId(consoleState, b.id) : b.id;
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
                      <Key small on={s.on} kind="on" topic={b.kind === 'fx' ? 'fx-send' : 'send-level'} testid={`send-on-${b.id}`} onClick={() => upd((c) => (c.sends[gov].on = !s.on))}>
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
        {def.kind !== 'fx' ? (
          <p className="note">Simulator: the DM3 GEQ insert on output buses is not simulated.</p>
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
