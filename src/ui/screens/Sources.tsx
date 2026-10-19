import { useRef } from 'react';
import { useStore } from '../../state/store';
import { useRuntime, connectMic, playerAction, playAll, stopAll, loadPlayerFile, startAudio } from '../../state/engine';
import { Key, Knob, Meter, Section, Select } from '../controls';
import { fmtDb, fmtHz } from '../../lib/db';
import type { GeneratorState } from '../../model/types';
import { DEMO_STEMS } from '../../audio/demoStems';

function pluggedInto(dev: string): string[] {
  const { rig, model } = useStore.getState();
  return model.inPorts.filter((p) => rig.plugs[p.id]?.device === dev).map((p) => p.label);
}

export function SourcesScreen() {
  const rig = useStore((s) => s.rig);
  const setRig = useStore((s) => s.setRig);
  const rt = useRuntime();
  const fileRefs = useRef<(HTMLInputElement | null)[]>([]);
  const gen = rig.generator;
  const updGen = (p: Partial<GeneratorState>) => setRig((r) => void Object.assign(r.generator, p));

  return (
    <div className="screen" data-testid="sources-screen">
      {!rt.running ? (
        <div className="alert">
          Audio is off. Press <b>POWER</b> (top bar) to start the audio engine — browsers only allow audio after a click.{' '}
          <Key small kind="on" onClick={() => void startAudio()}>
            POWER ON
          </Key>
        </div>
      ) : null}
      <Section
        title="DEMO BAND & FILE PLAYERS"
        right={
          <div className="row">
            <Key kind="on" testid="play-all" on={rt.players.some((p) => p.playing)} onClick={() => playAll()} disabled={!rt.stemsReady}>
              ▶ PLAY ALL
            </Key>
            <Key testid="stop-all" onClick={() => stopAll()}>
              ■ STOP ALL
            </Key>
          </div>
        }
      >
        <p className="note">
          Eight players behave like playback devices on stage. Players 1–7 are preloaded with a procedurally synthesized demo band (no
          copyrighted audio). Load your own WAV / MP3 / OGG / M4A / FLAC (whatever your browser can decode) into any player. Loaded files stay in
          memory only; reload the page and they must be loaded again. A player is only heard if its cable reaches a socket that is patched
          and routed (see I/O PATCH).
          {!rt.stemsReady && rt.running ? ' Rendering demo stems…' : ''}
        </p>
        <table className="io-table players">
          <thead>
            <tr>
              <th>#</th>
              <th>Source</th>
              <th>Transport</th>
              <th>Loop</th>
              <th>Level</th>
              <th>Output</th>
              <th>Cabled to</th>
            </tr>
          </thead>
          <tbody>
            {rig.players.map((p, i) => {
              const r = rt.players[i];
              return (
                <tr key={i} data-testid={`player-${i + 1}`}>
                  <td>{i + 1}</td>
                  <td>
                    <div className="player-src">
                      <b>{p.name}</b>
                      <Select
                        label={`Player ${i + 1} source`}
                        value={p.source === 'stem' ? `stem:${p.stem}` : p.source}
                        options={[
                          { value: 'none', label: '— empty —' },
                          ...DEMO_STEMS.map((s) => ({ value: `stem:${s.id}`, label: `Demo: ${s.name}` })),
                          ...(p.source === 'file' ? [{ value: 'file', label: `File: ${r?.fileName ?? p.name}` }] : []),
                        ]}
                        onChange={(v) =>
                          setRig((x) => {
                            const pl = x.players[i];
                            if (v === 'none') {
                              pl.source = 'none';
                              pl.name = `Player ${i + 1}`;
                            } else if (v.startsWith('stem:')) {
                              pl.source = 'stem';
                              pl.stem = v.slice(5);
                              pl.name = DEMO_STEMS.find((s) => s.id === pl.stem)?.name ?? v;
                            }
                          })
                        }
                      />
                      <input
                        ref={(el) => void (fileRefs.current[i] = el)}
                        type="file"
                        accept="audio/*,.wav,.mp3,.ogg,.m4a,.flac,.aac"
                        hidden
                        data-testid={`file-${i + 1}`}
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) void loadPlayerFile(i, f);
                          e.target.value = '';
                        }}
                      />
                      <Key small onClick={() => fileRefs.current[i]?.click()}>
                        LOAD FILE…
                      </Key>
                    </div>
                  </td>
                  <td>
                    <div className="row">
                      <Key small kind="on" on={r?.playing} disabled={!r?.duration} testid={`play-${i + 1}`} onClick={() => playerAction(i, r?.playing ? 'pause' : 'play')}>
                        {r?.playing ? '❚❚' : '▶'}
                      </Key>
                      <Key small disabled={!r?.duration} onClick={() => playerAction(i, 'restart')} title="Restart">
                        ⟲
                      </Key>
                      <Key small disabled={!r?.duration} onClick={() => playerAction(i, 'stop')} title="Stop">
                        ■
                      </Key>
                      <small className="mono">
                        {r?.duration ? `${r.position.toFixed(1)} / ${r.duration.toFixed(1)}s` : 'empty'}
                      </small>
                    </div>
                  </td>
                  <td>
                    <Key small on={p.loop} onClick={() => setRig((x) => void (x.players[i].loop = !p.loop))}>
                      LOOP
                    </Key>
                  </td>
                  <td>
                    <Knob size={24} label="" value={p.level} min={-40} max={6} step={0.5} reset={0} fmt={(v) => fmtDb(v)} onChange={(v) => setRig((x) => void (x.players[i].level = v))} />
                  </td>
                  <td>
                    <Meter tap={`dev.p${i + 1}`} height={14} width={110} label="Player output" />
                  </td>
                  <td>
                    <small>{pluggedInto(`p${i + 1}`).join(', ') || 'not plugged in'}</small>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Section>

      <div className="screen-grid">
        <Section title="MICROPHONE">
          <p className="note">
            Connects your computer microphone as a stage mic (default: plugged into INPUT 8 → CH 8 "Mic"). Browser echo cancellation, noise
            suppression and auto-gain are disabled so you hear the raw signal. <b>Use headphones</b>: listening on speakers with a live mic
            can cause real acoustic feedback. Microphone access requires https:// or http://localhost.
          </p>
          <div className="row">
            <Key kind="on" on={rt.mic.status === 'on'} testid="mic-connect" onClick={() => void connectMic()}>
              {rt.mic.status === 'on' ? 'MIC CONNECTED' : rt.mic.status === 'requesting' ? 'REQUESTING…' : 'CONNECT MIC'}
            </Key>
            <Meter tap="dev.mic" height={14} width={140} label="Microphone level (before head amp)" />
            <Knob label="MIC LEVEL" value={rig.micLevel} min={-40} max={0} step={1} reset={-20} fmt={(v) => fmtDb(v, 0)} onChange={(v) => setRig((r) => void (r.micLevel = v))} />
          </div>
          {rt.mic.label ? <p className="note">Device: {rt.mic.label}</p> : null}
          {rt.mic.error ? <div className="alert bad">{rt.mic.error}</div> : null}
          <p className="note">Plugged into: {pluggedInto('mic').join(', ') || 'nothing (plug it in on I/O PATCH)'}</p>
        </Section>

        <Section title="SIGNAL GENERATOR">
          <div className="row">
            <Key kind="on" on={gen.on} testid="gen-on" onClick={() => updGen({ on: !gen.on })}>
              {gen.on ? 'GEN ON' : 'GEN OFF'}
            </Key>
            <Select
              label="Generator type"
              testid="gen-type"
              value={gen.type}
              onChange={(v) => updGen({ type: v as GeneratorState['type'] })}
              options={[
                { value: 'sine', label: 'Sine' },
                { value: 'pink', label: 'Pink noise' },
                { value: 'white', label: 'White noise' },
                { value: 'impulse', label: 'Impulse (1/s)' },
                { value: 'sweep', label: 'Log sweep 20 Hz–20 kHz' },
              ]}
            />
            <Knob label="FREQ" value={gen.freq} min={20} max={20000} log reset={1000} fmt={fmtHz} disabled={gen.type !== 'sine'} testid="gen-freq" onChange={(v) => updGen({ freq: Math.round(v) })} />
            <Knob label="LEVEL" value={gen.level} min={-60} max={0} step={1} reset={-18} fmt={(v) => `${v} dBFS`} testid="gen-level" onChange={(v) => updGen({ level: v })} />
            <Meter tap="dev.gen" height={14} width={110} label="Generator output" />
          </div>
          <p className="note">Plugged into: {pluggedInto('gen').join(', ') || 'nothing'} (default INPUT 16 → CH 16 "Gen").</p>
        </Section>
      </div>
    </div>
  );
}
