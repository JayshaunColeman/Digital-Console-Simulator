import { useStore } from '../../state/store';
import { Fader, Key, Meter, Section, SignalLed } from '../controls';
import { fmtDb } from '../../lib/db';
import { NEG_INF } from '../../model/types';
import { governingBusId, isLinked } from '../../engine/routing';

export function OverviewScreen() {
  const model = useStore((s) => s.model);
  const c = useStore((s) => s.console);
  const rig = useStore((s) => s.rig);
  const setUi = useStore((s) => s.setUi);
  const set = useStore((s) => s.set);
  const open = (id: string) => setUi((u) => void ((u.selected = id), (u.screen = 'channel')));
  const outBuses = model.buses.filter((b) => b.kind !== 'stereo');

  return (
    <div className="screen" data-testid="overview-screen">
      <Section title="INPUT CHANNELS">
        <div className="ov-grid">
          {model.channels.map((def) => {
            const ch = c.channels[def.id];
            const sends = Object.entries(ch.sends).filter(([, s]) => s.on && s.level > NEG_INF);
            return (
              <button key={def.id} className={`ov-card ${ch.on ? '' : 'muted'}`} onClick={() => open(def.id)} data-testid={`ov-${def.id}`}>
                <div className="ov-top" style={{ borderColor: ch.color }}>
                  <b>{def.short}</b> {ch.name}
                </div>
                <div className="ov-body">
                  <Meter tap={`ch.${def.id}.pre`} height={54} />
                  <div className="ov-info">
                    <span>{ch.on ? fmtDb(ch.fader) : 'OFF'}</span>
                    <span className={ch.toSt ? 'good' : 'muted-text'}>{ch.toSt ? 'ST' : 'no ST'}</span>
                    <span className="ov-sends">{sends.map(([b]) => b.toUpperCase().replace('MIX', 'M')).join(' ')}</span>
                    {ch.comp.on ? <span className="tag">COMP</span> : null}
                    {ch.cue ? <span className="tag cue">CUE</span> : null}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </Section>
      <Section title="DCA GROUPS">
        <p className="note">A DCA offsets the faders of its member channels (assign members on SELECTED CH → ROUTING). DCA ON off mutes every member.</p>
        <div className="dca-grid">
          {c.dcas.map((d, i) => {
            const members = model.channels.filter((ch) => c.channels[ch.id].dca.includes(i + 1));
            return (
              <div className="dca-strip" key={i} data-testid={`dca-${i + 1}`}>
                <b>{d.name}</b>
                <small title={members.map((m) => c.channels[m.id].name).join(', ')}>{members.length ? `${members.length} ch` : 'empty'}</small>
                <Fader value={d.level} height={110} topic="dca" label={`${d.name} level`} onChange={(db) => set((x) => void (x.dcas[i].level = db))} />
                <span className="mono">{fmtDb(d.level)}</span>
                <Key small kind="on" on={d.on} topic="dca" testid={`dca-on-${i + 1}`} onClick={() => set((x) => void (x.dcas[i].on = !d.on))}>
                  ON
                </Key>
              </div>
            );
          })}
        </div>
      </Section>
      <div className="screen-grid">
        <Section title="BUSES">
          <div className="ov-buses">
            {[{ id: 'st', kind: 'stereo' }, ...outBuses].map((b) => {
              const gov = governingBusId(c, b.id);
              const bs = c.buses[gov];
              return (
                <button key={b.id} className={`ov-bus ${bs.on ? '' : 'muted'}`} onClick={() => open(gov)} data-testid={`ovbus-${b.id}`}>
                  <Meter tap={`bus.${b.id}.out`} height={90} />
                  <b>{c.buses[b.id].name}</b>
                  <small>
                    {bs.on ? fmtDb(bs.fader) : 'OFF'}
                    {isLinked(c, b.id) ? ' · ST' : ''}
                  </small>
                </button>
              );
            })}
          </div>
        </Section>
        <Section title="OUTPUT SOCKETS">
          <div className="ov-outs">
            {model.outPorts
              .filter((p) => p.group === 'analog' || c.outPorts[p.id].source)
              .slice(0, 16)
              .map((p) => (
                <div key={p.id} className="ov-out" data-testid={`ovout-${p.id}`}>
                  <SignalLed tap={`out.${p.id}`} />
                  <b>{p.label}</b>
                  <span>{c.outPorts[p.id].source?.toUpperCase().replace('_', ' ') ?? <i className="bad">unpatched</i>}</span>
                  <small>{rig.outNames[p.id] ?? ''}</small>
                  <Meter tap={`out.${p.id}`} height={10} width={90} />
                </div>
              ))}
          </div>
        </Section>
      </div>
    </div>
  );
}
