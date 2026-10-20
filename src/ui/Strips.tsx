import { useStore, type Layer } from '../state/store';
import { Fader, Key, Knob, Meter, GrMeter, useStripSize } from './controls';
import { fmtDb, fmtPan } from '../lib/db';
import { governingBusId, isLinked } from '../engine/routing';
import { pairPartner } from '../model/dm3';

export const IN_TAP = { prehpf: 'in', prefader: 'pre', poston: 'post' } as const;
export const IN_LABEL = { prehpf: 'PRE HPF', prefader: 'PRE FADER', poston: 'POST ON' } as const;
export const OUT_TAP = { preeq: 'in', prefader: 'pre', poston: 'out' } as const;
export const OUT_LABEL = { preeq: 'PRE EQ', prefader: 'PRE FADER', poston: 'POST ON' } as const;

export function ChannelStrip({ id }: { id: string }) {
  const size = useStripSize();
  const meterIn = useStore((s) => s.ui.meterIn);
  const ch = useStore((s) => s.console.channels[id]);
  const def = useStore((s) => s.model.channels.find((c) => c.id === id)!);
  const sofRaw = useStore((s) => s.ui.sof);
  const selected = useStore((s) => s.ui.selected === id);
  const set = useStore((s) => s.set);
  const setUi = useStore((s) => s.setUi);
  const sof = useStore((s) => (s.ui.sof ? governingBusId(s.console, s.ui.sof) : null));
  const sofName = useStore((s) => (sof ? s.console.buses[sof].name : ''));
  const send = sof ? ch.sends[sof] : null;
  const sofLinked = useStore((s) => (sof ? isLinked(s.console, sof) : false));

  const faderVal = send ? send.level : ch.fader;
  const patch = def.kind === 'fxreturn' ? `FX${def.fxRack}` : ch.patchL ? ch.patchL.toUpperCase() : '—';
  return (
    <div className={`strip ${selected ? 'selected' : ''} ${send ? 'sof' : ''} ${size.compact ? 'compact' : ''}`} data-testid={`strip-${id}`}>
      <div className="strip-patch" title="Input patch">
        {patch}
      </div>
      <button
        className="strip-name"
        style={{ borderColor: ch.color }}
        onClick={() => setUi((u) => void ((u.selected = id), ((u.screen = 'channel'), (u.pane = 'screen'))))}
        title="Open channel processing"
      >
        <span className="strip-num">{def.short}</span>
        <span>{ch.name}</span>
      </button>
      <div className="strip-row">
        <Key small on={ch.toSt} onClick={() => set((c) => void (c.channels[id].toSt = !ch.toSt))} topic="st-assign" testid={`st-${id}`} title="ST assign">
          ST
        </Key>
        {send ? (
          <Key
            small
            kind="accent"
            on={send.pre}
            onClick={() => set((c) => void (c.channels[id].sends[sof!].pre = !send.pre))}
            topic="pre-post"
            testid={`sofpre-${id}`}
            title="Send point PRE/POST fader"
          >
            {send.pre ? 'PRE' : 'POST'}
          </Key>
        ) : size.compact ? (
          <Key small on={ch.cue} kind="cue" onClick={() => set((c) => void (c.channels[id].cue = !ch.cue))} topic="cue" testid={`cue-${id}`}>
            CUE
          </Key>
        ) : (
          <GrMeter id={`ch.${id}.gr`} horizontal />
        )}
      </div>
      {size.compact ? null : (
      <Knob
        size={26}
        label={send && sofLinked ? 'SEND PAN' : 'PAN'}
        value={send && sofLinked ? send.pan : ch.pan}
        min={-63}
        max={63}
        step={1}
        reset={0}
        fmt={fmtPan}
        topic="pan"
        onChange={(v) =>
          set((c) => {
            if (send && sofLinked) c.channels[id].sends[sof!].pan = v;
            else c.channels[id].pan = v;
          })
        }
      />
      )}
      {size.compact && !send ? null : (
        <Key on={ch.cue} kind="cue" onClick={() => set((c) => void (c.channels[id].cue = !ch.cue))} topic="cue" testid={size.compact ? undefined : `cue-${id}`}>
          CUE
        </Key>
      )}
      <div className="strip-fader">
        <div className="strip-meters">
          <Meter tap={`ch.${id}.${IN_TAP[meterIn]}`} height={size.meter} label={`Meter: ${IN_LABEL[meterIn]}`} testid={`meter-${id}`} />
        </div>
        <Fader
          value={faderVal}
          height={size.fader}
          color={ch.color}
          accent={send ? '#e3b23c' : undefined}
          topic={send ? 'send-level' : 'channel-fader'}
          testid={`fader-${id}`}
          label={send ? `${ch.name} send to ${sofName}` : `${ch.name} fader`}
          onChange={(db) =>
            set((c) => {
              if (sof) c.channels[id].sends[sof].level = db;
              else c.channels[id].fader = db;
            })
          }
        />
      </div>
      <div className="strip-db" data-testid={`db-${id}`}>
        {send ? <span className="sof-tag">→{sofName}</span> : null}
        {fmtDb(faderVal)}
      </div>
      <Key on={ch.on} kind="on" onClick={() => set((c) => void (c.channels[id].on = !ch.on))} topic="on-key" testid={`on-${id}`} title="ON (lit = live, dark = muted)">
        ON
      </Key>
      {size.compact ? null : (
        <Key on={selected} kind="sel" onClick={() => setUi((u) => void (u.selected = id))} testid={`sel-${id}`} title="Select channel">
          SEL
        </Key>
      )}
      {sofRaw && !send ? <div className="strip-na">no send</div> : null}
    </div>
  );
}

export function BusStrip({ id }: { id: string }) {
  const size = useStripSize();
  const meterOut = useStore((s) => s.ui.meterOut);
  const bus = useStore((s) => s.console.buses[governingBusId(s.console, id)]);
  const own = useStore((s) => s.console.buses[id]);
  const linked = useStore((s) => isLinked(s.console, id));
  const selected = useStore((s) => s.ui.selected === id);
  const set = useStore((s) => s.set);
  const setUi = useStore((s) => s.setUi);
  const gov = useStore((s) => governingBusId(s.console, id));
  const pp = pairPartner(id);
  return (
    <div className={`strip bus ${selected ? 'selected' : ''} ${size.compact ? 'compact' : ''}`} data-testid={`strip-${id}`}>
      <div className="strip-patch">{linked && pp ? `${pp.left.toUpperCase()}/${pp.right.slice(-1)} ST` : 'BUS'}</div>
      <button
        className="strip-name"
        style={{ borderColor: bus.color }}
        onClick={() => setUi((u) => void ((u.selected = gov), ((u.screen = 'channel'), (u.pane = 'screen'))))}
      >
        <span className="strip-num">{id.toUpperCase()}</span>
        <span>{own.name}</span>
      </button>
      <div className="strip-row">
        <GrMeter id={`bus.${gov}.gr`} horizontal />
      </div>
      <Key on={own.cue} kind="cue" onClick={() => set((c) => void (c.buses[id].cue = !own.cue))} topic="cue" testid={`cue-${id}`}>
        CUE
      </Key>
      <div className="strip-fader">
        <div className="strip-meters">
          <Meter tap={`bus.${id}.${OUT_TAP[meterOut]}`} height={size.meter} label={`Meter: ${OUT_LABEL[meterOut]}`} testid={`meter-${id}`} />
        </div>
        <Fader
          value={bus.fader}
          height={size.fader}
          color={bus.color}
          topic="bus-master"
          testid={`fader-${id}`}
          label={`${bus.name} master`}
          onChange={(db) => set((c) => void (c.buses[gov].fader = db))}
        />
      </div>
      <div className="strip-db">{fmtDb(bus.fader)}</div>
      <Key on={bus.on} kind="on" onClick={() => set((c) => void (c.buses[gov].on = !bus.on))} topic="bus-master" testid={`on-${id}`}>
        ON
      </Key>
      <Key on={selected} kind="sel" onClick={() => setUi((u) => void (u.selected = gov))} testid={`sel-${id}`}>
        SEL
      </Key>
    </div>
  );
}

const LAYERS: { id: Layer; label: string }[] = [
  { id: 'all', label: 'ALL INPUTS' },
  { id: '1-8', label: 'CH 1-8' },
  { id: '9-16', label: 'CH 9-16' },
  { id: 'st-fx', label: 'ST IN / FX' },
  { id: 'out', label: 'MIX / MTX' },
];

export function StripBank() {
  const layer = useStore((s) => s.ui.layer);
  const setUi = useStore((s) => s.setUi);
  const model = useStore((s) => s.model);
  let content;
  if (layer === 'out') {
    content = model.buses.filter((b) => b.kind !== 'stereo').map((b) => <BusStrip key={b.id} id={b.id} />);
  } else {
    const ids = model.channels
      .map((c) => c.id)
      .filter((_id, i) =>
        layer === 'all' ? true : layer === '1-8' ? i < 8 : layer === '9-16' ? i >= 8 && i < 16 : i >= 16,
      );
    content = ids.map((id) => <ChannelStrip key={id} id={id} />);
  }
  return (
    <div className="bank">
      <div className="bank-layers" role="tablist" aria-label="Fader layer">
        {LAYERS.map((l) => (
          <button
            key={l.id}
            className={`tab ${layer === l.id ? 'active' : ''}`}
            onClick={() => setUi((u) => void (u.layer = l.id))}
            data-testid={`layer-${l.id}`}
          >
            {l.label}
          </button>
        ))}
      </div>
      <div className="bank-strips">{content}</div>
    </div>
  );
}
