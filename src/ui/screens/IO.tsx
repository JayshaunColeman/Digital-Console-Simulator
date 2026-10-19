import { useStore } from '../../state/store';
import { Key, Knob, Meter, Section, Select, SignalLed } from '../controls';
import { fmtDb } from '../../lib/db';
import { NEG_INF } from '../../model/types';
import { buildRoutingGraph, findLoops, plugProblem } from '../../engine/routing';
import { useMemo } from 'react';

export function IOScreen() {
  return (
    <div className="screen" data-testid="io-screen">
      <OutputPatch />
      <InputSockets />
    </div>
  );
}

function psrcTap(src: string): string {
  if (src === 'st_l' || src === 'st_r') return 'bus.st.out';
  if (/^(mix|mtx)\d$/.test(src)) return `bus.${src}.out`;
  if (src.startsWith('mon')) return 'mon';
  const d = /^dir_(ch\d+)$/.exec(src);
  if (d) return `ch.${d[1]}.pre`;
  return '';
}

function OutputPatch() {
  const model = useStore((s) => s.model);
  const outPorts = useStore((s) => s.console.outPorts);
  const outNames = useStore((s) => s.rig.outNames);
  const listen = useStore((s) => s.rig.listen);
  const set = useStore((s) => s.set);
  const setRig = useStore((s) => s.setRig);
  const counts = new Map<string, number>();
  for (const p of model.outPorts) {
    const src = outPorts[p.id].source;
    if (src) counts.set(src, (counts.get(src) ?? 0) + 1);
  }
  const opts = [
    { value: '', label: '— unpatched —' },
    ...model.patchSources.map((s) => ({
      value: s.id,
      label: s.allowed ? `${s.group}: ${s.label}` : `✕ ${s.label} (not available)`,
      disabled: !s.allowed,
      title: s.reason,
    })),
  ];
  const groups: ('analog' | 'usb' | 'dante')[] = ['analog', 'usb', 'dante'];
  const omni = model.outPorts.filter((p) => p.group === 'analog');
  const gridSources = model.patchSources.filter((s) => !s.id.startsWith('dir_'));

  return (
    <>
      <Section title="OUTPUT PATCH · OMNI OUT GRID">
        <p className="note">
          Rows are internal sources, columns are physical output sockets. Each socket takes exactly one source; one source may feed several
          sockets (duplicates are allowed and marked). Crossed-out sources cannot be patched to an output on this console — hover them for why.
          A send puts a channel <i>into</i> a bus; the patch puts a bus <i>onto</i> a socket.
        </p>
        <div className="matrix-wrap">
          <table className="matrix patchgrid" data-testid="patch-grid">
            <thead>
              <tr>
                <th>Source</th>
                {omni.map((p) => (
                  <th key={p.id} title={outNames[p.id]}>
                    {p.label.replace('OMNI OUT ', 'OMNI ')}
                    <br />
                    <small>{outNames[p.id] ?? ''}</small>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {gridSources.map((s) => (
                <tr key={s.id} className={s.allowed ? '' : 'disallowed'} title={s.reason}>
                  <td>
                    {psrcTap(s.id) ? <SignalLed tap={psrcTap(s.id)} /> : <span className="led" />} {s.label}
                  </td>
                  {omni.map((p) => {
                    const on = outPorts[p.id].source === s.id;
                    return (
                      <td
                        key={p.id}
                        className={`cell ${on ? 'live' : ''} ${s.allowed ? '' : 'na'}`}
                        data-testid={`pg-${s.id}-${p.id}`}
                        onClick={() => {
                          if (!s.allowed) {
                            useStore.getState().flash(s.reason ?? 'Not available');
                            return;
                          }
                          useStore.getState().setUi((u) => void (u.topic = 'output-patch'));
                          set((c) => void (c.outPorts[p.id].source = on ? null : s.id));
                        }}
                      >
                        {on ? '●' : s.allowed ? '' : '✕'}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
      {groups.map((g) => {
        const ports = model.outPorts.filter((p) => p.group === g);
        if (!ports.length) return null;
        return (
          <Section key={g} title={`OUTPUT SOCKETS · ${g === 'analog' ? 'OMNI OUT (XLR)' : g === 'usb' ? 'USB AUDIO OUT' : 'DANTE OUT'}`}>
            <table className="io-table">
              <thead>
                <tr>
                  <th>Socket</th>
                  <th>Connected to</th>
                  <th>Source</th>
                  <th>Status</th>
                  <th>ATT</th>
                  <th>Level</th>
                </tr>
              </thead>
              <tbody>
                {ports.map((p) => {
                  const op = outPorts[p.id];
                  const dup = op.source && (counts.get(op.source) ?? 0) > 1;
                  const heard = listen.mode === 'ports' && (listen.l === p.id || listen.r === p.id);
                  return (
                    <tr key={p.id} data-testid={`outrow-${p.id}`}>
                      <td>
                        <b>{p.label}</b>
                        {heard ? <span className="tag good">BROWSER</span> : null}
                      </td>
                      <td>
                        <input
                          className="name-edit small"
                          value={outNames[p.id] ?? ''}
                          placeholder="(nothing)"
                          aria-label={`${p.label} connected device name`}
                          onChange={(e) => setRig((r) => void (r.outNames[p.id] = e.target.value.slice(0, 24)))}
                        />
                      </td>
                      <td>
                        <Select
                          label={`${p.label} source`}
                          testid={`outpatch-${p.id}`}
                          topic="output-patch"
                          value={op.source ?? ''}
                          options={opts}
                          onChange={(v) => set((c) => void (c.outPorts[p.id].source = v || null))}
                        />
                      </td>
                      <td>
                        {!op.source ? <span className="tag warn">UNPATCHED</span> : null}
                        {dup ? <span className="tag">DUPLICATE</span> : null}
                        {op.source ? <SignalLed tap={`out.${p.id}`} /> : null}
                      </td>
                      <td>
                        <input
                          type="range"
                          min={-61}
                          max={0}
                          step={0.5}
                          value={Math.max(-61, op.att)}
                          aria-label={`${p.label} attenuation`}
                          onChange={(e) => {
                            const v = Number(e.target.value);
                            set((c) => void (c.outPorts[p.id].att = v <= -61 ? NEG_INF : v));
                          }}
                        />
                        <span className="val">{fmtDb(op.att)}</span>
                      </td>
                      <td>
                        <Meter tap={`out.${p.id}`} height={14} width={120} label={`${p.label} output level`} testid={`meter-out-${p.id}`} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Section>
        );
      })}
    </>
  );
}

function InputSockets() {
  const model = useStore((s) => s.model);
  const rig = useStore((s) => s.rig);
  const c = useStore((s) => s.console);
  const set = useStore((s) => s.set);
  const setRig = useStore((s) => s.setRig);
  const loops = useMemo(() => findLoops(buildRoutingGraph(model, c, rig)), [model, c, rig]);
  const devOpts = [
    { value: '', label: '— nothing plugged in —' },
    { value: 'mic', label: 'Browser Microphone' },
    { value: 'gen', label: 'Signal Generator' },
    ...rig.players.map((p, i) => ({ value: `p${i + 1}`, label: `Player ${i + 1}: ${p.name}` })),
    ...model.outPorts.filter((p) => p.group === 'analog').map((p) => ({ value: `loop:${p.id}`, label: `⚠ Loop cable from ${p.label}` })),
  ];
  const usedBy = (port: string) =>
    model.channels.filter((ch) => c.channels[ch.id].patchL === port || c.channels[ch.id].patchR === port).map((ch) => c.channels[ch.id].name);

  return (
    <Section title="INPUT SOCKETS · WHAT IS PLUGGED IN">
      {loops.length ? (
        <div className="alert bad" data-testid="loop-alert">
          FEEDBACK LOOP DETECTED: {loops.map((l) => l.filter((n) => n.startsWith('out:') || n.startsWith('port:') || n.startsWith('bus:')).join(' → ')).join(' | ')}
        </div>
      ) : null}
      <p className="note">
        This is the physical stage: which device is cabled into which socket. HA GAIN is the analog preamp for that socket (stored in scenes).
        Stage wiring itself is not part of a scene.
      </p>
      <table className="io-table">
        <thead>
          <tr>
            <th>Socket</th>
            <th>Device</th>
            <th>Side</th>
            <th>HA GAIN</th>
            <th>+48V</th>
            <th>Level (post HA)</th>
            <th>Feeds channel</th>
          </tr>
        </thead>
        <tbody>
          {model.inPorts.map((p) => {
            const plug = rig.plugs[p.id];
            const stereoDev = plug && /^p\d$/.test(plug.device);
            const used = usedBy(p.id);
            if (p.group !== 'analog' && !plug && !used.length && !['usb1', 'usb17', 'dante1'].includes(p.id)) return null;
            return (
              <tr key={p.id} data-testid={`inrow-${p.id}`}>
                <td>
                  <b>{p.label}</b>
                </td>
                <td>
                  <Select
                    label={`${p.label} device`}
                    testid={`plug-${p.id}`}
                    topic={plug?.device.startsWith('loop') ? 'loop' : 'input-patch'}
                    value={plug?.device ?? ''}
                    options={devOpts}
                    onChange={(v) => setRig((r) => void (r.plugs[p.id] = v ? { device: v, ch: r.plugs[p.id]?.ch ?? 'SUM' } : null))}
                  />
                </td>
                <td>
                  {stereoDev ? (
                    <Select
                      label={`${p.label} side`}
                      value={plug!.ch}
                      options={[
                        { value: 'SUM', label: 'L+R' },
                        { value: 'L', label: 'L' },
                        { value: 'R', label: 'R' },
                      ]}
                      onChange={(v) => setRig((r) => void (r.plugs[p.id]!.ch = v as 'L' | 'R' | 'SUM'))}
                    />
                  ) : (
                    '—'
                  )}
                </td>
                <td>
                  {p.hasPreamp ? (
                    <Knob
                      size={26}
                      label=""
                      value={c.ports[p.id].gain}
                      min={model.haGainRange[0]}
                      max={model.haGainRange[1]}
                      step={1}
                      reset={0}
                      fmt={(v) => fmtDb(v, 0)}
                      topic="ha-gain"
                      testid={`io-ha-${p.id}`}
                      onChange={(v) => set((x) => void (x.ports[p.id].gain = v))}
                    />
                  ) : (
                    <small>digital</small>
                  )}
                </td>
                <td>
                  {p.hasPreamp ? (
                    <Key small kind="warn" on={c.ports[p.id].phantom} topic="phantom" testid={`io-phantom-${p.id}`} onClick={() => set((x) => void (x.ports[p.id].phantom = !c.ports[p.id].phantom))}>
                      48V
                    </Key>
                  ) : (
                    '—'
                  )}
                  {plugProblem(c, rig, p.id) ? <span className="tag bad" title={plugProblem(c, rig, p.id)!}>NO 48V</span> : null}
                </td>
                <td>
                  <Meter tap={`port.${p.id}`} height={14} width={120} label={`${p.label} level`} />
                </td>
                <td>{used.length ? used.join(', ') : <span className="muted-text">not patched</span>}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="row">
        <Key small onClick={() => useStore.getState().resetRig()}>
          RESET STAGE WIRING
        </Key>
      </div>
    </Section>
  );
}
