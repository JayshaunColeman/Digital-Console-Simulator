// Acceptance tests A-G (+ extras) executed in headless Chromium against the
// built app. Every level assertion is read from the live Web Audio analysers
// (window.__dm3.engine.measure), i.e. from real processed audio.
//
// Usage: npm run build && npm run test:e2e
// (starts `vite preview` itself unless SIM_URL is set)

import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { launch, peak, powerAndPlay, st, URL } from './helpers.mjs';

let server = null;
async function up() {
  try {
    await fetch(URL);
    return;
  } catch {
    /* start one */
  }
  server = spawn('npx', ['vite', 'preview', '--port', '4173', '--strictPort'], { stdio: 'ignore' });
  for (let i = 0; i < 50; i++) {
    try {
      await fetch(URL);
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  throw new Error('preview server did not start');
}

const results = [];
let cur = null;
function test(name) {
  cur = { name, checks: [], ok: true };
  results.push(cur);
  console.log(`\n== ${name}`);
}
function check(label, cond, info = '') {
  cur.checks.push({ label, ok: !!cond, info });
  if (!cond) cur.ok = false;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${info ? `  (${info})` : ''}`);
}
const f = (v) => `${v.toFixed(1)} dB`;
const SIG = -60; // "signal present" threshold (dBFS)
const SIL = -100; // "silent" threshold

await up();
const { browser, page, errors } = await launch();
const S = (fn, arg) => page.evaluate(fn, arg); // run in page
const setC = (code) => S((c) => window.__dm3.store.getState().set(new Function('c', c)), code);

await powerAndPlay(page);
// isolate the vocal player: stop all, play only player 1
await page.getByTestId('stop-all').click();
await page.getByTestId('play-1').click();
await page.waitForTimeout(400);

// ---------------------------------------------------------------- TEST A
test('TEST A: Main mix');
await page.getByTestId('tab-overview').click();
// start with Input 1 NOT routed to stereo
await page.getByTestId('st-ch1').click();
check('Input 1 (port) shows signal', (await peak(page, 'port.in1')) > SIG, f(await peak(page, 'port.in1')));
check('Channel 1 input meter shows signal', (await peak(page, 'ch.ch1.in')) > SIG, f(await peak(page, 'ch.ch1.in')));
check('ST assign off -> STEREO bus silent', (await peak(page, 'bus.st.out')) < SIL, f(await peak(page, 'bus.st.out')));
await page.getByTestId('st-ch1').click(); // route to Stereo L/R
let stOut = await peak(page, 'bus.st.out', 800);
check('ST assign on -> STEREO master meter responds', stOut > SIG, f(stOut));
check('Audio reaches OMNI OUT 7 (FOH PA L)', (await peak(page, 'out.omni7')) > SIG, f(await peak(page, 'out.omni7')));
check('Audio reaches the browser output', (await peak(page, 'listen')) > SIG, f(await peak(page, 'listen')));
await page.getByTestId('on-ch1').click(); // mute
check('Muted: channel PRE meter still shows input', (await peak(page, 'ch.ch1.pre')) > SIG, f(await peak(page, 'ch.ch1.pre')));
check('Muted: POST-fader meter silent', (await peak(page, 'ch.ch1.post')) < SIL, f(await peak(page, 'ch.ch1.post')));
check('Muted: STEREO bus silent', (await peak(page, 'bus.st.out')) < SIL, f(await peak(page, 'bus.st.out')));
check('Muted: OMNI 7 and browser output silent', (await peak(page, 'out.omni7')) < SIL && (await peak(page, 'listen')) < SIL);
await page.getByTestId('on-ch1').click(); // unmute

// ---------------------------------------------------------------- TEST B
test('TEST B: Monitor mix');
// steady 1 kHz test tone cabled into INPUT 1 so level changes can be measured exactly
await page.getByTestId('tab-sources').click();
await page.getByTestId('gen-on').click();
await page.getByTestId('tab-io').click();
await page.getByTestId('plug-in1').selectOption('gen');
await page.getByTestId('st-ch1').click(); // disable direct routing to ST
await page.getByTestId('tab-routing').click();
await page.getByTestId('cell-ch1-mix1').click(); // send at -inf jumps to 0 dB, ON
let c = await st(page);
check('Send ch1 -> MIX 1 is ON at 0 dB, PRE', c.channels.ch1.sends.mix1.on && c.channels.ch1.sends.mix1.level === 0 && c.channels.ch1.sends.mix1.pre);
check('STEREO bus silent (ch1 not assigned to ST)', (await peak(page, 'bus.st.out')) < SIL, f(await peak(page, 'bus.st.out')));
const mixA = await peak(page, 'bus.mix1.out', 1200);
check('MIX 1 bus meter responds', mixA > SIG, f(mixA));
check('MIX 1 reaches OMNI OUT 1 (default patch)', (await peak(page, 'out.omni1')) > SIG, f(await peak(page, 'out.omni1')));
// listen to wedge 1
await page.getByTestId('listen-l').selectOption('omni1');
await page.getByTestId('listen-r').selectOption('omni1');
check('Browser hears Wedge 1 (OMNI 1)', (await peak(page, 'listen')) > SIG, f(await peak(page, 'listen')));
// change the send level to -20 dB (generator-free: compare against identical window lengths)
await page.getByTestId('sel-ch1').click();
await page.getByTestId('tab-channel').click();
await page.getByTestId('send-level-mix1').fill('-20');
c = await st(page);
const mixB = await peak(page, 'bus.mix1.out', 1200);
check('Send level set to -20 dB via the send control', c.channels.ch1.sends.mix1.level === -20);
check('MIX 1 level dropped accordingly (~20 dB)', Math.abs(mixA - mixB - 20) < 1, `${f(mixA)} -> ${f(mixB)}`);
await page.getByTestId('send-level-mix1').fill('0');
await page.getByTestId('layer-out').click();
await page.getByTestId('on-mix1').click(); // mute bus master
check('Bus master muted: MIX 1 output silent', (await peak(page, 'bus.mix1.out')) < SIL, f(await peak(page, 'bus.mix1.out')));
check('Bus master muted: OMNI 1 and browser silent', (await peak(page, 'out.omni1')) < SIL && (await peak(page, 'listen')) < SIL);
check('Bus input (sum of sends) still has signal', (await peak(page, 'bus.mix1.in')) > SIG, f(await peak(page, 'bus.mix1.in')));
await page.getByTestId('on-mix1').click();

// ---------------------------------------------------------------- TEST C
test('TEST C: Output patching');
await page.getByTestId('tab-io').click();
await page.getByTestId('outpatch-omni1').selectOption('');
check('Unpatched: MIX 1 still shows signal', (await peak(page, 'bus.mix1.out')) > SIG, f(await peak(page, 'bus.mix1.out')));
check('Unpatched: OMNI 1 silent', (await peak(page, 'out.omni1')) < SIL, f(await peak(page, 'out.omni1')));
check('Unpatched: browser (listening at OMNI 1) silent', (await peak(page, 'listen')) < SIL, f(await peak(page, 'listen')));
check('UI marks OMNI 1 UNPATCHED', (await page.getByTestId('outrow-omni1').innerText()).includes('UNPATCHED'));
await page.getByTestId('outpatch-omni1').selectOption('mix1');
check('Patch restored: OMNI 1 has signal again', (await peak(page, 'out.omni1')) > SIG, f(await peak(page, 'out.omni1')));
check('Patch restored: browser hears it again', (await peak(page, 'listen')) > SIG, f(await peak(page, 'listen')));
const fxOpt = await page.locator('[data-testid="outpatch-omni1"] option[value="fxrtn1"]').isDisabled();
check('Incompatible source (FX RETURN) is listed but not selectable', fxOpt);

// ---------------------------------------------------------------- TEST D
test('TEST D: Sends on Fader');
await page.getByTestId('layer-all').click();
const faderBefore = (await st(page)).channels.ch1.fader;
await page.getByTestId('sof-toggle').click();
await page.getByTestId('sof-mix1').click();
check('SOF shows selected bus', (await page.getByTestId('sof-master').innerText()).includes('MIX 1'));
const sofA = await peak(page, 'bus.mix1.out', 1200);
const fader = page.getByTestId('fader-ch1');
await fader.focus();
for (let i = 0; i < 12; i++) await page.keyboard.press('ArrowDown'); // -12 dB on the send
c = await st(page);
const sofB = await peak(page, 'bus.mix1.out', 1200);
check('Channel fader moved the MIX 1 send (0 -> -12 dB)', c.channels.ch1.sends.mix1.level === -12, `send=${c.channels.ch1.sends.mix1.level}`);
check('Channel fader level itself unchanged in SOF', c.channels.ch1.fader === faderBefore);
check('MIX 1 bus level followed (~12 dB lower)', Math.abs(sofA - sofB - 12) < 1, `${f(sofA)} -> ${f(sofB)}`);
await page.getByTestId('sof-mix2').click();
check('Switching bus: fader now shows MIX 2 send (-inf)', (await page.getByTestId('db-ch1').innerText()).includes('-∞'));
await page.getByTestId('sof-toggle').click(); // back to normal
await page.getByTestId('st-ch1').click(); // put ch1 back into ST for this check
await fader.focus();
const stBefore = await peak(page, 'ch.ch1.post', 1200);
for (let i = 0; i < 10; i++) await page.keyboard.press('ArrowDown');
c = await st(page);
const stAfter = await peak(page, 'ch.ch1.post', 1200);
check('Normal mode: fader again controls channel level', Math.abs(c.channels.ch1.fader - (faderBefore - 10)) < 0.01, `fader=${c.channels.ch1.fader}`);
check('Normal mode: MIX 1 send untouched (-12 dB)', c.channels.ch1.sends.mix1.level === -12);
check('POST-fader meter dropped ~10 dB', Math.abs(stBefore - stAfter - 10) < 1, `${f(stBefore)} -> ${f(stAfter)}`);

await page.getByTestId('tab-io').click();
await page.getByTestId('plug-in1').selectOption('p1');
await page.getByTestId('tab-sources').click();
await page.getByTestId('gen-on').click();

// ---------------------------------------------------------------- TEST E
test('TEST E: Processing (EQ / HPF / compressor / meter points)');
// steady sine from the generator on CH 16 makes the measurements exact
await page.getByTestId('tab-sources').click();
await page.getByTestId('gen-on').click();
await setC(`c.channels.ch16.fader = -10; c.channels.ch16.toSt = true;`);
await page.waitForTimeout(400);
const genIn = await peak(page, 'ch.ch16.in');
const genPre = await peak(page, 'ch.ch16.pre');
const genPost = await peak(page, 'ch.ch16.post');
check('1 kHz sine at -18 dBFS arrives on CH 16', Math.abs(genIn + 18) < 0.6, f(genIn));
check('POST meter = PRE meter - 10 dB fader', Math.abs(genPre - genPost - 10) < 0.6, `${f(genPre)} / ${f(genPost)}`);
// EQ: LO-MID band to 1 kHz +12 dB
await page.getByTestId('sel-ch16').click();
await page.getByTestId('tab-channel').click();
await setC(`Object.assign(c.channels.ch16.eq[1], { freq: 1000, gain: 12, q: 2 });`);
await page.waitForTimeout(300);
const eqUp = await peak(page, 'ch.ch16.pre');
check('EQ +12 dB at 1 kHz raises the 1 kHz tone by ~12 dB', Math.abs(eqUp - genPre - 12) < 1, `${f(genPre)} -> ${f(eqUp)}`);
await page.getByTestId('eq-on').click(); // EQ OFF (bypass)
await page.waitForTimeout(300);
check('EQ OFF bypasses it', Math.abs((await peak(page, 'ch.ch16.pre')) - genPre) < 0.6);
// HPF on a 100 Hz tone
await setC(`c.channels.ch16.hpfFreq = 400;`);
await page.getByTestId('tab-sources').click();
await S(() => window.__dm3.store.getState().setRig((r) => void (r.generator.freq = 100)));
await page.getByTestId('tab-channel').click();
await page.waitForTimeout(300);
const lowA = await peak(page, 'ch.ch16.pre');
await page.getByTestId('hpf-on').click();
await page.waitForTimeout(400);
const lowB = await peak(page, 'ch.ch16.pre');
check('HPF @400 Hz attenuates a 100 Hz tone strongly (> 18 dB)', lowA - lowB > 18, `${f(lowA)} -> ${f(lowB)}`);
await page.getByTestId('hpf-on').click();
await S(() => window.__dm3.store.getState().setRig((r) => void (r.generator.freq = 1000)));
// compressor: threshold above signal -> no change (verifies auto make-up removal)
await setC(`Object.assign(c.channels.ch16.comp, { on: true, threshold: -6, ratio: 4, knee: 0, makeup: 0, attack: 5, release: 100 });`);
await page.waitForTimeout(600);
const cmpNo = await peak(page, 'ch.ch16.pre');
check('Comp ON, signal below threshold: level unchanged (no hidden make-up gain)', Math.abs(cmpNo - genPre) < 0.6, `${f(genPre)} -> ${f(cmpNo)}`);
await setC(`Object.assign(c.channels.ch16.comp, { threshold: -30, ratio: 4 });`);
await page.waitForTimeout(900);
const cmpYes = await peak(page, 'ch.ch16.pre');
const gr = await S(() => window.__dm3.engine.meters.grNow('ch.ch16.gr'));
// static curve: -18 in, -30 thr, 4:1 -> -27 out -> 9 dB reduction
check('Comp threshold -30 / 4:1 on -18 dBFS tone: ~9 dB gain reduction', gr < -6 && gr > -12, `GR ${gr.toFixed(1)} dB`);
check('Output level reduced accordingly', genPre - cmpYes > 6 && genPre - cmpYes < 12, `${f(genPre)} -> ${f(cmpYes)}`);
check('GR meter element present on the screen', (await page.locator('[data-gr="ch.ch16.gr"]').count()) > 0);
await setC(`c.channels.ch16.comp.makeup = 6;`);
await page.waitForTimeout(500);
const cmpMk = await peak(page, 'ch.ch16.pre');
check('MAKEUP +6 dB raises output by 6 dB', Math.abs(cmpMk - cmpYes - 6) < 1, `${f(cmpYes)} -> ${f(cmpMk)}`);
// polarity: inverting one of two identical signals summed cancels them
await setC(`c.channels.ch16.comp.on = false; c.channels.ch16.eqOn = true; c.channels.ch16.eq[1].gain = 0;`);
// vocal compression responds to programme material
await setC(`Object.assign(c.channels.ch1.comp, { on: true, threshold: -30, ratio: 6, knee: 2, makeup: 0 });`);
let grMin = 0;
for (let i = 0; i < 20; i++) {
  grMin = Math.min(grMin, await S(() => window.__dm3.engine.meters.grNow('ch.ch1.gr')));
  await page.waitForTimeout(50);
}
check('Compressor GR responds to the vocal programme', grMin < -3, `max GR ${grMin.toFixed(1)} dB`);
await setC(`c.channels.ch1.comp.on = false;`);
await page.getByTestId('tab-sources').click();
await page.getByTestId('gen-on').click();
await setC(`c.channels.ch16.fader = -140;`);

// ---------------------------------------------------------------- TEST F
test('TEST F: Independent mixes');
await page.getByTestId('gen-on').click();
await setC(`
  const g = c.channels.ch16; g.fader = 0; g.toSt = true; g.on = true;
  g.sends.mix1 = { on: true, level: -6, pre: true, pan: 0 };
  c.channels.ch1.on = false; c.channels.ch1.sends.mix1.level = -140;
`);
await page.waitForTimeout(400);
const fSt1 = await peak(page, 'bus.st.out');
const fMx1 = await peak(page, 'bus.mix1.out');
await setC(`c.channels.ch16.sends.mix1.level = -26;`); // change monitor mix
await page.waitForTimeout(400);
const fSt2 = await peak(page, 'bus.st.out');
const fMx2 = await peak(page, 'bus.mix1.out');
check('Monitor send -20 dB: MIX 1 drops ~20 dB', Math.abs(fMx1 - fMx2 - 20) < 1, `${f(fMx1)} -> ${f(fMx2)}`);
check('...and the main STEREO mix is unchanged', Math.abs(fSt1 - fSt2) < 0.5, `${f(fSt1)} -> ${f(fSt2)}`);
await setC(`c.channels.ch16.fader = -10;`); // change main mix
await page.waitForTimeout(400);
const fSt3 = await peak(page, 'bus.st.out');
const fMx3 = await peak(page, 'bus.mix1.out');
check('Main fader -10 dB: STEREO drops ~10 dB', Math.abs(fSt2 - fSt3 - 10) < 1, `${f(fSt2)} -> ${f(fSt3)}`);
check('...and the PRE-fader monitor mix is unchanged', Math.abs(fMx2 - fMx3) < 0.5, `${f(fMx2)} -> ${f(fMx3)}`);
await setC(`c.channels.ch16.sends.mix1.pre = false;`);
await page.waitForTimeout(400);
const fMx4 = await peak(page, 'bus.mix1.out');
check('Switching the send to POST makes the monitor follow the fader (-10 dB)', Math.abs(fMx3 - fMx4 - 10) < 1, `${f(fMx3)} -> ${f(fMx4)}`);
await page.getByTestId('gen-on').click();

// ---------------------------------------------------------------- TEST G
test('TEST G: Save and restore');
await setC(`c.channels.ch1.on = true; c.channels.ch1.toSt = true; c.channels.ch1.fader = -7; c.channels.ch1.sends.mix1.level = -3;`);
await page.getByTestId('tab-scenes').click();
await page.getByTestId('scene-name').fill('Acceptance G');
await page.getByTestId('scene-store').click();
const saved = await st(page);
await page.getByTestId('tab-overview').click();
await page.getByTestId('st-ch1').click();
await page.getByTestId('on-ch1').click();
await setC(`c.channels.ch1.fader = -40; c.outPorts.omni1.source = 'mix2'; c.buses.mix1.on = false;`);
const changed = await st(page);
check('Settings changed after storing', JSON.stringify(changed) !== JSON.stringify(saved));
await page.getByTestId('tab-scenes').click();
await page.getByTestId('scene-recall-0').click();
const restored = await st(page);
check('Recall restores the exact stored configuration', JSON.stringify(restored) === JSON.stringify(saved));
await page.waitForTimeout(500);
check('Restored routing carries audio again (OMNI 1 has the vocal)', (await peak(page, 'out.omni1', 1200)) > SIG, f(await peak(page, 'out.omni1')));
await page.reload();
await page.waitForTimeout(500);
const persisted = await page.evaluate(() => window.localStorage.getItem('dm3sim.scenes.v1'));
check('Scene persisted in local storage across reload', persisted && persisted.includes('Acceptance G'));

// ---------------------------------------------------------------- EXTRA
test('EXTRA: Loop detection, troubleshooting scenario, signal flow');
await powerAndPlay(page);
await page.getByTestId('tab-io').click();
await page.getByTestId('plug-in12').selectOption('loop:omni4');
await setC(`c.channels.ch12.sends.mix4 = { on: true, level: 0, pre: true, pan: 0 };`);
await page.waitForTimeout(300);
check('Feedback loop flagged in UI', await page.getByTestId('loop-warning').isVisible());
await page.getByTestId('plug-in12').selectOption('');
await page.waitForTimeout(200);
check('Loop warning clears when the cable is removed', (await page.getByTestId('loop-warning').count()) === 0);
await page.getByTestId('tab-training').click();
const firstStart = page.locator('[data-testid^="start-"]').first();
await firstStart.click();
await page.waitForTimeout(1500);
check('Scenario starts with fault present (Not fixed)', (await page.getByTestId('scenario-status').innerText()).includes('Not fixed'));
await page.getByTestId('hint').click();
check('Hint system reveals a hint', (await page.locator('.hint-box').count()) > 0);
await page.getByTestId('reveal-path').click();
check('Reveal path shows the path analysis', await page.getByTestId('path-box').isVisible());
await page.getByTestId('tab-flow').click();
await page.getByTestId('flow-select').selectOption('ch1');
check('Signal-flow view renders a verdict', (await page.getByTestId('flow-verdict').innerText()).length > 10);

// ---------------------------------------------------------------- FEATURES
// Each test uses the steady 1 kHz generator on CH 16 (or a stated source) and
// reads levels from the live analysers.
const reset = async () => {
  await S(() => {
    const st = window.__dm3.store.getState();
    st.resetConsole();
    st.resetRig();
    window.__dm3.engine.stopAll();
    st.setRig((r) => void Object.assign(r.generator, { on: true, type: 'sine', freq: 1000, level: -18 }));
  });
  await setC(`c.channels.ch16.fader = 0;`);
  await page.waitForTimeout(300);
};
const setR = (code) => S((c) => window.__dm3.store.getState().setRig(new Function('r', c)), code);

test('TEST H: Dynamics 1 gate / ducker');
await reset();
await page.getByTestId('sel-ch16').click();
await page.getByTestId('tab-channel').click();
const gBase = await peak(page, 'ch.ch16.pre');
await setC(`Object.assign(c.channels.ch16.gate, { threshold: -10, range: -60, attack: 1, hold: 10, decay: 50 });`);
await page.getByTestId('gate-on').click();
await page.waitForTimeout(600);
const gClosed = await peak(page, 'ch.ch16.pre');
const gGr = await S(() => window.__dm3.engine.meters.grNow('ch.ch16.gate'));
check('Gate closed (tone -18 dBFS < threshold -10): attenuated by ~60 dB', gBase - gClosed > 50, `${f(gBase)} -> ${f(gClosed)}`);
check('Gate attenuation meter shows the reduction', gGr < -40, `${gGr.toFixed(1)} dB`);
await setC(`c.channels.ch16.gate.threshold = -30;`);
await page.waitForTimeout(500);
const gOpen = await peak(page, 'ch.ch16.pre');
check('Gate open (tone above threshold -30): level restored', Math.abs(gOpen - gBase) < 0.6, f(gOpen));
// ducker keyed by CH 1 (vocal player)
await page.getByTestId('gate-mode-ducker').click();
await setC(`Object.assign(c.channels.ch16.gate, { threshold: -40, range: -12, key: 'ch1', attack: 1, hold: 20, decay: 100 });`);
await page.waitForTimeout(300);
const dQuiet = await peak(page, 'ch.ch16.pre');
check('Ducker: no key signal -> no ducking', Math.abs(dQuiet - gBase) < 0.6, f(dQuiet));
await page.getByTestId('tab-sources').click();
await page.getByTestId('play-1').click();
let dMin = 0;
for (let i = 0; i < 40; i++) {
  dMin = Math.min(dMin, await S(() => window.__dm3.engine.meters.grNow('ch.ch16.gate')));
  await page.waitForTimeout(50);
}
check('Ducker: vocal on CH 1 (key in) ducks CH 16 by ~12 dB', dMin < -10 && dMin > -14, `GR ${dMin.toFixed(1)} dB`);
await page.getByTestId('play-1').click();

test('TEST I: Input / output delay, GEQ, matrix sends');
await reset();
// input delay measured with the impulse generator: time between IN and PRE taps
await setR(`r.generator.type = 'impulse'; r.generator.level = -6;`);
await setC(`c.channels.ch16.delayOn = true; c.channels.ch16.delayMs = 500;`);
await page.waitForTimeout(1200);
const lag = await S(async () => {
  const m = window.__dm3.engine.meters;
  let tIn = -1, tPre = -1;
  const t0 = performance.now();
  while (performance.now() - t0 < 2500) {
    const now = performance.now() - t0;
    if (tIn < 0 && m.peakNow('ch.ch16.in') > -20) tIn = now;
    if (tIn >= 0 && tPre < 0 && now - tIn > 60 && m.peakNow('ch.ch16.pre') > -20) tPre = now;
    if (tIn >= 0 && tPre >= 0) break;
    await new Promise((r) => setTimeout(r, 4));
  }
  return tPre - tIn;
});
check('Input delay 500 ms: impulse appears ~500 ms later after the delay', Math.abs(lag - 500) < 60, `${lag.toFixed(0)} ms`);
await setR(`r.generator.type = 'sine'; r.generator.level = -18;`);
await setC(`c.channels.ch16.delayOn = false; c.channels.ch16.sends.mix1 = { on: true, level: 0, pre: true, pan: 0 };`);
await page.waitForTimeout(400);
const qA = await peak(page, 'bus.mix1.out');
await setC(`c.buses.mix1.geqOn = true; c.buses.mix1.geq[17] = -12;`);
await page.waitForTimeout(400);
const qB = await peak(page, 'bus.mix1.out');
check('GEQ 1 kHz band -12 dB on MIX 1 cuts the 1 kHz tone ~12 dB', Math.abs(qA - qB - 12) < 1.5, `${f(qA)} -> ${f(qB)}`);
await setC(`c.buses.mix1.geq[5] = -12; c.buses.mix1.geq[17] = 0;`);
await page.waitForTimeout(400);
const qC = await peak(page, 'bus.mix1.out');
check('A distant GEQ band (63 Hz) leaves the 1 kHz tone alone', Math.abs(qA - qC) < 0.6, f(qC));
await setC(`c.channels.ch16.sends.mtx1 = { on: true, level: 0, pre: false, pan: 0 }; c.outPorts.omni5.source = 'mtx1';`);
await page.waitForTimeout(400);
check('Input channel -> MATRIX 1 send reaches the matrix', (await peak(page, 'bus.mtx1.in')) > SIG, f(await peak(page, 'bus.mtx1.in')));
check('MATRIX 1 patched to OMNI 5 carries it out', (await peak(page, 'out.omni5')) > SIG, f(await peak(page, 'out.omni5')));

test('TEST J: Mute groups, phantom power, device types');
await reset();
await setC(`c.channels.ch16.muteGroups = [1];`);
const mA = await peak(page, 'ch.ch16.post');
await page.getByTestId('mg-1').click();
check('Mute group 1 engaged: member CH 16 silent post-fader', (await peak(page, 'ch.ch16.post')) < SIL, `${f(mA)} -> ${f(await peak(page, 'ch.ch16.post'))}`);
check('...pre-fader still shows the input', (await peak(page, 'ch.ch16.pre')) > SIG);
await page.getByTestId('mg-1').click();
check('Mute group released: signal back', (await peak(page, 'ch.ch16.post')) > SIG);
await setC(`c.buses.mix2.muteGroups = [2]; c.channels.ch16.sends.mix2 = { on: true, level: 0, pre: true, pan: 0 };`);
await page.getByTestId('mg-2').click();
check('Mute group on a bus mutes its master', (await peak(page, 'bus.mix2.out')) < SIL && (await peak(page, 'bus.mix2.in')) > SIG);
await page.getByTestId('mg-2').click();
// phantom power: generator behaves as a condenser mic on INPUT 16
await setR(`r.kinds.gen = 'condenser';`);
check('Condenser device without +48V: INPUT 16 silent', (await peak(page, 'port.in16')) < SIL, f(await peak(page, 'port.in16')));
await page.getByTestId('tab-io').click();
check('I/O PATCH flags "NO 48V"', (await page.getByTestId('inrow-in16').innerText()).includes('NO 48V'));
await page.getByTestId('io-phantom-in16').click();
const ph = await peak(page, 'port.in16');
check('+48V on: condenser signal arrives at mic level (~24 dB below line)', Math.abs(ph - (-18 - 24)) < 1, f(ph));
await setR(`r.kinds.gen = 'dynamic';`);
const dy = await peak(page, 'port.in16');
check('Dynamic mic type: ~30 dB below line level', Math.abs(dy - (-18 - 30)) < 1, f(dy));

test('TEST K: Talkback and oscillator');
await reset();
await setC(`c.talkback = { on: false, source: 'in16', level: 0, assign: ['mix2'] }; c.osc = { on: false, type: 'pink', freq: 1000, level: -20, assign: ['mix3'] };`);
check('Talkback off: MIX 2 silent', (await peak(page, 'bus.mix2.in')) < SIL);
await page.getByTestId('tb-on').click();
const tbl = await peak(page, 'bus.mix2.in');
check('Talkback on: source reaches assigned MIX 2 (bypassing the channel)', Math.abs(tbl + 18) < 1, f(tbl));
check('...and not the unassigned MIX 4', (await peak(page, 'bus.mix4.in')) < SIL);
await page.getByTestId('tb-on').click();
await page.getByTestId('osc-on').click();
const os = await peak(page, 'bus.mix3.in', 800);
check('Oscillator pink noise reaches assigned MIX 3', os > -40 && os < -10, f(os));
await page.getByTestId('osc-on').click();
check('Oscillator off: MIX 3 silent', (await peak(page, 'bus.mix3.in')) < SIL);

test('TEST L: Scene Focus and Recall Safe');
await reset();
await setC(`c.channels.ch16.fader = -5; c.channels.ch1.fader = -5; c.outPorts.omni3.source = 'mix3';`);
await page.getByTestId('tab-scenes').click();
await page.getByTestId('scene-name').fill('Focus test');
await page.getByTestId('scene-store').click();
const idx = (await S(() => window.__dm3.store.getState().scenes.length)) - 1;
await setC(`c.channels.ch16.fader = -30; c.channels.ch1.fader = -30; c.outPorts.omni3.source = null;`);
await page.getByTestId(`scene-focus-${idx}`).click();
await page.getByTestId(`focus-${idx}-outpatch`).uncheck();
await page.getByTestId('safe-ch1').click();
await page.getByTestId(`scene-recall-${idx}`).click();
let cs = await st(page);
check('Recall with Focus (output patch excluded): faders recalled', cs.channels.ch16.fader === -5);
check('...output patch left as it was (OMNI 3 still unpatched)', cs.outPorts.omni3.source === null);
check('Recall Safe CH 1 kept its current fader (-30)', cs.channels.ch1.fader === -30);
await page.getByTestId('safe-ch1').click();

test('TEST M: Effect library');
await reset();
await setC(`c.channels.ch16.sends.fx1 = { on: true, level: 0, pre: false, pan: 0 };`);
const types = ['reverb-hall', 'reverb-room', 'reverb-plate', 'early-ref', 'delay-stereo', 'delay-mono', 'chorus', 'flanger', 'phaser', 'tremolo'];
const fxRes = [];
for (const t of types) {
  await setC(`c.fx[0].type = '${t}';`);
  await page.waitForTimeout(500);
  const v = await peak(page, 'fx.1.out', 700);
  fxRes.push(`${t} ${v.toFixed(0)}`);
  check(`FX type ${t}: produces output, no overload`, v > -60 && v < 0, f(v));
}

test('TEST N: Saved-state migration from the previous version');
await page.waitForTimeout(700); // let the debounced autosave flush first
await page.evaluate(() => {
  const s = JSON.parse(localStorage.getItem('dm3sim.console.v1'));
  s.version = 1;
  for (const ch of Object.values(s.channels)) {
    delete ch.gate; delete ch.delayOn; delete ch.delayMs; delete ch.muteGroups; delete ch.sends.mtx1; delete ch.sends.mtx2;
    ch.fader = -7.5;
  }
  delete s.muteGroups; delete s.talkback; delete s.osc;
  for (const p of Object.values(s.ports)) delete p.phantom;
  localStorage.setItem('dm3sim.console.v1', JSON.stringify(s));
});
await page.reload();
await page.getByTestId('power').click();
await page.waitForFunction(() => !!window.__dm3, null, { timeout: 20000 });
cs = await st(page);
check('Old (v1) autosave loads: settings kept', cs.channels.ch2.fader === -7.5);
check('...and new parameters are filled with defaults', cs.version === 2 && cs.channels.ch2.gate && cs.muteGroups.length === 6 && cs.channels.ch2.sends.mtx1 && cs.ports.in1.phantom === false);

check('No page errors during the run', errors.length === 0, errors.slice(0, 3).join(' | '));

await browser.close();
if (server) server.kill();

// ---------------------------------------------------------------- report
const lines = ['# Acceptance test results', '', `Run: ${new Date().toISOString()} · headless Chromium · levels read from live AnalyserNodes`, ''];
for (const r of results) {
  lines.push(`## ${r.ok ? '✅' : '❌'} ${r.name}`, '');
  for (const ch of r.checks) lines.push(`- ${ch.ok ? 'PASS' : '**FAIL**'} — ${ch.label}${ch.info ? ` (${ch.info})` : ''}`);
  lines.push('');
}
writeFileSync(new globalThis.URL('../../TEST_RESULTS.md', import.meta.url), lines.join('\n'));
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} test groups passed`);
process.exit(failed ? 1 : 0);
