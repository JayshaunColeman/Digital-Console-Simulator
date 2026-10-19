import { useStore } from '../../state/store';
import { Key, Knob, Meter, Section, Select, SignalLed } from '../controls';
import { fmtDb, fmtHz } from '../../lib/db';
import type { FxType } from '../../model/types';
import { NEG_INF } from '../../model/types';

const TYPES: { value: FxType; label: string }[] = [
  { value: 'reverb-hall', label: 'REVERB HALL' },
  { value: 'reverb-plate', label: 'REVERB PLATE' },
  { value: 'delay-stereo', label: 'STEREO (PING-PONG) DELAY' },
  { value: 'delay-mono', label: 'MONO DELAY' },
];

export function FxScreen() {
  const fx = useStore((s) => s.console.fx);
  const c = useStore((s) => s.console);
  const model = useStore((s) => s.model);
  const set = useStore((s) => s.set);
  const setUi = useStore((s) => s.setUi);
  return (
    <div className="screen" data-testid="fx-screen">
      <p className="note">
        Signal flow: channel FX send → FX bus (send master) → FX rack → FX RTN channel → STEREO / MIX buses. Each part must be up for the effect
        to be heard. The DM3 has a much larger effect library; this simulator provides one reverb and one delay algorithm family.
      </p>
      <div className="screen-grid">
        {fx.map((f, i) => {
          const n = i + 1;
          const bus = c.buses[`fx${n}`];
          const rtn = c.channels[`fxr${n}`];
          const isRev = f.type.startsWith('reverb');
          const upd = (p: Partial<typeof f>) => set((x) => void Object.assign(x.fx[i], p));
          const senders = model.channels.filter((ch) => {
            const s = c.channels[ch.id].sends[`fx${n}`];
            return s && s.on && s.level > NEG_INF;
          });
          return (
            <Section key={n} title={`FX RACK ${n}`} right={<Select label={`FX ${n} type`} value={f.type} options={TYPES} topic="fx-send" onChange={(v) => upd({ type: v as FxType })} />}>
              <div className="fx-chain">
                <div className={`fx-node ${senders.length ? 'ok' : 'bad'}`}>
                  <b>Sends</b>
                  <small>{senders.length ? senders.map((s) => c.channels[s.id].name).join(', ') : 'no channel sends'}</small>
                </div>
                <span>→</span>
                <div className={`fx-node ${bus.on && bus.fader > NEG_INF ? 'ok' : 'bad'}`}>
                  <b>FX{n} bus</b>
                  <small>
                    {bus.on ? 'ON' : 'OFF'} {fmtDb(bus.fader)}
                  </small>
                  <SignalLed tap={`bus.fx${n}.out`} />
                </div>
                <span>→</span>
                <div className="fx-node ok">
                  <b>Rack</b>
                  <small>{TYPES.find((t) => t.value === f.type)?.label}</small>
                  <SignalLed tap={`fx.${n}.out`} />
                </div>
                <span>→</span>
                <div className={`fx-node ${rtn.on && rtn.fader > NEG_INF && (rtn.toSt || Object.values(rtn.sends).some((s) => s.on && s.level > NEG_INF)) ? 'ok' : 'bad'}`}>
                  <b>FX{n} RTN</b>
                  <small>
                    {rtn.on ? 'ON' : 'OFF'} {fmtDb(rtn.fader)} {rtn.toSt ? '→ST' : 'not to ST'}
                  </small>
                  <SignalLed tap={`ch.fxr${n}.post`} />
                </div>
              </div>
              <div className="row">
                <div className="meter-labeled">
                  <Meter tap={`bus.fx${n}.out`} height={110} label="FX bus (rack input)" />
                  <small>IN</small>
                </div>
                <div className="meter-labeled">
                  <Meter tap={`fx.${n}.out`} height={110} label="Rack output" />
                  <small>OUT</small>
                </div>
                {isRev ? (
                  <>
                    <Knob label="REV TIME" value={f.time} min={0.3} max={8} log reset={2.2} fmt={(v) => `${v.toFixed(1)}s`} topic="fx-send" testid={`fx${n}-time`} onChange={(v) => upd({ time: Math.round(v * 10) / 10 })} />
                    <Knob label="PRE-DLY" value={f.predelay} min={0} max={200} step={1} reset={20} fmt={(v) => `${v}ms`} onChange={(v) => upd({ predelay: v })} />
                  </>
                ) : (
                  <>
                    <Knob label="TIME" value={f.time} min={20} max={2400} log reset={400} fmt={(v) => `${Math.round(v)}ms`} topic="fx-send" testid={`fx${n}-time`} onChange={(v) => upd({ time: Math.round(v) })} />
                    <Knob label="FEEDBACK" value={f.feedback} min={0} max={0.95} step={0.01} reset={0.35} fmt={(v) => `${Math.round(v * 100)}%`} onChange={(v) => upd({ feedback: v })} />
                  </>
                )}
                <Knob label="LO CUT" value={f.loCut} min={20} max={1000} log reset={150} fmt={fmtHz} onChange={(v) => upd({ loCut: Math.round(v) })} />
                <Knob label="HI CUT" value={f.hiCut} min={1000} max={20000} log reset={7000} fmt={fmtHz} onChange={(v) => upd({ hiCut: Math.round(v) })} />
              </div>
              <div className="row">
                <Key small kind="on" on={bus.on} topic="fx-send" onClick={() => set((x) => void (x.buses[`fx${n}`].on = !bus.on))}>
                  FX{n} BUS ON
                </Key>
                <Key small kind="on" on={rtn.on} topic="fx-return" testid={`fxr${n}-on`} onClick={() => set((x) => void (x.channels[`fxr${n}`].on = !rtn.on))}>
                  RTN ON
                </Key>
                <Key small on={rtn.toSt} topic="fx-return" onClick={() => set((x) => void (x.channels[`fxr${n}`].toSt = !rtn.toSt))}>
                  RTN → ST
                </Key>
                <Key small onClick={() => setUi((u) => void ((u.selected = `fxr${n}`), (u.screen = 'channel')))}>
                  OPEN RTN CHANNEL
                </Key>
                <Key small onClick={() => setUi((u) => void ((u.selected = `fx${n}`), (u.screen = 'channel')))}>
                  OPEN FX BUS
                </Key>
              </div>
            </Section>
          );
        })}
      </div>
    </div>
  );
}
