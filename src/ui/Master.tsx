import { useStore } from '../state/store';
import { Fader, Key, Meter, MeterScale, GrMeter, Knob, Select } from './controls';
import { fmtDb } from '../lib/db';
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
        <Key kind="sel" on={false} onClick={() => setUi((u) => void ((u.selected = 'st'), (u.screen = 'channel')))}>
          SEL ST
        </Key>
      </div>

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
