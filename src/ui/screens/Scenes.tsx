import { useRef, useState } from 'react';
import { useStore, FOCUS_CATS, FOCUS_LABELS } from '../../state/store';
import { Key, Section, useTopic } from '../controls';

export function ScenesScreen() {
  const scenes = useStore((s) => s.scenes);
  const model = useStore((s) => s.model);
  const store = useStore();
  const [name, setName] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const setTopic = useTopic();

  const download = (data: unknown, fname: string) => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = fname;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <div className="screen" data-testid="scenes-screen">
      <Section title="SCENE MEMORY">
        <p className="note">
          A scene stores every console parameter: input patch, head-amp gains, processing, faders, ON keys, sends, bus masters, output patch, FX and
          DCA settings. It does not store stage wiring or audio files. Scenes are kept in this browser&apos;s local storage; export them to keep a
          copy.
        </p>
        <div className="row">
          <input
            className="name-edit"
            placeholder={`Scene ${scenes.length + 1}`}
            value={name}
            aria-label="Scene name"
            data-testid="scene-name"
            onChange={(e) => setName(e.target.value)}
          />
          <Key
            kind="on"
            testid="scene-store"
            topic="scene"
            onClick={() => {
              store.storeScene(name);
              setName('');
            }}
          >
            STORE
          </Key>
        </div>
        <table className="io-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Name</th>
              <th>Saved</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {scenes.length === 0 ? (
              <tr>
                <td colSpan={4} className="muted-text">
                  No scenes stored yet.
                </td>
              </tr>
            ) : null}
            {scenes.map((s, i) => (
              <tr key={s.id} data-testid={`scene-${i}`}>
                <td>{String(i + 1).padStart(3, '0')}</td>
                <td>{s.name}</td>
                <td>{new Date(s.savedAt).toLocaleString()}</td>
                <td className="row">
                  <Key small kind="on" testid={`scene-recall-${i}`} topic="scene" onClick={() => store.recallScene(s.id)}>
                    RECALL
                  </Key>
                  {model.features.focus ? (
                  <details className="focus">
                    <summary data-testid={`scene-focus-${i}`}>
                      FOCUS{s.focus && Object.values(s.focus).some((v) => v === false) ? ' *' : ''}
                    </summary>
                    {FOCUS_CATS.map((cat) => (
                      <label key={cat} className="chk">
                        <input
                          type="checkbox"
                          checked={s.focus?.[cat] !== false}
                          data-testid={`focus-${i}-${cat}`}
                          onChange={(e) => {
                            setTopic('focus');
                            store.setSceneFocus(s.id, cat, e.target.checked);
                          }}
                        />
                        {FOCUS_LABELS[cat]}
                      </label>
                    ))}
                  </details>
                  ) : null}
                  <Key small onClick={() => download(s, `${s.name}.dm3sim.json`)}>EXPORT</Key>
                  <Key
                    small
                    kind="warn"
                    onClick={() => {
                      if (confirm(`Delete scene "${s.name}"?`)) store.deleteScene(s.id);
                    }}
                  >
                    DELETE
                  </Key>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="row">
          <Key small onClick={() => download(scenes, 'dm3sim-scenes.json')} disabled={!scenes.length}>
            EXPORT ALL
          </Key>
          <input
            ref={fileRef}
            type="file"
            accept=".json,application/json"
            hidden
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (f) store.flash(store.importScenes(await f.text()));
              e.target.value = '';
            }}
          />
          <Key small onClick={() => fileRef.current?.click()}>
            IMPORT…
          </Key>
        </div>
      </Section>
      <Section title="RECALL SAFE">
        <p className="note">
          Items lit here keep their current settings whenever any scene is recalled (all parameter groups). Recall Safe is a console setting and is
          not stored in scenes.
        </p>
        <div className="safe-grid">
          {model.channels.map((c) => (
            <Key key={c.id} small kind="warn" on={!!store.safe[c.id]} topic="recall-safe" testid={`safe-${c.id}`} onClick={() => store.setSafe(c.id, !store.safe[c.id])}>
              {c.short} {store.console.channels[c.id].name}
            </Key>
          ))}
          {model.buses.map((b) => (
            <Key key={b.id} small kind="warn" on={!!store.safe[b.id]} topic="recall-safe" testid={`safe-${b.id}`} onClick={() => store.setSafe(b.id, !store.safe[b.id])}>
              {store.console.buses[b.id].name}
            </Key>
          ))}
        </div>
      </Section>
      <Section title="CONFIGURATION">
        <div className="row">
          <Key
            kind="warn"
            testid="reset-console"
            onClick={() => {
              setTopic('scene');
              if (confirm('Reset all console settings to the simulator default? (Stored scenes are kept.)')) store.resetConsole();
            }}
          >
            RESET CONSOLE TO DEFAULT
          </Key>
          <Key kind="warn" onClick={() => confirm('Reset stage wiring (what is plugged into each socket)?') && store.resetRig()}>
            RESET STAGE WIRING
          </Key>
          <Key small onClick={() => download(store.console, 'dm3sim-current.json')}>EXPORT CURRENT SETTINGS</Key>
        </div>
        <div className="row">
          <span>Console model:</span>
          <Key small on={model.id === 'DM3'} onClick={() => model.id !== 'DM3' && store.setModel('DM3')}>
            DM3 (Dante 16×16)
          </Key>
          <Key small on={model.id === 'DM3S'} onClick={() => model.id !== 'DM3S' && store.setModel('DM3S')}>
            DM3 Standard (no Dante)
          </Key>
        </div>
        <p className="note">Changing the model reloads the page. Current settings are auto-saved in this browser.</p>
        <ul className="note">
          {model.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      </Section>
    </div>
  );
}
