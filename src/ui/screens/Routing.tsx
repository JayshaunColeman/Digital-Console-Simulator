import { useStore } from '../../state/store';
import { Section, SignalLed, useTopic } from '../controls';
import { fmtDb } from '../../lib/db';
import { NEG_INF } from '../../model/types';
import { deviceLabel, governingBusId, isLinked } from '../../engine/routing';

/** Channel -> bus assignment matrix (ST assign + every mix/FX send). */
export function RoutingScreen() {
  const model = useStore((s) => s.model);
  const c = useStore((s) => s.console);
  const rig = useStore((s) => s.rig);
  const set = useStore((s) => s.set);
  const setUi = useStore((s) => s.setUi);
  const setTopic = useTopic();
  const cols = model.buses.filter((b) => b.kind === 'stereo' || ((b.kind === 'mix' || b.kind === 'fx') && governingBusId(c, b.id) === b.id));

  const clickCell = (ch: string, bus: string, e: React.MouseEvent) => {
    if (bus === 'st') {
      setTopic('st-assign');
      set((x) => void (x.channels[ch].toSt = !x.channels[ch].toSt));
      return;
    }
    setTopic(e.shiftKey ? 'pre-post' : bus.startsWith('fx') ? 'fx-send' : 'send-level');
    set((x) => {
      const s = x.channels[ch].sends[bus];
      if (e.shiftKey) s.pre = !s.pre;
      else if (s.level <= NEG_INF) {
        s.level = 0;
        s.on = true;
      } else s.on = !s.on;
    });
  };
  const wheelCell = (ch: string, bus: string, e: React.WheelEvent) => {
    if (bus === 'st') return;
    set((x) => {
      const s = x.channels[ch].sends[bus];
      const base = s.level <= NEG_INF ? -40 : s.level;
      const n = base + (e.deltaY < 0 ? 1 : -1);
      s.level = n < -60 ? NEG_INF : Math.min(10, n);
    });
  };

  return (
    <div className="screen" data-testid="routing-screen">
      <Section title="CHANNEL → BUS ROUTING">
        <p className="note">
          Click a cell to assign / switch a send (a send at -∞ jumps to 0 dB). Mouse wheel adjusts the send level. Shift-click toggles PRE/POST.
          Green = carrying signal path, grey = switched off. This is the same routing the audio engine uses.
        </p>
        <div className="matrix-wrap">
          <table className="matrix" data-testid="routing-matrix">
            <thead>
              <tr>
                <th>Channel</th>
                <th>Source</th>
                {cols.map((b) => (
                  <th key={b.id}>
                    <button className="linkish" onClick={() => setUi((u) => void ((u.selected = b.id), (u.screen = 'channel')))}>
                      {c.buses[b.id].name}
                      {isLinked(c, b.id) ? ' ST' : ''}
                    </button>
                    <SignalLed tap={`bus.${b.id}.in`} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {model.channels.map((def) => {
                const ch = c.channels[def.id];
                const port = def.kind === 'fxreturn' ? null : ch.patchL;
                const dev = port && rig.plugs[port] ? deviceLabel(rig, rig.plugs[port]!.device) : def.kind === 'fxreturn' ? `FX rack ${def.fxRack}` : '—';
                return (
                  <tr key={def.id} className={ch.on ? '' : 'muted'}>
                    <td>
                      <button className="linkish" onClick={() => setUi((u) => void ((u.selected = def.id), (u.screen = 'channel')))}>
                        <span className="dot" style={{ background: ch.color }} /> {def.short} {ch.name}
                      </button>
                      {!ch.on ? <span className="tag bad">OFF</span> : null}
                    </td>
                    <td className="src">
                      <SignalLed tap={`ch.${def.id}.in`} /> {port ? port.toUpperCase() : ''} <small>{dev}</small>
                    </td>
                    {cols.map((b) => {
                      if (b.id === 'st') {
                        return (
                          <td key={b.id} className={`cell ${ch.toSt ? 'live' : 'off'}`} data-testid={`cell-${def.id}-st`} onClick={(e) => clickCell(def.id, 'st', e)}>
                            {ch.toSt ? 'ST' : '·'}
                          </td>
                        );
                      }
                      const s = ch.sends[b.id];
                      const active = s.on && s.level > NEG_INF;
                      return (
                        <td
                          key={b.id}
                          className={`cell ${active ? 'live' : s.level > NEG_INF ? 'off' : ''}`}
                          data-testid={`cell-${def.id}-${b.id}`}
                          onClick={(e) => clickCell(def.id, b.id, e)}
                          onWheel={(e) => wheelCell(def.id, b.id, e)}
                          title={`${ch.name} → ${c.buses[b.id].name}: ${s.on ? 'ON' : 'OFF'} ${fmtDb(s.level)} dB ${s.pre ? 'PRE' : 'POST'}`}
                        >
                          {s.level > NEG_INF ? (
                            <>
                              {fmtDb(s.level, 0)}
                              <sup>{s.pre ? 'pre' : 'post'}</sup>
                            </>
                          ) : (
                            '·'
                          )}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
              <tr className="bus-row">
                <td colSpan={2}>Bus master</td>
                {cols.map((b) => {
                  const bs = c.buses[b.id];
                  return (
                    <td key={b.id} className={bs.on && bs.fader > NEG_INF ? 'live-text' : 'bad'}>
                      {bs.on ? fmtDb(bs.fader, 0) : 'OFF'}
                    </td>
                  );
                })}
              </tr>
              <tr className="bus-row">
                <td colSpan={2}>Patched to</td>
                {cols.map((b) => {
                  const src = b.id === 'st' ? ['st_l', 'st_r'] : [b.id];
                  const outs = model.outPorts.filter((p) => src.includes(c.outPorts[p.id].source ?? '')).map((p) => p.label.replace('OMNI OUT ', 'O').replace('USB OUT ', 'U').replace('DANTE OUT ', 'D'));
                  return (
                    <td key={b.id} className={outs.length || b.kind === 'fx' ? '' : 'bad'}>
                      {b.kind === 'fx' ? `FX${b.id.slice(2)} rack` : outs.length ? outs.join(' ') : 'none'}
                    </td>
                  );
                })}
              </tr>
            </tbody>
          </table>
        </div>
      </Section>
    </div>
  );
}
