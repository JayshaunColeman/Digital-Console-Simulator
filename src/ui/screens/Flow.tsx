// Live signal-flow trace for the selected channel or bus. Built from the same
// routing graph as the audio engine; LEDs read the real audio meters.

import { useMemo, useState, type ReactNode } from 'react';
import { useStore } from '../../state/store';
import { Key, Section, SignalLed, Select } from '../controls';
import { buildRoutingGraph, findBreaks, gainToDb, pathGain, type RGraph, type REdge, deviceLabel, effectiveFaderDb, dcaFor, plugProblem } from '../../engine/routing';
import { fmtDb, fmtHz } from '../../lib/db';
import { NEG_INF } from '../../model/types';
import type { Screen } from '../../state/store';

interface Block {
  key: string;
  title: string;
  sub?: string;
  state: 'ok' | 'off' | 'bypass' | 'none';
  tap?: string;
  go?: { screen: Screen; selected?: string; focus?: string };
  why?: string;
}

function BlockView({ b }: { b: Block }) {
  const setUi = useStore((s) => s.setUi);
  return (
    <button
      className={`fblock ${b.state}`}
      data-testid={`flow-${b.key}`}
      title={b.why ?? 'Open controls'}
      onClick={() =>
        b.go &&
        setUi((u) => {
          u.screen = b.go!.screen;
          if (b.go!.selected) u.selected = b.go!.selected;
          u.focus = b.go!.focus ?? null;
        })
      }
    >
      <span className="fb-title">
        {b.tap ? <SignalLed tap={b.tap} /> : null} {b.title}
      </span>
      {b.sub ? <span className="fb-sub">{b.sub}</span> : null}
      {b.why ? <span className="fb-why">{b.why}</span> : null}
    </button>
  );
}

function Chain({ blocks }: { blocks: Block[] }) {
  const out: ReactNode[] = [];
  blocks.forEach((b, i) => {
    if (i > 0) {
      const prev = blocks[i - 1];
      const broken = prev.state === 'off' || prev.state === 'none';
      out.push(<span key={`a${i}`} className={`farrow ${broken ? 'broken' : ''}`}>{broken ? '╳' : '→'}</span>);
    }
    out.push(<BlockView key={b.key} b={b} />);
  });
  return <div className="fchain">{out}</div>;
}

function downstream(g: RGraph, busId: string, labels: Map<string, string>, listenNames: (o: string) => string): Block[][] {
  // bus:out -> psrc -> out sockets -> listen ; also matrices
  const rows: Block[][] = [];
  const fromOut = g.out.get(`bus:${busId}:out`) ?? [];
  const patchEdges = fromOut.filter((e) => e.to.startsWith('psrc:'));
  const sockets: Block[][] = [];
  for (const pe of patchEdges) {
    for (const oe of g.out.get(pe.to) ?? []) {
      const port = oe.to.slice(4);
      const heard = (g.out.get(oe.to) ?? []).some((e) => e.to === 'listen');
      sockets.push([
        { key: `ps-${pe.to}-${port}`, title: 'Output patch', sub: `${labels.get(pe.to)} → ${port.toUpperCase()}`, state: oe.gain > 0 ? 'ok' : 'off', why: oe.why, go: { screen: 'io' } },
        { key: `sock-${port}`, title: labels.get(oe.to) ?? port, sub: oe.gain > 0 && oe.gain < 1 ? `ATT ${fmtDb(gainToDb(oe.gain))}` : undefined, state: 'ok', tap: `out.${port}`, go: { screen: 'io' } },
        { key: `lis-${port}`, title: heard ? 'Browser speakers' : 'Not monitored', sub: heard ? 'you are listening here' : listenNames(port), state: heard ? 'ok' : 'bypass', tap: heard ? 'listen' : undefined, go: { screen: 'io' } },
      ]);
    }
  }
  if (!patchEdges.length || !sockets.length) {
    if (!busId.startsWith('fx'))
      rows.push([{ key: `nopatch-${busId}`, title: 'Output patch', sub: 'not patched to any socket', state: 'none', why: 'This bus is not patched to an output socket, so it never leaves the console.', go: { screen: 'io' } }]);
  }
  rows.push(...sockets);
  for (const me of fromOut.filter((e) => e.to.startsWith('bus:mtx'))) {
    if (me.gain > 0) rows.push([{ key: `mtx-${busId}-${me.to}`, title: me.label, sub: `→ ${labels.get(me.to)} ${fmtDb(gainToDb(me.gain))}`, state: 'ok', go: { screen: 'channel', selected: me.to.slice(4) } }]);
  }
  return rows;
}

export function FlowScreen() {
  const model = useStore((s) => s.model);
  const c = useStore((s) => s.console);
  const rig = useStore((s) => s.rig);
  const sel = useStore((s) => s.ui.selected);
  const setUi = useStore((s) => s.setUi);
  const [showUnused, setShowUnused] = useState(false);
  const g = useMemo(() => buildRoutingGraph(model, c, rig), [model, c, rig]);
  const isCh = !!c.channels[sel];
  const listenNames = (o: string) => rig.outNames[o] ?? 'nothing connected';

  const options = [
    ...model.channels.map((d) => ({ value: d.id, label: `${d.defaultName} · ${c.channels[d.id].name}` })),
    ...model.buses.map((b) => ({ value: b.id, label: `${b.defaultName} bus` })),
  ];

  let head: Block[] = [];
  const branches: { title: string; rows: Block[][]; active: boolean }[] = [];
  let startNode = `bus:${sel}`;

  if (isCh) {
    const def = model.channels.find((d) => d.id === sel)!;
    const ch = c.channels[sel];
    startNode = `ch:${sel}`;
    const port = ch.patchL;
    const plug = port ? rig.plugs[port] : null;
    const pdef = port ? model.inPorts.find((p) => p.id === port) : null;
    if (def.kind === 'fxreturn') {
      head.push({ key: 'src', title: `FX rack ${def.fxRack}`, sub: c.fx[def.fxRack! - 1].type, state: 'ok', tap: `fx.${def.fxRack}.out`, go: { screen: 'fx' } });
    } else {
      const loop = plug && plug.device.startsWith('loop:');
      const prob = port ? plugProblem(c, rig, port) : null;
      head.push({
        key: 'dev',
        title: plug ? deviceLabel(rig, plug.device) : 'No device',
        sub: plug ? (loop ? 'LOOP CABLE' : `cable → ${port?.toUpperCase()}`) : 'nothing plugged into this socket',
        state: plug ? (prob ? 'off' : 'ok') : 'none',
        why: prob ?? undefined,
        tap: plug && !loop ? `dev.${plug.device}` : undefined,
        go: { screen: plug && !loop ? 'sources' : 'io' },
      });
      head.push({
        key: 'port',
        title: pdef ? pdef.label : 'Input patch',
        sub: pdef ? (pdef.hasPreamp ? `HA ${fmtDb(c.ports[port!].gain, 0)} dB` : 'digital port') : 'channel not patched',
        state: pdef ? 'ok' : 'none',
        why: pdef ? undefined : 'The channel has no input patched.',
        tap: pdef ? `port.${port}` : undefined,
        go: { screen: 'channel', selected: sel, focus: 'sec-input' },
      });
      if (def.kind === 'stereo' && ch.patchR) head[head.length - 1].sub += ` (+R ${ch.patchR.toUpperCase()})`;
    }
    head.push({ key: 'in', title: `${def.short} ${ch.name}`, sub: `gain ${fmtDb(ch.digitalGain)}${ch.polarity ? ' Ø' : ''}`, state: 'ok', tap: `ch.${sel}.in`, go: { screen: 'channel', selected: sel, focus: 'sec-input' } });
    if (def.kind === 'mono') head.push({ key: 'hpf', title: 'HPF', sub: ch.hpfOn ? fmtHz(ch.hpfFreq) : 'bypassed', state: ch.hpfOn ? 'ok' : 'bypass', go: { screen: 'channel', selected: sel, focus: 'sec-input' } });
    head.push({ key: 'eq', title: 'EQ', sub: ch.eqOn ? ch.eq.filter((b) => b.gain !== 0).length + ' bands active' : 'bypassed', state: ch.eqOn ? 'ok' : 'bypass', go: { screen: 'channel', selected: sel, focus: 'sec-eq' } });
    if (def.kind === 'mono') head.push({ key: 'gate', title: ch.gate.mode === 'ducker' ? 'DUCKER' : 'GATE', sub: ch.gate.on ? `${ch.gate.threshold} dB, range ${ch.gate.range}${ch.gate.key !== 'self' ? ` key ${ch.gate.key.toUpperCase()}` : ''}` : 'bypassed', state: ch.gate.on ? 'ok' : 'bypass', go: { screen: 'channel', selected: sel, focus: 'sec-gate' } });
    head.push({ key: 'comp', title: 'COMP', sub: ch.comp.on ? `${ch.comp.threshold} dB ${ch.comp.ratio.toFixed(1)}:1` : 'bypassed', state: ch.comp.on ? 'ok' : 'bypass', tap: `ch.${sel}.pre`, go: { screen: 'channel', selected: sel, focus: 'sec-dyn' } });
    if (ch.delayOn) head.push({ key: 'dly', title: 'DELAY', sub: `${ch.delayMs.toFixed(1)} ms`, state: 'ok', go: { screen: 'channel', selected: sel, focus: 'sec-delay' } });
    const dca = dcaFor(c, sel);
    head.push({ key: 'on', title: 'ON', sub: ch.on ? (dca.muted ? `muted by ${dca.muted}` : 'live') : 'OFF (muted)', state: ch.on && !dca.muted ? 'ok' : 'off', why: !ch.on ? 'Channel ON key is off' : dca.muted ? `Muted by ${dca.muted}` : undefined, go: { screen: 'channel', selected: sel, focus: 'sec-routing' } });
    const fdb = effectiveFaderDb(c, sel);
    head.push({ key: 'fader', title: 'Fader', sub: `${fmtDb(ch.fader)}${ch.dca.length ? ` (DCA → ${fmtDb(fdb)})` : ''}`, state: fdb > NEG_INF ? 'ok' : 'off', tap: `ch.${sel}.post`, why: fdb <= NEG_INF ? 'Fader at -∞ (post-fader paths are silent)' : undefined, go: { screen: 'channel', selected: sel, focus: 'sec-routing' } });

    // branches: ST + sends
    const outs: REdge[] = [...(g.out.get(`ch:${sel}:post`) ?? []), ...(g.out.get(`ch:${sel}:pre`) ?? [])].filter((e) => e.to.startsWith('bus:') && e.to !== 'bus:cue');
    for (const e of outs) {
      const busId = e.to.slice(4);
      const s = busId === 'st' ? null : ch.sends[busId] ?? null;
      const used = busId === 'st' ? ch.toSt : !!s && s.level > NEG_INF;
      if (!used && !showUnused) continue;
      const bm = g.out.get(`bus:${busId}`)?.find((x) => x.to === `bus:${busId}:out`);
      const assign: Block = {
        key: `as-${busId}`,
        title: e.label,
        sub: busId === 'st' ? (e.gain > 0 ? 'post-fader, post-pan' : 'off') : `${s?.on ? 'ON' : 'OFF'} ${fmtDb(s?.level ?? NEG_INF)} ${s?.pre ? '(pre-fader)' : '(post-fader)'}`,
        state: e.gain > 0 ? 'ok' : 'off',
        why: e.why,
        go: { screen: 'channel', selected: sel, focus: 'sec-routing' },
      };
      const busB: Block = { key: `bus-${busId}`, title: `${c.buses[busId].name} bus`, sub: 'sum of all sends', state: 'ok', tap: `bus.${busId}.in`, go: { screen: 'channel', selected: busId } };
      const masterB: Block = { key: `bm-${busId}`, title: 'Bus master', sub: bm && bm.gain > 0 ? fmtDb(gainToDb(bm.gain)) : 'OFF / -∞', state: bm && bm.gain > 0 ? 'ok' : 'off', why: bm?.why, tap: `bus.${busId}.out`, go: { screen: 'channel', selected: busId } };
      if (busId.startsWith('fx')) {
        const n = busId.slice(2);
        const r = c.channels[`fxr${n}`];
        branches.push({
          title: `${e.label}`,
          active: e.gain > 0,
          rows: [
            [assign, busB, masterB, { key: `rack-${n}`, title: `FX rack ${n}`, sub: c.fx[Number(n) - 1].type, state: 'ok', tap: `fx.${n}.out`, go: { screen: 'fx' } }, { key: `rtn-${n}`, title: `FX${n} RTN`, sub: `${r.on ? 'ON' : 'OFF'} ${fmtDb(r.fader)} ${r.toSt ? '→ ST' : 'no ST'}`, state: r.on && r.fader > NEG_INF ? 'ok' : 'off', tap: `ch.fxr${n}.post`, go: { screen: 'channel', selected: `fxr${n}` } }],
          ],
        });
        continue;
      }
      const ds = downstream(g, busId, g.labels, listenNames);
      branches.push({ title: e.label, active: e.gain > 0, rows: ds.length ? ds.map((r, i) => (i === 0 ? [assign, busB, masterB, ...r] : r)) : [[assign, busB, masterB]] });
    }
  } else {
    const def = model.buses.find((b) => b.id === sel);
    if (def) {
      const bm = g.out.get(`bus:${sel}`)?.find((x) => x.to === `bus:${sel}:out`);
      head = [
        { key: 'bus', title: `${c.buses[sel].name} bus`, sub: 'sum of sends', state: 'ok', tap: `bus.${sel}.in`, go: { screen: 'channel', selected: sel } },
        { key: 'bm', title: 'Bus master', sub: bm && bm.gain > 0 ? fmtDb(gainToDb(bm.gain)) : 'OFF / -∞', state: bm && bm.gain > 0 ? 'ok' : 'off', why: bm?.why, tap: `bus.${sel}.out`, go: { screen: 'channel', selected: sel } },
      ];
      branches.push({ title: 'Outputs', active: true, rows: downstream(g, sel, g.labels, listenNames) });
    }
  }

  const reachDb = gainToDb(pathGain(g, startNode, 'listen'));
  const breaks = reachDb <= NEG_INF ? findBreaks(g, startNode, 'listen') : [];

  return (
    <div className="screen" data-testid="flow-screen">
      <Section
        title="SIGNAL FLOW TRACE"
        right={
          <div className="row">
            <Select label="Trace source" value={sel} options={options} onChange={(v) => setUi((u) => void (u.selected = v))} testid="flow-select" />
            <Key small on={showUnused} onClick={() => setShowUnused(!showUnused)}>
              SHOW UNUSED SENDS
            </Key>
          </div>
        }
      >
        <div className={`alert ${reachDb > NEG_INF ? 'good' : 'bad'}`} data-testid="flow-verdict">
          {reachDb > NEG_INF ? (
            <>
              This source reaches your browser speakers (nominal routing gain {fmtDb(reachDb)} dB). LEDs show live signal at each point.
            </>
          ) : (
            <>
              This source does <b>not</b> reach what you are listening to.
              {breaks.length ? (
                <ul>
                  {breaks.slice(0, 6).map((b, i) => (
                    <li key={i}>{b.why ?? `${g.labels.get(b.from) ?? b.from} → ${g.labels.get(b.to) ?? b.to}: ${b.label} is off`}</li>
                  ))}
                </ul>
              ) : (
                ' No connection exists along the way (check output patch and listening position).'
              )}
            </>
          )}
        </div>
        <p className="note">Click any block to open its controls. Green = passing, red = switched off (path broken here), dashed = bypassed processing.</p>
        <Chain blocks={head} />
        {branches.length === 0 ? <p className="bad">No assignments: the channel is not routed to STEREO or any bus.</p> : null}
        {branches.map((b, i) => (
          <div key={i} className={`fbranch ${b.active ? '' : 'inactive'}`}>
            <div className="fbranch-title">↳ {b.title}</div>
            {b.rows.map((r, j) => (
              <div key={j} className={j > 0 ? 'fsubrow' : ''}>
                <Chain blocks={r} />
              </div>
            ))}
          </div>
        ))}
      </Section>
    </div>
  );
}
