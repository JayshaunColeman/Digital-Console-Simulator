// Owns the AudioEngine instance and the small "runtime" store for things that
// only exist while audio is running (player transport, microphone status).

import { create } from 'zustand';
import { AudioEngine } from '../engine/AudioEngine';
import type { PlayerRuntime } from '../engine/devices';
import { getState, useStore } from './store';

interface Runtime {
  running: boolean;
  starting: boolean;
  error: string;
  sampleRate: number;
  players: PlayerRuntime[];
  mic: { status: string; error: string; label: string };
  stemsReady: boolean;
}

export const useRuntime = create<Runtime>(() => ({
  running: false,
  starting: false,
  error: '',
  sampleRate: 0,
  players: [],
  mic: { status: 'off', error: '', label: '' },
  stemsReady: false,
}));

let engine: AudioEngine | null = null;
export const getEngine = () => engine;

function snapshot() {
  if (!engine) return;
  useRuntime.setState({
    players: engine.players.map((p) => p.runtime()),
    mic: { status: engine.mic.status, error: engine.mic.error, label: engine.mic.label },
  });
}

export async function startAudio(): Promise<void> {
  if (engine) {
    await engine.resume();
    useRuntime.setState({ running: engine.ctx.state === 'running' });
    return;
  }
  if (typeof AudioContext === 'undefined') {
    useRuntime.setState({ error: 'This browser does not support the Web Audio API. Use a current Chrome, Edge, Firefox or Safari.' });
    return;
  }
  useRuntime.setState({ starting: true, error: '' });
  // iOS Safari mutes Web Audio when the silent switch is on unless the audio
  // session is declared as playback (Safari 16.4+)
  const nav = navigator as Navigator & { audioSession?: { type: string } };
  if (nav.audioSession) nav.audioSession.type = 'playback';
  try {
    const s = getState();
    engine = new AudioEngine(s.model);
    engine.sync(s.console, s.rig);
    await engine.resume();
    await engine.loadWorklets();
    useStore.subscribe((st, prev) => {
      if (st.console !== prev.console || st.rig !== prev.rig) {
        engine!.sync(st.console, st.rig);
        if (st.rig.players !== prev.rig.players) engine!.assignPlayerBuffers(st.rig);
      }
    });
    engine.ctx.onstatechange = () => useRuntime.setState({ running: engine!.ctx.state === 'running' });
    // phones suspend / interrupt audio when the tab is backgrounded or a call comes in
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && engine && engine.ctx.state !== 'running') void engine.resume().catch(() => undefined);
    });
    setInterval(snapshot, 250);
    useRuntime.setState({ running: engine.ctx.state === 'running', sampleRate: engine.ctx.sampleRate });
    (window as unknown as { __dm3: unknown }).__dm3 = { engine, store: useStore, runtime: useRuntime };
    await engine.loadStems();
    engine.assignPlayerBuffers(getState().rig);
    const restored = await engine.restoreFiles(getState().rig);
    if (restored.length) getState().flash(`Restored ${restored.length} saved audio file(s): ${restored.join(', ')}`);
    useRuntime.setState({ stemsReady: true });
  } catch (e) {
    useRuntime.setState({ error: `Audio engine failed to start: ${(e as Error).message}` });
  } finally {
    useRuntime.setState({ starting: false });
    snapshot();
  }
}

export async function connectMic(deviceId?: string) {
  if (!engine) await startAudio();
  if (!engine) return;
  await engine.mic.connect(deviceId);
  snapshot();
}

export function playerAction(i: number, a: 'play' | 'pause' | 'stop' | 'restart') {
  const p = engine?.players[i];
  if (!p) return;
  if (a === 'play') p.play();
  else if (a === 'pause') p.pause();
  else if (a === 'stop') p.stop();
  else p.restart();
  snapshot();
}

export function playAll() {
  engine?.playAll();
  snapshot();
}

export function stopAll() {
  engine?.stopAll();
  snapshot();
}

export async function loadPlayerFile(i: number, file: File) {
  if (!engine) await startAudio();
  if (!engine) return;
  try {
    await engine.loadFile(i, file);
    getState().setRig((r) => {
      r.players[i].source = 'file';
      r.players[i].name = file.name.replace(/\.[^.]+$/, '');
      delete r.players[i].stem;
    });
    getState().flash(`Loaded "${file.name}" into Player ${i + 1}.`);
  } catch (e) {
    getState().flash((e as Error).message);
  }
  snapshot();
}
