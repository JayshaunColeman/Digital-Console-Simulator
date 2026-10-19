// Fault-finding scenarios for the TRAINING screen.
//
// Every scenario starts from a FRESH default console + rig, injects one or more
// faults and also sets up the "intended" show so the complaint makes sense.
// check() judges the symptom primarily by nominal routing gain (ctx.gain) and
// state, and additionally by live signal when the audio engine is running.
// A valid fix is not tied to one specific control: any change that genuinely
// restores the signal at a sensible level passes, while "fixes" that push a
// level to an extreme or break the rest of the show are rejected.

import type { ConsoleState, RigState } from '../model/types';
import { NEG_INF } from '../model/types';
import { findLoops } from '../engine/routing';
import type { CheckCtx, CheckResult, Scenario } from './types';

// ------------------------------------------------------------------ helpers --

type Item = [label: string, good: boolean];

const result = (items: Item[]): CheckResult => ({
  ok: items.every((i) => i[1]),
  detail: items.map(([label, good]) => `${label}: ${good ? 'yes' : 'no'}`),
});

/** Signal arrives at a sensible level: not lost, not pushed to an extreme. */
const reaches = (db: number): boolean => db > -40 && db < 6;

/** A live-signal condition that only applies while the audio engine is running. */
const live = (ctx: CheckCtx, label: string, good: (ctx: CheckCtx) => boolean): Item[] =>
  ctx.audio ? [[`${label} (band must be playing)`, good(ctx)]] : [];

const setSend = (
  s: ConsoleState,
  ch: string,
  bus: string,
  level: number,
  pre = true,
  on = true,
): void => {
  s.channels[ch].sends[bus] = { on, level, pre, pan: 0 };
};

/** Common "intended show": vocal in Wedge 1, keys + backing in Wedge 2, drums in Wedge 3, bass in Wedge 4. */
const intendedShow = (s: ConsoleState): void => {
  setSend(s, 'ch1', 'mix1', -3);
  setSend(s, 'ch6', 'mix2', -3);
  setSend(s, 'stin', 'mix2', -6);
  setSend(s, 'ch2', 'mix3', -3);
  setSend(s, 'ch3', 'mix3', -3);
  setSend(s, 'ch4', 'mix3', -6);
  setSend(s, 'ch5', 'mix4', -3);
};

// ---------------------------------------------------------------- scenarios --

export const SCENARIOS: Scenario[] = [
  // a --------------------------------------------------------------------------
  {
    id: 'silent-in-main-mix',
    title: 'Vocal silent in the house',
    difficulty: 1,
    brief:
      'Soundcheck: the singer is giving it everything and the vocal meter on the console is bouncing, but there is nothing from her in the PA out front. The rest of the band sounds fine.',
    setup: (s: ConsoleState, _r: RigState) => {
      intendedShow(s);
      s.channels.ch1.toSt = false;
    },
    hints: [
      'The signal is arriving at the console, so the problem is further downstream. Follow the vocal from its input towards the PA outputs.',
      'Use the SIGNAL FLOW tab and trace from the vocal channel to OMNI OUT 7. Look for a connection shown as broken.',
      'The channel itself is live and the fader is up. Look at where the channel is being sent: open SELECTED CH and check the ROUTING section.',
    ],
    solution:
      'Channel 1 was not assigned to the STEREO bus (ST assign off), so the vocal never reached the main mix that feeds the PA on OMNI OUT 7/8. Switch ST assign on in SELECTED CH > ROUTING. Concept: a channel only reaches the PA if it is assigned to STEREO (or to a bus that is patched to the PA). The input meter proves the signal got to the channel; it says nothing about where the channel is sent.',
    trace: { from: 'ch:ch1', to: 'out:omni7' },
    check: (ctx) => {
      const ch = ctx.state.channels.ch1;
      return result([
        ['Vocal arriving at channel 1', ctx.gain('dev:p1', 'ch:ch1') > -10],
        ['Vocal reaching the PA (OMNI OUT 7)', reaches(ctx.gain('ch:ch1', 'out:omni7'))],
        ['Channel fader at a usable position', ch.fader > -40 && ch.fader <= 5],
        ...live(ctx, 'Vocal signal after the fader', (c) => c.peak('ch.ch1.post') > -60),
      ]);
    },
  },

  // b --------------------------------------------------------------------------
  {
    id: 'missing-from-monitor',
    title: 'Singer cannot hear herself',
    difficulty: 1,
    brief:
      'The singer says she can hear the whole band in her wedge but not herself. The front-of-house engineer says the vocal sounds great out front.',
    setup: (s: ConsoleState) => {
      intendedShow(s);
      s.channels.ch1.sends.mix1.on = false;
    },
    hints: [
      'FOH is fine, so the channel and the main mix are healthy. Her wedge is fed by a different bus.',
      'Which bus feeds Wedge 1? Check what OMNI OUT 1 is patched to, then see whether the vocal channel feeds that bus.',
      'Select channel 1 and look at the sends in the ROUTING section (or use SENDS ON FADER with MIX 1). Look at the state of the MIX 1 send, not only its level.',
    ],
    solution:
      'The vocal channel\'s send to MIX 1 was switched off. The channel was in the main mix (ST assign) but each monitor mix only contains what you actively send to it. Switch the MIX 1 send on and set a sensible level. Concept: sends are independent of the ST assign, so a channel can be loud in FOH and absent from a monitor.',
    trace: { from: 'ch:ch1', to: 'out:omni1' },
    check: (ctx) => {
      const send = ctx.state.channels.ch1.sends.mix1;
      return result([
        ['Vocal reaching Wedge 1 (OMNI OUT 1)', reaches(ctx.gain('ch:ch1', 'out:omni1'))],
        ['Send level reasonable', send.level <= 5],
        ['Vocal still in the main mix', reaches(ctx.gain('ch:ch1', 'out:omni7'))],
        ...live(ctx, 'Live signal at OMNI OUT 1', (c) => c.peak('out.omni1') > -60),
      ]);
    },
  },

  // c --------------------------------------------------------------------------
  {
    id: 'bus-moving-no-output',
    title: 'Meter moves, wedge is dead',
    difficulty: 1,
    brief:
      'The monitor engineer swears the Mix 1 meter is bouncing along with the vocal, but the singer\'s wedge is completely dead. The wedge itself works - it was tested with another desk this morning.',
    setup: (s: ConsoleState) => {
      intendedShow(s);
      s.outPorts.omni1.source = null;
    },
    hints: [
      'The mix itself has signal, so the problem is after the bus. What connects a bus to a physical socket?',
      'Open the I/O PATCH screen and look at the OUTPUT PATCH for the output that feeds Wedge 1.',
      'OMNI OUT 1 has nothing selected in its dropdown. Patch the correct mix bus back to it.',
    ],
    solution:
      'OMNI OUT 1 had no source in the output patch, so MIX 1 carried the vocal internally but nothing left the console. Select MIX 1 as the source for OMNI OUT 1 in I/O PATCH > OUTPUT PATCH. Concept: a bus meter shows what is inside the console; an output only carries signal once the bus is patched to it.',
    trace: { from: 'ch:ch1', to: 'out:omni1' },
    check: (ctx) =>
      result([
        ['Vocal reaching the MIX 1 bus', ctx.gain('ch:ch1', 'bus:mix1:out') > -40],
        [
          'Signal leaving the console at OMNI OUT 1',
          reaches(ctx.gain('ch:ch1', 'out:omni1')) && ctx.state.outPorts.omni1.source === 'mix1',
        ],
        ...live(ctx, 'Live signal at OMNI OUT 1', (c) => c.peak('out.omni1') > -60),
      ]),
  },

  // d --------------------------------------------------------------------------
  {
    id: 'wrong-output-patch',
    title: 'Singer hears the keyboard mix',
    difficulty: 2,
    brief:
      'The singer says her wedge is working, but it is playing the keyboard player\'s mix - lots of keys and backing track, and not a trace of her own voice. The keys player is happy.',
    setup: (s: ConsoleState) => {
      intendedShow(s);
      s.outPorts.omni1.source = 'mix2';
    },
    hints: [
      'The wedge has signal, just the wrong signal. Her mix (MIX 1) is built correctly - so which mix is actually reaching her wedge?',
      'Compare the OUTPUT PATCH entries for OMNI OUT 1 and OMNI OUT 2 on the I/O PATCH screen.',
      'OMNI OUT 1 is patched to the same mix as the keys wedge. Patch her own mix to it, leaving OMNI OUT 2 alone.',
    ],
    solution:
      'OMNI OUT 1 was patched to MIX 2 instead of MIX 1, so both wedges played the keys mix. Patch MIX 1 to OMNI OUT 1 and leave OMNI OUT 2 on MIX 2. Concept: the mix content can be perfect and still go to the wrong person if the output patch is wrong; always verify the patch from bus to physical output.',
    trace: { from: 'ch:ch1', to: 'out:omni1' },
    check: (ctx) =>
      result([
        ['Vocal reaching Wedge 1 (OMNI OUT 1)', reaches(ctx.gain('ch:ch1', 'out:omni1'))],
        ['Keys kept out of Wedge 1', ctx.gain('ch:ch6', 'out:omni1') < -40],
        ['Keys wedge (OMNI OUT 2) still carrying keys', reaches(ctx.gain('ch:ch6', 'out:omni2'))],
        ...live(ctx, 'Live signal at OMNI OUT 1', (c) => c.peak('out.omni1') > -60),
      ]),
  },

  // e --------------------------------------------------------------------------
  {
    id: 'muted-bus-master',
    title: 'Wedge 1 gone silent',
    difficulty: 1,
    brief:
      'Wedge 1 was fine at soundcheck and now it is totally silent. The singer is still heard out front. Nobody touched the vocal channel as far as anyone knows.',
    setup: (s: ConsoleState) => {
      intendedShow(s);
      s.buses.mix1.on = false;
    },
    hints: [
      'Out front is fine, so only the wedge path is affected. The vocal channel and its send have not changed.',
      'Follow the signal from the vocal send through the bus to the output; every stage has an ON switch and a level.',
      'Look at the master section of the bus that feeds Wedge 1 (MIX 1): is the bus itself switched on?',
    ],
    solution:
      'The MIX 1 bus master ON key was off, muting the whole bus. Switch the master ON back on (select MIX 1 with SENDS ON FADER and look at the master strip). Concept: a bus has its own ON key and fader after the sum; muting it silences everything in that mix however the sends are set.',
    trace: { from: 'ch:ch1', to: 'out:omni1' },
    check: (ctx) => {
      const gov = ctx.state.buses.mix1;
      return result([
        ['Vocal reaching Wedge 1 (OMNI OUT 1)', reaches(ctx.gain('ch:ch1', 'out:omni1'))],
        ['Wedge 1 master at a sensible setting', gov.fader > -30 && gov.fader <= 5],
        ['Vocal still in the main mix', reaches(ctx.gain('ch:ch1', 'out:omni7'))],
        ...live(ctx, 'Live signal at OMNI OUT 1', (c) => c.peak('out.omni1') > -60),
      ]);
    },
  },

  // f --------------------------------------------------------------------------
  {
    id: 'wrong-send-destination',
    title: 'Vocal in the wrong wedge',
    difficulty: 2,
    brief:
      'The singer cannot hear herself in her wedge at all, and the keys player keeps complaining that there is a voice in his monitor that he did not ask for.',
    setup: (s: ConsoleState) => {
      intendedShow(s);
      s.channels.ch1.sends.mix1 = { on: true, level: NEG_INF, pre: true, pan: 0 };
      setSend(s, 'ch1', 'mix2', -3);
    },
    hints: [
      'Two people are affected and they are linked: the vocal is going somewhere it should not, and not going where it should.',
      'Look at the vocal channel\'s sends to the mix buses: SELECTED CH > ROUTING, or SENDS ON FADER with MIX 1 and then MIX 2.',
      'The vocal is sent to MIX 2 (keys wedge). Move that send to MIX 1: raise the MIX 1 send and take the MIX 2 send back down.',
    ],
    solution:
      'The vocal was sent to MIX 2 (the keys wedge) instead of MIX 1 (her own wedge). Bring up the vocal send on MIX 1 and take it out of MIX 2. Concept: each monitor mix is a separate bus; one wrong send both starves the right wedge and pollutes the wrong one.',
    trace: { from: 'ch:ch1', to: 'out:omni1' },
    check: (ctx) =>
      result([
        ['Vocal reaching Wedge 1 (OMNI OUT 1)', reaches(ctx.gain('ch:ch1', 'out:omni1'))],
        ['Vocal kept out of the keys wedge (OMNI OUT 2)', ctx.gain('ch:ch1', 'out:omni2') < -40],
        ['Keys wedge still carrying keys', reaches(ctx.gain('ch:ch6', 'out:omni2'))],
        ...live(ctx, 'Live signal at OMNI OUT 1', (c) => c.peak('out.omni1') > -60),
      ]),
  },

  // g --------------------------------------------------------------------------
  {
    id: 'kick-vanishes-drum-wedge',
    title: 'Kick comes and goes in the drum wedge',
    difficulty: 2,
    brief:
      'The drummer says his kick drum disappears from his wedge every time the front-of-house engineer pulls the kick down in the PA. Snare and hats stay put. He wants the kick to stay steady.',
    setup: (s: ConsoleState) => {
      intendedShow(s);
      setSend(s, 'ch2', 'mix3', 0, false); // post-fader
      s.channels.ch2.fader = NEG_INF; // FOH engineer has pulled the kick right down
    },
    hints: [
      'This only happens when the kick fader moves. What could make a monitor send depend on the FOH fader?',
      'Look at the MIX 3 send on the kick channel. Every send has a switch that decides where in the channel it is tapped.',
      'The send is POST-fader, so it follows the channel fader. Set the send to PRE (the PRE switch in the ROUTING section) so it is independent of the FOH fader.',
    ],
    solution:
      'The kick\'s MIX 3 send was POST-fader, so whatever the FOH engineer did with the channel fader also changed the drummer\'s wedge (at -inf there was nothing left). Switch the send to PRE-fader; the monitor level is then set only by the send level. Concept: monitor sends are normally pre-fader so FOH fader moves do not affect the stage; post-fader sends suit effects.',
    trace: { from: 'ch:ch2', to: 'out:omni3' },
    check: (ctx) => {
      const send = ctx.state.channels.ch2.sends.mix3;
      return result([
        ['Kick reaching Wedge 3 (OMNI OUT 3) with the FOH fader down', reaches(ctx.gain('ch:ch2', 'out:omni3'))],
        ['Kick holds in Wedge 3 whatever the FOH fader does', send.on && send.pre],
        ...live(ctx, 'Live signal at OMNI OUT 3', (c) => c.peak('out.omni3') > -60),
      ]);
    },
  },

  // h --------------------------------------------------------------------------
  {
    id: 'clipping-input-gain',
    title: 'Distorted vocal, fader way down',
    difficulty: 2,
    brief:
      'The vocal sounds harsh and crunchy no matter what, even though the channel fader is turned way down. The singer is not singing especially loud.',
    setup: (s: ConsoleState) => {
      intendedShow(s);
      s.ports.in1.gain = 40;
      s.channels.ch1.fader = -45;
    },
    hints: [
      'Distortion that does not change with the fader means the signal is already damaged before the fader.',
      'Check the input meter and the head-amp gain for the vocal input (I/O PATCH > INPUT SOCKETS, or SELECTED CH > INPUT).',
      'The head-amp (HA) gain is far too high, so INPUT 1 is clipping, and the fader has been pulled right down to compensate. Lower the HA gain until the input peaks around -12 dBFS, then bring the fader back to a normal range.',
    ],
    solution:
      'INPUT 1\'s head-amp gain was +40 dB so the analog input clipped; the fader at -45 dB only hid the problem by turning the damaged signal down. Set HA gain so the input peaks well below 0 dBFS (roughly -18 to -6), then restore the channel fader to a normal working range. Concept: gain staging - set levels at the input first; the fader is for balance, not for fixing a hot preamp.',
    trace: { from: 'dev:p1', to: 'out:omni7' },
    check: (ctx) => {
      const ha = ctx.state.ports.in1.gain;
      const fader = ctx.state.channels.ch1.fader;
      const items: Item[] = [
        ['Input 1 head-amp gain at a sane level', ha <= 12],
        ['Channel fader back in a sensible range', fader > -30 && fader <= 5],
        ['Vocal reaching the PA (OMNI OUT 7)', reaches(ctx.gain('ch:ch1', 'out:omni7'))],
      ];
      if (ctx.audio) {
        const p = ctx.peak('port.in1');
        items.push(['Input 1 clean with headroom (play the vocal)', p > -60 && p < -3]);
      }
      return result(items);
    },
  },

  // i --------------------------------------------------------------------------
  {
    id: 'compressor-squashing',
    title: 'Vocal sounds tiny',
    difficulty: 2,
    brief:
      'The vocal is thin and lifeless and sits far too low in the mix. Pushing the fader up barely helps and just makes it sound squashed and pumpy.',
    setup: (s: ConsoleState) => {
      intendedShow(s);
      s.channels.ch1.comp = {
        on: true,
        threshold: -50,
        ratio: 20,
        attack: 10,
        release: 150,
        knee: 2,
        makeup: 0,
      };
    },
    hints: [
      'Routing and faders look right; something is eating the level dynamically.',
      'Look at the vocal channel\'s processing in SELECTED CH > DYNAMICS and watch the gain-reduction meter.',
      'The compressor threshold is extremely low and the ratio extremely high, so it reduces the vocal by tens of dB. Either switch the compressor off or set a reasonable threshold and ratio.',
    ],
    solution:
      'The vocal compressor was set to threshold -50 dB, ratio 20:1 and no makeup gain, so it clamped the whole vocal down hard. Turn the compressor off or use gentle settings (for example threshold around -18 dB, ratio 2:1 to 4:1). Concept: a compressor only works when the threshold sits near the signal peaks; far below them it behaves like an automatic fader pulling everything down.',
    trace: { from: 'ch:ch1', to: 'out:omni7' },
    check: (ctx) => {
      const c = ctx.state.channels.ch1.comp;
      const sane = !c.on || (c.threshold >= -30 && c.ratio <= 8);
      const items: Item[] = [
        ['Vocal compressor settings reasonable', sane],
        ['Vocal reaching the PA (OMNI OUT 7)', reaches(ctx.gain('ch:ch1', 'out:omni7'))],
      ];
      if (ctx.audio) items.push(['Compressor gain reduction under 12 dB (play the vocal)', ctx.gr('ch.ch1.gr') > -12]);
      return result(items);
    },
  },

  // j --------------------------------------------------------------------------
  {
    id: 'feedback-loop',
    title: 'Howl building in Wedge 4',
    difficulty: 3,
    brief:
      'There is a rising howl and tone building up in Wedge 4 even though nobody is on stage and no mics are open. It gets worse by the second.',
    setup: (s: ConsoleState, r: RigState) => {
      intendedShow(s);
      // a cable from OMNI OUT 4 back into INPUT 12, with channel 12 feeding MIX 4
      r.plugs.in12 = { device: 'loop:omni4', ch: 'SUM' };
      s.channels.ch12.on = true;
      s.channels.ch12.fader = NEG_INF;
      setSend(s, 'ch12', 'mix4', 0);
    },
    hints: [
      'A tone that grows with nobody playing is a loop: some part of the output is getting back into an input.',
      'Open SIGNAL FLOW and look for a loop. Check what is plugged into the INPUT SOCKETS on I/O PATCH.',
      'A cable runs from OMNI OUT 4 into INPUT 12, and channel 12 sends to MIX 4, which feeds OMNI OUT 4. Break the loop: unplug the cable, switch off or lower the channel 12 send to MIX 4, or unpatch the output.',
    ],
    solution:
      'A cable from OMNI OUT 4 was plugged into INPUT 12, and channel 12 was sending to MIX 4 at 0 dB, which is patched to OMNI OUT 4: a closed loop with gain, so any noise regrows into a howl. Break the loop anywhere: unplug the cable (I/O PATCH > INPUT SOCKETS), turn the channel 12 MIX 4 send down or off, or turn channel 12 off. Concept: a signal path that returns to its own source with a loop gain of 1 or more will oscillate; check inputs for returns from outputs.',
    trace: { from: 'ch:ch12', to: 'out:omni4' },
    check: (ctx) => {
      const loops = findLoops(ctx.graph);
      return result([['Signal path free of feedback loops', loops.length === 0]]);
    },
  },

  // k --------------------------------------------------------------------------
  {
    id: 'reverb-return-silent',
    title: 'Reverb sends but no reverb',
    difficulty: 2,
    brief:
      'The singer asked for some reverb on her voice. The effect meter shows the reverb working but nobody out front hears any reverb at all.',
    setup: (s: ConsoleState) => {
      intendedShow(s);
      setSend(s, 'ch1', 'fx1', 0, false);
      s.channels.fxr1.on = false;
    },
    hints: [
      'The send side works: the effect is being fed. The problem is on the way back.',
      'In this console the effect output returns into its own channel (FX1 RTN). What does that channel need in order to be heard?',
      'Select FX1 RTN: check its ON key, its fader and its ST assign. The return must be live and assigned to STEREO.',
    ],
    solution:
      'The FX 1 return channel was muted (ON off) so the reverb output never reached the stereo mix. An FX return is a normal input channel: it needs ON, a fader up, and an assignment to STEREO or a mix bus. Concept: an effect needs both a send (to the FX bus) and a return (back into the mix); either half missing gives silence.',
    trace: { from: 'ch:ch1', to: 'out:omni7' },
    check: (ctx) => {
      const rtn = ctx.state.channels.fxr1;
      const items: Item[] = [
        ['Vocal feeding the reverb', ctx.gain('ch:ch1', 'fx:1') > -30],
        ['Reverb return reaching the main mix', ctx.gain('ch:fxr1', 'bus:st') > -30 && rtn.fader <= 5],
      ];
      if (ctx.audio) items.push(['Reverb signal present (band must be playing)', ctx.peak('fx.1.out') > -70]);
      return result(items);
    },
  },

  // l1 -------------------------------------------------------------------------
  {
    id: 'multi-dca-and-patch',
    title: 'Vocal vanished everywhere',
    difficulty: 3,
    brief:
      'The singer has vanished from the PA, and the wedge she is standing at is playing the keyboard mix instead of her own. The soundcheck was fine an hour ago.',
    setup: (s: ConsoleState) => {
      intendedShow(s);
      s.dcas[0] = { name: 'Vox', level: 0, on: false };
      s.channels.ch1.dca = [1];
      s.outPorts.omni1.source = 'mix2';
    },
    hints: [
      'There is more than one fault. Check the PA path and the wedge path separately.',
      'For the PA: something other than the channel strip itself can mute a channel (look at the DCA groups). For the wedge: check the OUTPUT PATCH.',
      'DCA 1 ("Vox") is muted and contains channel 1, and OMNI OUT 1 is patched to MIX 2. Switch DCA 1 back on (or take the vocal out of it) and patch MIX 1 to OMNI OUT 1.',
    ],
    solution:
      'Two faults: (1) the vocal channel belongs to DCA 1, and that DCA was muted - a muted DCA silences the channel including its sends, so the vocal vanished from both FOH and the wedge; (2) OMNI OUT 1 was patched to MIX 2 (keys wedge) instead of MIX 1. Unmute the DCA (or remove ch1 from it) and patch MIX 1 to OMNI OUT 1. Concept: DCA groups sit above the channel strip, so an innocent-looking strip can still be muted from elsewhere; always check group assignments when a channel is silent everywhere.',
    trace: { from: 'ch:ch1', to: 'out:omni1' },
    check: (ctx) =>
      result([
        ['Vocal reaching the PA (OMNI OUT 7)', reaches(ctx.gain('ch:ch1', 'out:omni7'))],
        ['Vocal reaching Wedge 1 (OMNI OUT 1)', reaches(ctx.gain('ch:ch1', 'out:omni1'))],
        ['Wedge 1 free of the keys mix', ctx.gain('ch:ch6', 'out:omni1') < -40],
        ...live(ctx, 'Live signal at OMNI OUT 1', (c) => c.peak('out.omni1') > -60),
      ]),
  },

  // l2 -------------------------------------------------------------------------
  {
    id: 'multi-keys-wedge-dead',
    title: 'Keys wedge dead',
    difficulty: 3,
    brief:
      'The keys player can hear absolutely nothing in his wedge - not his keyboard and not the backing track - and he is not happy about it. The singer\'s wedge is fine.',
    setup: (s: ConsoleState) => {
      intendedShow(s);
      s.channels.ch6.sends.mix2 = { on: true, level: NEG_INF, pre: true, pan: 0 };
      s.channels.stin.sends.mix2.on = false;
      s.outPorts.omni2.att = NEG_INF;
    },
    hints: [
      'Several things could be wrong at once. Work from the output backwards, one stage at a time, and use SIGNAL FLOW to see which connections are broken.',
      'Check the keys and backing-track sends into MIX 2, then check the output stage of OMNI OUT 2 on the I/O PATCH screen.',
      'The keys send to MIX 2 is at -infinity, the backing track send to MIX 2 is switched off, and OMNI OUT 2 has its output attenuation at -infinity. All three must be fixed.',
    ],
    solution:
      'Three faults stacked on one path: (1) the keys send to MIX 2 was at -inf, (2) the backing-track (ST IN) send to MIX 2 was switched off, and (3) OMNI OUT 2\'s output attenuator was at -inf. Fixing only the sends would still leave the output silent. Raise/enable both sends and set the OMNI OUT 2 attenuator back to 0 dB. Concept: multi-fault diagnosis - fix one fault, re-test, and keep following the signal; a symptom can hide several independent causes.',
    trace: { from: 'ch:ch6', to: 'out:omni2' },
    check: (ctx) =>
      result([
        ['Keys reaching Wedge 2 (OMNI OUT 2)', reaches(ctx.gain('ch:ch6', 'out:omni2'))],
        ['Backing track reaching Wedge 2', reaches(ctx.gain('ch:stin', 'out:omni2'))],
        ['Singer\'s wedge (OMNI OUT 1) still carrying vocal', reaches(ctx.gain('ch:ch1', 'out:omni1'))],
        ...live(ctx, 'Live signal at OMNI OUT 2', (c) => c.peak('out.omni2') > -60),
      ]),
  },
];
