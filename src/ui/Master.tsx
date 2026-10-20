import { useEffect } from 'react';
import { useStore } from '../state/store';
import { getEngine, useRuntime } from '../state/engine';
import { IN_LABEL, OUT_LABEL } from './Strips';
import { Fader, Key, Meter, MeterScale, GrMeter, Knob, Select } from './controls';
import { fmtDb, fmtHz } from '../lib/db';
import { anyCue, governingBusId, isLinked } from '../engine/routing';

const SOF_BUSES = ['mix1', 'mix2', 'mix3', 'mix4', 'mix5', 'mix6', 'fx1', 'fx2'];

export function MasterSection() {
  const st = useStore((s) => s.console.buses.st);
  const sof = useStore((s) => s.ui.sof);
  const gov = useStore((s) => (s.ui.sof ? governingBusId(s.console, s.ui.sof) : null));
  const sofBus = useStore((s) => (gov ? s.console.buses[gov] : null));
  const buses = useStore((s) => s.console.buses);
  const consoleState = useStore((s) => s.console);
  const monitor = useStore((s) => s.console.monitor);
  const listen = useStore((s) => s.rig.listen);
  const outNames = useStore((s) => s.rig.outNames);
  const outPorts = useStore((s) => s.model.outPorts);
  const set = useStore((s) => s.set);
  const setUi = useStore((s) => s.setUi);
  const setRig = useStore((s) => s.setRig);
  const cueing = anyCue(consoleState);

  const outOpts = [
    { value: '', label: '— nothing —' },
    ...outPorts.map((p) => ({ value: p.id, label: outNames[p.id] ? `${p.label} · ${outNames[p.id]}` : p.label })),
  ];

  return (
    <aside className="master">
      <div className="master-block sof-block">
        <div className="block-title">SENDS ON FADER</div>
        <Key
          on={!!sof}
          kind="accent"
          testid="sof-toggle"
          topic="sof"
          onClick={() => setUi((u) => void (u.sof = u.sof ? null : 'mix1'))}
        >
          {sof ? 'SOF ON' : 'SOF OFF'}
        </Key>
        <div className="sof-buses">
          {SOF_BUSES.map((b) => {
            const linkedRight = isLinked(consoleState, b) && governingBusId(consoleState, b) !== b;
            return (
              <Key
                key={b}
                small
                kind="accent"
                on={sof === b}
                testid={`sof-${b}`}
                topic="sof"
                disabled={linkedRight}
                title={linkedRight ? 'Linked to the odd bus of this stereo pair' : buses[b].name}
                onClick={() => setUi((u) => void (u.sof = b))}
              >
                {b.toUpperCase()}
              </Key>
            );
          })}
        </div>
        {sofBus && gov ? (
          <div className="sof-master" data-testid="sof-master">
            <div className="sof-label">
              Faders = sends to <b>{sofBus.name}</b>
            </div>
            <div className="strip-fader">
              <MeterScale height={150} />
              <Meter tap={`bus.${gov}.out`} height={150} testid="sof-bus-meter" />
              <Fader
                value={sofBus.fader}
                height={170}
                topic="bus-master"
                testid="sof-bus-fader"
                label={`${sofBus.name} master`}
                onChange={(db) => set((c) => void (c.buses[gov].fader = db))}
              />
            </div>
            <div className="strip-db">{fmtDb(sofBus.fader)}</div>
            <Key on={sofBus.on} kind="on" topic="bus-master" testid="sof-bus-on" onClick={() => set((c) => void (c.buses[gov].on = !sofBus.on))}>
              ON
            </Key>
          </div>
        ) : (
          <p className="hint">Select a bus, then the channel faders control each channel&apos;s send to it.</p>
        )}
      </div>

      <div className="master-block">
        <div className="block-title">STEREO MASTER</div>
        <div className="strip-fader">
          <MeterScale height={190} />
          <Meter tap="bus.st.out" height={190} testid="meter-st-out" label="STEREO bus output" />
          <Fader
            value={st.fader}
            height={210}
            color="#ddd"
            topic="bus-master"
            testid="fader-st"
            label="STEREO master"
            onChange={(db) => set((c) => void (c.buses.st.fader = db))}
          />
        </div>
        <div className="strip-db">{fmtDb(st.fader)}</div>
        <div className="strip-row">
          <Key on={st.on} kind="on" testid="on-st" topic="bus-master" onClick={() => set((c) => void (c.buses.st.on = !st.on))}>
            ON
          </Key>
          <Key on={st.cue} kind="cue" testid="cue-st" topic="cue" onClick={() => set((c) => void (c.buses.st.cue = !st.cue))}>
            CUE
          </Key>
        </div>
        <Key kind="sel" on={false} onClick={() => setUi((u) => void ((u.selected = 'st'), ((u.screen = 'channel'), (u.pane = 'screen'))))}>
          SEL ST
        </Key>
      </div>

      <div className="master-block">
        <div className="block-title">MUTE GROUPS</div>
        <div className="sof-buses" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
          {consoleState.muteGroups.map((g, i) => {
            const members = [
              ...Object.values(consoleState.channels).filter((c) => c.muteGroups.includes(i + 1)).map((c) => c.name),
              ...Object.values(consoleState.buses).filter((b) => b.muteGroups.includes(i + 1)).map((b) => b.name),
            ];
            return (
              <Key
                key={i}
                small
                kind="warn"
                on={g.on}
                topic="mute-group"
                testid={`mg-${i + 1}`}
                title={members.length ? `Members: ${members.join(', ')}` : 'No members assigned'}
                onClick={() => set((c) => void (c.muteGroups[i].on = !g.on))}
              >
                MUTE {i + 1}
                {members.length ? '' : ' ·'}
              </Key>
            );
          })}
        </div>
      </div>

      <MeterSetup />

      <TalkbackOsc />

      <div className="master-block">
        <div className="block-title">MONITOR / LISTEN</div>
        <label className="field">
          <span>Browser hears</span>
          <Select
            label="Listening mode"
            testid="listen-mode"
            topic="listen"
            value={listen.mode}
            onChange={(v) => setRig((r) => void (r.listen.mode = v as 'ports' | 'phones'))}
            options={[
              { value: 'ports', label: 'Output sockets' },
              { value: 'phones', label: 'PHONES (monitor/cue)' },
            ]}
          />
        </label>
        {listen.mode === 'ports' ? (
          <>
            <label className="field">
              <span>L speaker</span>
              <Select label="Left speaker" testid="listen-l" topic="listen" value={listen.l ?? ''} options={outOpts} onChange={(v) => setRig((r) => void (r.listen.l = v || null))} />
            </label>
            <label className="field">
              <span>R speaker</span>
              <Select label="Right speaker" testid="listen-r" topic="listen" value={listen.r ?? ''} options={outOpts} onChange={(v) => setRig((r) => void (r.listen.r = v || null))} />
            </label>
          </>
        ) : null}
        <div className="listen-row">
          <Meter tap="listen" height={90} testid="meter-listen" label="Browser output (after safety limiter)" />
          <Knob label="VOLUME" value={listen.volume} min={-60} max={6} step={0.5} reset={-6} fmt={(v) => fmtDb(v)} topic="listen" testid="listen-volume" onChange={(v) => setRig((r) => void (r.listen.volume = v))} />
          <div className="lim">
            <GrMeter id="listen.gr" height={70} />
            <small>LIMIT</small>
          </div>
        </div>
        <div className="strip-row wrap">
          <Key small on={monitor.cueMode === 'PFL'} topic="cue" onClick={() => set((c) => void (c.monitor.cueMode = 'PFL'))}>
            PFL
          </Key>
          <Key small on={monitor.cueMode === 'AFL'} topic="cue" onClick={() => set((c) => void (c.monitor.cueMode = 'AFL'))}>
            AFL
          </Key>
          <Key
            small
            kind="warn"
            on={cueing}
            testid="cue-clear"
            topic="cue"
            onClick={() =>
              set((c) => {
                Object.values(c.channels).forEach((x) => (x.cue = false));
                Object.values(c.buses).forEach((x) => (x.cue = false));
              })
            }
          >
            CLEAR CUE
          </Key>
        </div>
        <label className="field">
          <span>Monitor src</span>
          <Select
            label="Monitor source"
            topic="monitor"
            value={monitor.source}
            onChange={(v) => set((c) => void (c.monitor.source = v))}
            options={[{ value: 'st', label: 'STEREO' }, ...['mix1', 'mix2', 'mix3', 'mix4', 'mix5', 'mix6'].map((b) => ({ value: b, label: buses[b].name }))]}
          />
        </label>
        <Knob label="MON/PHONES" value={monitor.level} min={-60} max={10} step={0.5} reset={-10} fmt={(v) => fmtDb(v)} topic="monitor" onChange={(v) => set((c) => void (c.monitor.level = v))} />
      </div>
    </aside>
  );
}

const ASSIGNABLE = ['mix1', 'mix2', 'mix3', 'mix4', 'mix5', 'mix6', 'st', 'mtx1', 'mtx2'];

function TalkbackOsc() {
  const tb = useStore((s) => s.console.talkback);
  const osc = useStore((s) => s.console.osc);
  const model = useStore((s) => s.model);
  const set = useStore((s) => s.set);
  const toggle = (arr: string[], b: string) => (arr.includes(b) ? arr.filter((x) => x !== b) : [...arr, b]);
  return (
    <div className="master-block">
      {model.features.talkback ? (
      <>
      <div className="block-title">TALKBACK</div>
      <div className="strip-row wrap">
        <Key kind="cue" on={tb.on} topic="talkback" testid="tb-on" onClick={() => set((c) => void (c.talkback.on = !tb.on))}>
          TALKBACK
        </Key>
        <Meter tap="tb" height={12} width={70} label="Talkback level" />
      </div>
      <label className="field">
        <span>Source</span>
        <Select
          label="Talkback source"
          topic="talkback"
          value={tb.source ?? ''}
          onChange={(v) => set((c) => void (c.talkback.source = v || null))}
          options={[{ value: '', label: '— none —' }, ...model.inPorts.map((p) => ({ value: p.id, label: p.label }))]}
        />
      </label>
      <Knob label="TB LEVEL" value={tb.level} min={-40} max={10} step={0.5} reset={0} fmt={(v) => fmtDb(v)} topic="talkback" onChange={(v) => set((c) => void (c.talkback.level = v))} />
      <div className="sof-buses">
        {ASSIGNABLE.map((b) => (
          <Key key={b} small on={tb.assign.includes(b)} topic="talkback" testid={`tb-assign-${b}`} onClick={() => set((c) => void (c.talkback.assign = toggle(c.talkback.assign, b)))}>
            {b.toUpperCase()}
          </Key>
        ))}
      </div>

      </>
      ) : null}
      <div className="block-title">OSCILLATOR</div>
      <div className="strip-row wrap">
        <Key kind="warn" on={osc.on} topic="osc" testid="osc-on" onClick={() => set((c) => void (c.osc.on = !osc.on))}>
          OSC {osc.on ? 'ON' : 'OFF'}
        </Key>
        <Select
          label="Oscillator type"
          topic="osc"
          testid="osc-type"
          value={osc.type}
          onChange={(v) => set((c) => void (c.osc.type = v as 'sine' | 'pink' | 'burst'))}
          options={[
            { value: 'sine', label: 'Sine' },
            { value: 'pink', label: 'Pink noise' },
            { value: 'burst', label: 'Burst noise' },
          ]}
        />
      </div>
      <div className="strip-row">
        <Knob label="FREQ" value={osc.freq} min={20} max={20000} log reset={1000} fmt={fmtHz} disabled={osc.type !== 'sine'} topic="osc" onChange={(v) => set((c) => void (c.osc.freq = Math.round(v)))} />
        <Knob label="LEVEL" value={osc.level} min={-96} max={0} step={1} reset={-20} fmt={(v) => `${v}`} topic="osc" testid="osc-level" onChange={(v) => set((c) => void (c.osc.level = v))} />
        <Meter tap="osc" height={12} width={60} label="Oscillator level" />
      </div>
      <div className="sof-buses">
        {ASSIGNABLE.map((b) => (
          <Key key={b} small kind="warn" on={osc.assign.includes(b)} topic="osc" testid={`osc-assign-${b}`} onClick={() => set((c) => void (c.osc.assign = toggle(c.osc.assign, b)))}>
            {b.toUpperCase()}
          </Key>
        ))}
      </div>
    </div>
  );
}

function MeterSetup() {
  const ui = useStore((s) => s.ui);
  const setUi = useStore((s) => s.setUi);
  const running = useRuntime((r) => r.running);
  useEffect(() => {
    const e = getEngine();
    if (e) e.meters.holdEnabled = ui.peakHold;
  }, [ui.peakHold, running]);
  return (
    <div className="master-block">
      <div className="block-title">METER</div>
      <div className="meter-points">
        <span>INPUT</span>
        {(['prehpf', 'prefader', 'poston'] as const).map((p) => (
          <Key key={p} small on={ui.meterIn === p} topic="meters" testid={`mp-in-${p}`} onClick={() => setUi((u) => void (u.meterIn = p))}>
            {IN_LABEL[p]}
          </Key>
        ))}
        <span>OUTPUT</span>
        {(['preeq', 'prefader', 'poston'] as const).map((p) => (
          <Key key={p} small on={ui.meterOut === p} topic="meters" testid={`mp-out-${p}`} onClick={() => setUi((u) => void (u.meterOut = p))}>
            {OUT_LABEL[p]}
          </Key>
        ))}
      </div>
      <Key small kind="accent" on={ui.peakHold} topic="meters" testid="peak-hold" onClick={() => setUi((u) => void (u.peakHold = !u.peakHold))}>
        PEAK HOLD
      </Key>
    </div>
  );
}
