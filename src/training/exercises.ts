// Academy exercises: guided, step-by-step tasks from first signal to a small
// live event. Each check() verifies real console state (routing gain / state)
// and, for exercises about hearing or metering signal, the live meters.
//
// "Hard signal" exercises (microphone, input signal, gain staging, tracing)
// cannot pass while the audio engine is stopped. "Soft signal" exercises are
// routing tasks: the routing graph alone can pass them, and when audio is
// running the matching meter must also show signal.

import type { ConsoleState, RigState } from '../model/types';
import { NEG_INF } from '../model/types';
import { defaultComp } from '../model/defaults';
import type { CheckCtx, CheckResult, Exercise } from './types';

// ------------------------------------------------------------------ helpers --

type Item = [label: string, good: boolean];

const START_AUDIO = 'Start audio (POWER button) to verify by signal';

const mark = (good: boolean, label: string): string => `${good ? '✓' : '✗'} ${label}`;

/** Result for routing exercises. `signal` items are only added while audio runs. */
function soft(items: Item[], signal: Item[], ctx: CheckCtx): CheckResult {
  const all = ctx.audio ? [...items, ...signal] : items;
  const detail = all.map(([l, g]) => mark(g, l));
  if (!ctx.audio) detail.push(`(Optional) ${START_AUDIO}`);
  return { ok: all.every((i) => i[1]), detail };
}

/** Result for exercises that are only complete once signal has been observed. */
function hard(items: Item[], signal: (ctx: CheckCtx) => Item[], ctx: CheckCtx): CheckResult {
  if (!ctx.audio) {
    return { ok: false, detail: [...items.map(([l, g]) => mark(g, l)), START_AUDIO] };
  }
  const all = [...items, ...signal(ctx)];
  return { ok: all.every((i) => i[1]), detail: all.map(([l, g]) => mark(g, l)) };
}

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

const anyPlayerOrGenerator = (ctx: CheckCtx): boolean =>
  ctx.rig.generator.on || ctx.rig.players.some((_, i) => ctx.playing(i));

// --------------------------------------------------------------- exercises ---

export const EXERCISES: Exercise[] = [
  // ============================================================ BEGINNER ====
  {
    id: 'connect-microphone',
    level: 'beginner',
    title: 'Connect a microphone',
    goal: 'Plug a microphone into an input socket, patch it to a channel and see its signal arrive.',
    steps: [
      'Press the POWER button in the top bar to start audio.',
      'Open the SOURCES tab and press CONNECT MIC. Allow microphone access if the browser asks.',
      'Open the I/O PATCH tab and look at INPUT SOCKETS: confirm the microphone is shown plugged into an input.',
      'Check that a channel is patched to that same input (SELECTED CH > INPUT shows the patch).',
      'Speak into the microphone and watch the meter on that channel.',
    ],
    hints: [
      'No microphone available? Browsers need permission, and a computer without a mic cannot pass this one. You can still practise the next exercises with the signal generator in SOURCES.',
      'The input socket that holds the microphone is listed under INPUT SOCKETS on the I/O PATCH screen.',
      'The channel strip with the matching number (for example INPUT 8 -> channel 8) is already patched by default.',
    ],
    setup: (_s: ConsoleState, r: RigState) => {
      r.plugs.in8 = null; // unplug the demo microphone so the learner connects it
    },
    check: (ctx) => {
      const ports = Object.entries(ctx.rig.plugs)
        .filter(([, p]) => p !== null && p.device === 'mic')
        .map(([id]) => id);
      const plugged = ports.length > 0;
      const patched = ports.some((id) =>
        Object.values(ctx.state.channels).some((c) => c.patchL === id || c.patchR === id),
      );
      const items: Item[] = [
        ['A microphone is plugged into an input socket', plugged],
        ['A channel is patched to that input', patched],
      ];
      return hard(items, (c) => [['Microphone signal is live', c.peak('dev.mic') > -70]], ctx);
    },
  },

  {
    id: 'confirm-input-signal',
    level: 'beginner',
    title: 'Confirm input signal',
    goal: 'Start a sound source and prove signal is arriving on a channel by its input meter.',
    steps: [
      'Press the POWER button to start audio.',
      'Open the SOURCES tab and press PLAY ALL to start the demo band (or switch the signal generator on).',
      'Go to the OVERVIEW tab and find a channel whose input meter is moving.',
      'Confirm the meter moves even if the fader is down - the input meter is before the fader.',
    ],
    hints: [
      'No movement? Check that the source is playing and that a channel is patched to it (I/O PATCH).',
      'The demo band feeds channels 1-6 and the backing track feeds ST IN.',
      'The generator feeds channel 16 by default; its level is set on the SOURCES screen.',
    ],
    check: (ctx) =>
      hard(
        [],
        (c) => {
          const live = c.model.channels.find((ch) => c.peak(`ch.${ch.id}.in`) > -50);
          return [
            ['A player or the generator is running', anyPlayerOrGenerator(c)],
            [live ? `Signal on ${live.defaultName} input` : 'A channel input meter shows signal', live !== undefined],
          ];
        },
        ctx,
      ),
  },

  {
    id: 'adjust-input-gain',
    level: 'beginner',
    title: 'Adjust the input gain',
    goal: 'Set the INPUT 1 head-amp gain so the vocal peaks between -24 and -6 dBFS.',
    steps: [
      'Press POWER, then PLAY ALL on the SOURCES screen so the vocal is playing.',
      'Open the I/O PATCH tab. Under INPUT SOCKETS find INPUT 1 and its HA GAIN control.',
      'Watch the INPUT 1 meter. Raise HA GAIN until the peaks reach about -12 dBFS; lower it if the meter reaches the top (clip).',
      'Leave the peaks between -24 and -6 dBFS: loud enough to be clean, with headroom.',
    ],
    hints: [
      'The goal is healthy peaks, not the loudest possible signal: aim for around -12 dBFS.',
      'HA GAIN is also available in SELECTED CH > INPUT for channel 1.',
      'The vocal must be playing for the meter to show anything.',
    ],
    setup: (s: ConsoleState) => {
      s.ports.in1.gain = 30; // far too hot
    },
    check: (ctx) =>
      hard(
        [],
        (c) => {
          const p = c.peak('port.in1');
          return [
            ['The vocal player is playing', c.playing(0)],
            ['INPUT 1 peaks between -24 and -6 dBFS', p >= -24 && p <= -6],
          ];
        },
        ctx,
      ),
  },

  {
    id: 'route-to-stereo',
    level: 'beginner',
    title: 'Route a channel to Stereo L/R',
    goal: 'Assign channel 1 to the STEREO bus so it reaches the main PA outputs.',
    steps: [
      'Open the SELECTED CH tab and select channel 1 (SEL key).',
      'Go to the ROUTING section and switch the ST assign on.',
      'Check that the channel ON key is lit and the fader is up.',
      'With audio running and the vocal playing, watch the STEREO master meter move.',
    ],
    hints: [
      'In the ROUTING section the ST assign sends the channel after its fader to the main mix.',
      'If the master meter does not move, check the channel ON key and fader.',
      'Use SIGNAL FLOW to see the connection from channel 1 to the STEREO bus.',
    ],
    setup: (s: ConsoleState) => {
      s.channels.ch1.toSt = false;
    },
    check: (ctx) =>
      soft(
        [
          ['Channel 1 assigned to STEREO', ctx.state.channels.ch1.toSt],
          ['Channel 1 reaches the STEREO master (level above -30 dB)', ctx.gain('ch:ch1', 'bus:st:out') > -30],
        ],
        [['Signal on the STEREO master meter', ctx.peak('bus.st.out') > -60]],
        ctx,
      ),
  },

  {
    id: 'fader-and-mute',
    level: 'beginner',
    title: 'Use the channel fader and mute',
    goal: 'Raise channel 1 to a working level, then mute it with its ON key.',
    steps: [
      'Find channel 1 on the OVERVIEW tab. Its fader is pulled well down.',
      'Drag the fader up to around -10 dB (above -20).',
      'Press the ON key on channel 1 so it goes off: the channel is now muted.',
      'Leave it muted to complete the exercise, then press ON again to restore it.',
    ],
    hints: [
      'The ON key is the console\'s mute: lit means live, dark means muted.',
      'Muting does not move the fader - the fader keeps its position.',
      'The fader scale marks 0 dB near the top; around -10 is a typical working position.',
    ],
    setup: (s: ConsoleState) => {
      s.channels.ch1.fader = -35;
    },
    check: (ctx) => {
      const ch = ctx.state.channels.ch1;
      return soft(
        [
          ['Channel 1 fader raised above -20 dB', ch.fader > -20],
          ['Channel 1 muted (ON key off)', !ch.on],
        ],
        [],
        ctx,
      );
    },
  },

  {
    id: 'route-to-mix-bus',
    level: 'beginner',
    title: 'Route a channel to Mix Bus 1',
    goal: 'Send the vocal to MIX 1 so the signal appears on the MIX 1 bus.',
    steps: [
      'Select channel 1 on the SELECTED CH tab.',
      'In the ROUTING section find the sends and the MIX 1 send.',
      'Make sure the send is switched on and raise its level above -20 dB (for example 0 dB).',
      'With audio running and the vocal playing, check that the MIX 1 bus meter moves.',
    ],
    hints: [
      'A send is separate from ST assign: a channel can be in MIX 1 and not in the main mix.',
      'You can also use SENDS ON FADER with MIX 1 selected and move the channel fader.',
      'The send must be on and not at -infinity.',
    ],
    check: (ctx) => {
      const send = ctx.state.channels.ch1.sends.mix1;
      return soft(
        [
          ['MIX 1 send on channel 1 is on', send.on],
          ['MIX 1 send level is above -20 dB', send.level > -20 && send.level <= 10],
          ['Channel 1 reaches the MIX 1 bus', ctx.gain('ch:ch1', 'bus:mix1') > -20],
        ],
        [['Signal on the MIX 1 bus meter', ctx.peak('bus.mix1.in') > -60]],
        ctx,
      );
    },
  },

  {
    id: 'build-monitor-mix',
    level: 'beginner',
    title: 'Build a monitor mix',
    goal: 'Build the singer\'s wedge mix: vocal clearly louder than keys, backing track included, patched to OMNI OUT 1.',
    steps: [
      'In the MASTER section press SENDS ON FADER, then choose the MIX 1 bus key.',
      'Raise the Vocal (channel 1) fader to set its send to MIX 1 around 0 dB.',
      'Keep Keys (channel 6) at least 6 dB below the vocal, and add some Backing (ST IN).',
      'Open I/O PATCH > OUTPUT PATCH and make sure MIX 1 is patched to OMNI OUT 1.',
      'Press SENDS ON FADER again to return the faders to normal.',
    ],
    hints: [
      'With SENDS ON FADER active, faders show the send level to the selected bus, not the main mix.',
      'The singer needs mostly herself: vocal at least 6 dB above the keys.',
      'OUTPUT PATCH shows a dropdown per OMNI output; pick MIX 1 for OMNI OUT 1.',
    ],
    setup: (s: ConsoleState) => {
      s.outPorts.omni1.source = null;
      setSend(s, 'ch6', 'mix1', -3);
    },
    check: (ctx) => {
      const gv = ctx.gain('ch:ch1', 'out:omni1');
      const gk = ctx.gain('ch:ch6', 'out:omni1');
      return soft(
        [
          ['MIX 1 patched to OMNI OUT 1', ctx.state.outPorts.omni1.source === 'mix1'],
          ['Vocal in Mix 1 (above -20 dB)', gv > -20 && gv <= 6],
          ['Vocal at least 6 dB louder than keys', gv - gk >= 6],
          ['Backing track present in Mix 1', ctx.gain('ch:stin', 'out:omni1') > -40],
        ],
        [['Signal at OMNI OUT 1', ctx.peak('out.omni1') > -60]],
        ctx,
      );
    },
  },

  {
    id: 'sends-on-fader',
    level: 'beginner',
    title: 'Use Sends on Fader',
    goal: 'Use Sends on Fader to build the keys player\'s wedge mix on MIX 2 with at least three channels.',
    steps: [
      'In the MASTER section press SENDS ON FADER and select the MIX 2 bus key.',
      'The channel faders now control each channel\'s send to MIX 2.',
      'Raise Keys, the backing track and at least one other channel so three or more channels are in the mix.',
      'Press SENDS ON FADER again to return to the main mix.',
    ],
    hints: [
      'The keys wedge (Wedge 2) is fed by MIX 2.',
      'A send only counts if it is on and above about -40 dB.',
      'You can verify the sends in SELECTED CH > ROUTING for each channel.',
    ],
    check: (ctx) => {
      const count = ctx.model.channels.filter((c) => {
        const send = ctx.state.channels[c.id].sends.mix2;
        return c.kind !== 'fxreturn' && !!send && send.on && send.level > -40;
      }).length;
      return soft([[`Three or more channels sending to MIX 2 (${count} so far)`, count >= 3]], [], ctx);
    },
  },

  {
    id: 'patch-bus-to-output',
    level: 'beginner',
    title: 'Patch a bus to an output',
    goal: 'Patch MIX 3 to a physical output without disturbing the other outputs.',
    steps: [
      'Open the I/O PATCH tab and find OUTPUT PATCH.',
      'MIX 3 (the drum wedge) is currently not patched anywhere.',
      'Choose MIX 3 as the source of a free OMNI OUT (OMNI OUT 3 is the free one).',
      'Do not overwrite another output that already carries a mix or the stereo bus.',
    ],
    hints: [
      'Each output has a dropdown listing the possible sources.',
      'Outputs 1-2 and 4-6 carry other monitor mixes; 7 and 8 carry the PA.',
      'Drums are already sending to MIX 3, so the signal appears once it is patched.',
    ],
    setup: (s: ConsoleState) => {
      s.outPorts.omni3.source = null;
      setSend(s, 'ch2', 'mix3', 0);
    },
    check: (ctx) => {
      const out = ctx.model.outPorts.find((p) => ctx.state.outPorts[p.id].source === 'mix3');
      const patched = out !== undefined;
      const needed = ['mix1', 'mix2', 'mix4', 'mix5', 'mix6', 'st_l', 'st_r'];
      const intact = needed.every((src) =>
        ctx.model.outPorts.some((p) => p.group === 'analog' && ctx.state.outPorts[p.id].source === src),
      );
      const flows = patched && ctx.gain('ch:ch2', `out:${out.id}`) > -40;
      return soft(
        [
          ['MIX 3 patched to an output', patched],
          ['Other mixes and the PA outputs still patched', intact],
          ['A channel sending to MIX 3 reaches that output', flows],
        ],
        [],
        ctx,
      );
    },
  },

  {
    id: 'trace-input-to-output',
    level: 'beginner',
    title: 'Trace a signal from input to output',
    goal: 'Follow the vocal from its player through the console to the speaker you are listening on.',
    steps: [
      'Open the SIGNAL FLOW tab and trace from Player 1 (the vocal) to the browser output.',
      'Note each stage: input socket, channel, ON/fader, send, bus master, output patch.',
      'Press POWER and start the demo band with PLAY ALL on the SOURCES screen.',
      'Check in I/O PATCH > LISTEN that you are listening to OMNI OUT 1 (this exercise sets that for you).',
      'Confirm you can hear the vocal and that the listen meter moves.',
    ],
    hints: [
      'The LISTEN section on I/O PATCH decides which outputs the browser speakers hear.',
      'Only channel 1 is sent to MIX 1, so you hear just the vocal.',
      'If it is silent, trace again and look for a broken connection.',
    ],
    setup: (s: ConsoleState, r: RigState) => {
      r.listen = { mode: 'ports', l: 'omni1', r: 'omni1', volume: -6 };
      setSend(s, 'ch1', 'mix1', 0);
    },
    check: (ctx) =>
      hard(
        [['Vocal player routed to the listen output', ctx.gain('dev:p1', 'listen') > -40]],
        (c) => [['Signal reaching the speakers (listen meter)', c.peak('listen') > -60]],
        ctx,
      ),
  },

  {
    id: 'phantom-power',
    level: 'beginner',
    title: 'Phantom power for a condenser mic',
    goal: 'A condenser vocal mic is plugged into INPUT 1 but the channel is silent. Switch on +48V and set the gain so INPUT 1 peaks between -24 and -6 dBFS.',
    steps: [
      'Press POWER, then PLAY ALL on the SOURCES screen so the vocal is playing (the vocal is now a condenser mic).',
      'Open the I/O PATCH tab. Under INPUT SOCKETS find INPUT 1: the INPUT 1 meter shows nothing, even though a mic is plugged in.',
      'Switch +48V on for INPUT 1 (the +48V column on I/O PATCH, or the +48V key next to HA GAIN in SELECTED CH > INPUT for channel 1).',
      'Now raise HA GAIN until the INPUT 1 peaks sit between -24 and -6 dBFS (aim for about -12).',
    ],
    hints: [
      'Condenser microphones contain active electronics that are powered from the console over the microphone cable: that is what phantom power (+48V) is for.',
      'Dynamic microphones do not need +48V; a condenser makes no sound at all without it.',
      'With +48V on and the gain still at 0 dB the signal will be very quiet: raise HA GAIN a little at a time while the vocal is playing.',
    ],
    setup: (s: ConsoleState, r: RigState) => {
      r.kinds.p1 = 'condenser';
      s.ports.in1.phantom = false;
      s.ports.in1.gain = 0;
    },
    check: (ctx) => {
      const items: Item[] = [
        ['A condenser mic is plugged into INPUT 1', ctx.rig.kinds.p1 === 'condenser' && ctx.rig.plugs.in1?.device === 'p1'],
        ['+48V is on for INPUT 1', ctx.state.ports.in1.phantom],
        ['Signal can travel from the mic to channel 1', ctx.gain('dev:p1', 'ch:ch1') > -10],
      ];
      return hard(
        items,
        (c) => {
          const p = c.peak('port.in1');
          return [
            ['The vocal player is playing', c.playing(0)],
            ['INPUT 1 peaks between -24 and -6 dBFS', p >= -24 && p <= -6],
          ];
        },
        ctx,
      );
    },
  },

  // ======================================================== INTERMEDIATE ====
  {
    id: 'vocal-monitor-mix',
    level: 'intermediate',
    title: 'Vocal-heavy monitor mix',
    goal: 'Make a MIX 1 wedge mix with a loud vocal, a quieter backing track, and both sends pre-fader.',
    steps: [
      'Select MIX 1 with SENDS ON FADER (or work in SELECTED CH > ROUTING).',
      'Set the vocal send to MIX 1 to around 0 dB and the backing track (ST IN) send to at least 6 dB below it.',
      'Switch both sends to PRE so FOH fader moves do not change the wedge.',
      'Check MIX 1 is patched to OMNI OUT 1 in I/O PATCH.',
    ],
    hints: [
      'The PRE switch is next to each send in the ROUTING section of SELECTED CH.',
      'Vocal about 0 dB and backing about -9 dB gives a clear difference.',
      'Both channels must be pre-fader.',
    ],
    setup: (s: ConsoleState) => {
      s.channels.ch1.sends.mix1 = { on: true, level: NEG_INF, pre: false, pan: 0 };
      setSend(s, 'stin', 'mix1', 0, false);
    },
    check: (ctx) => {
      const v = ctx.state.channels.ch1.sends.mix1;
      const b = ctx.state.channels.stin.sends.mix1;
      const gv = ctx.gain('ch:ch1', 'bus:mix1');
      const gb = ctx.gain('ch:stin', 'bus:mix1');
      return soft(
        [
          ['Vocal send to MIX 1 on and above -10 dB', v.on && gv > -10 && gv <= 6],
          ['Backing track present in MIX 1', gb > -40],
          ['Vocal at least 6 dB louder than backing', gv - gb >= 6],
          ['Both sends are pre-fader', v.pre && b.pre],
          ['MIX 1 reaches OMNI OUT 1', ctx.gain('ch:ch1', 'out:omni1') > -20],
        ],
        [['Signal at OMNI OUT 1', ctx.peak('out.omni1') > -60]],
        ctx,
      );
    },
  },

  {
    id: 'drum-mix-and-mute-group',
    level: 'intermediate',
    title: 'Drum wedge mix and a drum mute group',
    goal: 'Send kick, snare and hi-hat to MIX 3 (the drummer\'s wedge) and put the three drum channels in one mute group (for example MUTE GROUP 1), ready for one-key muting but not engaged.',
    steps: [
      'Select MIX 3 with SENDS ON FADER and bring kick, snare and hi-hat up in the mix.',
      'Check MIX 3 is patched to OMNI OUT 3 in I/O PATCH.',
      'In SELECTED CH > MUTE GROUP for channels 2, 3 and 4 press the same assign key (for example 1).',
      'Leave the group disengaged in the MASTER section so the drums still sound. (The DM3 has no DCA groups: a mute group is how you grab several channels with one key.)',
    ],
    hints: [
      'Mute group assignment is in SELECTED CH > MUTE GROUP; the group key in the MASTER section does the actual muting.',
      'All three channels must be in the same mute group number, and the vocal does not belong in it.',
      'An assigned but disengaged group does nothing yet: that is exactly the state you want before the song starts.',
    ],
    check: (ctx) => {
      const drums = ['ch2', 'ch3', 'ch4'];
      const names = ['Kick', 'Snare', 'Hi-hat'];
      const levels = drums.map((d) => ctx.gain(`ch:${d}`, 'out:omni3'));
      const shared = ctx.state.muteGroups.findIndex((_, i) =>
        drums.every((d) => ctx.state.channels[d].muteGroups.includes(i + 1)),
      );
      const engaged = shared >= 0 && ctx.state.muteGroups[shared].on;
      return soft(
        [
          ...drums.map((_, i): Item => [`${names[i]} reaches OMNI OUT 3`, levels[i] > -30 && levels[i] <= 6]),
          ['Kick, snare and hi-hat share one mute group', shared >= 0],
          ['That mute group is not engaged (drums still sound)', shared >= 0 && !engaged],
          ['The vocal is not in the drum group', shared >= 0 && !ctx.state.channels.ch1.muteGroups.includes(shared + 1)],
        ],
        [['Signal at OMNI OUT 3', ctx.peak('out.omni3') > -60]],
        ctx,
      );
    },
  },

  {
    id: 'pre-fader-sends',
    level: 'intermediate',
    title: 'Pre-fader sends',
    goal: 'Make the vocal\'s MIX 1 send pre-fader and prove it: pull the channel fader down and the wedge stays.',
    steps: [
      'Select channel 1 and open SELECTED CH > ROUTING.',
      'Set the MIX 1 send to PRE.',
      'Pull the channel 1 fader down to -20 dB or lower.',
      'Check the wedge level does not change: the send still reaches MIX 1.',
    ],
    hints: [
      'POST sends move with the fader; PRE sends ignore it.',
      'The PRE switch sits beside the send in ROUTING.',
      'Use SIGNAL FLOW to see the send tapped before the fader.',
    ],
    setup: (s: ConsoleState) => {
      s.channels.ch1.fader = -10;
      setSend(s, 'ch1', 'mix1', 0, false);
    },
    check: (ctx) => {
      const ch = ctx.state.channels.ch1;
      return soft(
        [
          ['MIX 1 send is pre-fader', ch.sends.mix1.pre],
          ['Channel 1 fader at -20 dB or lower', ch.fader <= -20],
          ['Vocal still reaching MIX 1 (above -20 dB)', ctx.gain('ch:ch1', 'bus:mix1') > -20],
        ],
        [['Signal on the MIX 1 bus meter', ctx.peak('bus.mix1.in') > -60]],
        ctx,
      );
    },
  },

  {
    id: 'reverb-send-return',
    level: 'intermediate',
    title: 'Set up reverb with send and return',
    goal: 'Feed the vocal to FX 1 and bring the reverb back into the stereo mix.',
    steps: [
      'Select channel 1 and raise its FX 1 send above -20 dB (SELECTED CH > ROUTING or SENDS ON FADER with FX 1).',
      'Open the FX RACK tab and check FX 1 is a reverb.',
      'Select the FX1 RTN channel and make sure it is on, its fader is up and ST assign is on.',
      'Play the vocal and listen for the reverb tail.',
    ],
    hints: [
      'An effect needs a send (to the FX bus) and a return (back into the mix).',
      'FX1 RTN is a normal input channel with its own ST assign.',
      'The FX 1 send is post-fader by default.',
    ],
    setup: (s: ConsoleState) => {
      s.channels.ch1.sends.fx1 = { on: true, level: NEG_INF, pre: false, pan: 0 };
      s.channels.fxr1.toSt = false;
    },
    check: (ctx) => {
      const send = ctx.state.channels.ch1.sends.fx1;
      const rtn = ctx.state.channels.fxr1;
      return soft(
        [
          ['Channel 1 FX 1 send on and above -20 dB', send.on && send.level > -20 && send.level <= 6],
          ['Vocal reaches the FX 1 return channel', ctx.gain('ch:ch1', 'ch:fxr1') > -30],
          ['FX 1 return assigned to STEREO', rtn.toSt],
          ['FX 1 return reaches the main mix', ctx.gain('ch:fxr1', 'bus:st') > -30],
        ],
        [['Reverb output has signal', ctx.peak('fx.1.out') > -70]],
        ctx,
      );
    },
  },

  {
    id: 'fix-incorrect-output-patch',
    level: 'intermediate',
    title: 'Troubleshoot an incorrect output patch',
    goal: 'The vocal is sent to MIX 1 but Wedge 1 plays the wrong mix. Find and fix it.',
    steps: [
      'Listen: the singer\'s wedge is not carrying her mix.',
      'Open SIGNAL FLOW and trace from channel 1 to OMNI OUT 1.',
      'Find the broken connection, then open I/O PATCH > OUTPUT PATCH.',
      'Patch the correct bus to OMNI OUT 1 and check the vocal arrives.',
    ],
    hints: [
      'The send and bus are fine - look after the bus.',
      'Compare the OMNI OUT 1 and OMNI OUT 2 dropdowns.',
      'OMNI OUT 1 should carry MIX 1.',
    ],
    setup: (s: ConsoleState) => {
      s.outPorts.omni1.source = 'mix2';
      setSend(s, 'ch1', 'mix1', 0);
    },
    check: (ctx) =>
      soft(
        [
          ['OMNI OUT 1 patched to MIX 1', ctx.state.outPorts.omni1.source === 'mix1'],
          ['Vocal reaches OMNI OUT 1 (above -20 dB)', ctx.gain('ch:ch1', 'out:omni1') > -20],
        ],
        [['Signal at OMNI OUT 1', ctx.peak('out.omni1') > -60]],
        ctx,
      ),
  },

  {
    id: 'compare-main-vs-monitor',
    level: 'intermediate',
    title: 'Compare main mix and monitor mix',
    goal: 'Make FOH and the singer\'s wedge balance in opposite directions: keys at least as loud as vocal in the main mix, but the vocal 6 dB above keys in MIX 1.',
    steps: [
      'Bring the Keys (channel 6) fader up to at least the Vocal (channel 1) fader level in the main mix.',
      'With SENDS ON FADER on MIX 1, set the vocal send at least 6 dB above the keys send (keep keys audible).',
      'Return from SENDS ON FADER and confirm the main faders did not change.',
      'Compare: the PA is keys-forward while the wedge is vocal-forward.',
    ],
    hints: [
      'The main mix is set by the channel faders; the monitor mix by the sends.',
      'Make sure both channels are actually in MIX 1 (send on, above -40 dB).',
      'Pre-fader sends keep the monitor mix independent of the faders.',
    ],
    setup: (s: ConsoleState) => {
      s.channels.ch1.fader = -10;
      s.channels.ch6.fader = -12;
    },
    check: (ctx) => {
      const gv = ctx.gain('ch:ch1', 'bus:mix1');
      const gk = ctx.gain('ch:ch6', 'bus:mix1');
      const sv = ctx.gain('ch:ch1', 'bus:st');
      const sk = ctx.gain('ch:ch6', 'bus:st');
      return soft(
        [
          ['Vocal in MIX 1 (above -20 dB)', gv > -20 && gv <= 6],
          ['Keys present in MIX 1', gk > -40],
          ['Vocal at least 6 dB above keys in MIX 1', gv - gk >= 6],
          ['Both channels in the main mix', sv > -40 && sk > -40],
          ['Keys at least as loud as vocal in the main mix', sk - sv >= 0],
        ],
        [],
        ctx,
      );
    },
  },

  {
    id: 'one-knob-compressor',
    level: 'intermediate',
    title: 'Compress the vocal in 1-knob mode',
    goal: 'Use Dynamics 2 on the vocal in 1-KNOB mode: compressor on, 1-KNOB on, AMOUNT between 3 and 7, vocal still in the PA.',
    steps: [
      'Select channel 1 (Vocal) and open SELECTED CH > DYNAMICS 2 · COMP.',
      'Switch the compressor ON and switch on 1-KNOB mode: one AMOUNT control now drives threshold, ratio and out gain together.',
      'Press POWER and PLAY ALL, then raise AMOUNT while watching the gain-reduction meter.',
      'Leave AMOUNT between 3 and 7: a few dB of reduction on the peaks, not a squashed vocal.',
    ],
    hints: [
      '1-KNOB mode trades the detailed controls for a single AMOUNT (0 to 10); more amount means more compression.',
      'Aim for a few dB of gain reduction on the loud syllables; 10 on the dial is an effect, not a mix tool.',
      'The vocal must stay assigned to STEREO and reach the PA.',
    ],
    setup: (s: ConsoleState) => {
      s.channels.ch1.comp = { ...defaultComp(), amount: 0 };
    },
    check: (ctx) => {
      const c = ctx.state.channels.ch1.comp;
      return soft(
        [
          ['Vocal compressor is on', c.on],
          ['1-KNOB mode is on', c.oneKnob],
          ['AMOUNT between 3 and 7', c.amount >= 3 && c.amount <= 7],
          ['Vocal reaching the PA (OMNI OUT 7)', ctx.gain('ch:ch1', 'out:omni7') > -40],
        ],
        [
          ['Vocal signal present (channel 1 post-fader)', ctx.peak('ch.ch1.post') > -60],
          ['Gain reduction under 12 dB', ctx.gr('ch.ch1.gr') > -12],
        ],
        ctx,
      );
    },
  },

  {
    id: 'noise-gate',
    level: 'intermediate',
    title: 'Gate the snare',
    goal: 'Use the gate (Dynamics 1) on the snare channel to cut the spill between hits: gate on, threshold between -40 and -15 dBFS, range of -20 dB or deeper.',
    steps: [
      'Select channel 3 (Snare) and open SELECTED CH > DYNAMICS 1 · GATE/DUCKER.',
      'Make sure the mode is GATE (not DUCKER) and the key source is SELF, then switch the gate ON.',
      'Press POWER and PLAY ALL, then watch the gate gain-reduction meter while the snare plays.',
      'Set the THRESHOLD between -40 and -15 dBFS so the gate opens on each snare hit, and set the RANGE to -20 dB or deeper so the gaps are properly quiet.',
    ],
    hints: [
      'A gate closes (attenuates by RANGE) when the signal falls below the THRESHOLD and opens again when it rises above it.',
      'If the threshold is too high the gate also chops the snare itself; too low and it never closes.',
      'ATTACK should be fast (about 1 ms) so the front of each hit is not lost; HOLD and DECAY control how the tail closes.',
    ],
    check: (ctx) => {
      const g = ctx.state.channels.ch3.gate;
      return soft(
        [
          ['Snare gate is on', g.on],
          ['Mode is GATE, keyed from the snare itself', g.mode === 'gate' && g.key === 'self'],
          ['Threshold between -40 and -15 dBFS', g.threshold >= -40 && g.threshold <= -15],
          ['Range -20 dB or deeper', g.range <= -20],
          ['Snare still reaching the PA (OMNI OUT 7)', ctx.gain('ch:ch3', 'out:omni7') > -40],
        ],
        [['Snare is playing (channel 3 input meter)', ctx.peak('ch.ch3.in') > -60]],
        ctx,
      );
    },
  },

  {
    id: 'mute-groups',
    level: 'intermediate',
    title: 'Mute the drums with a mute group',
    goal: 'Put the kick, snare and hi-hat in MUTE GROUP 2 and engage it, so all the drums go silent at once while the vocal keeps playing.',
    steps: [
      'Select channel 2 (Kick) and, in SELECTED CH > MUTE GROUP, press assign key 2. Do the same for channel 3 (Snare) and channel 4 (Hi-Hat).',
      'Leave every channel ON key and fader alone - the mute group does the muting.',
      'In the MASTER section, press MUTE GROUPS key 2 to engage the group.',
      'Check SIGNAL FLOW or the meters: the drums are gone from the main mix and from Wedge 3, but the vocal is untouched.',
    ],
    hints: [
      'Assigning a channel to a mute group does nothing until the group itself is engaged with its MASTER section key.',
      'The group mutes the channels including their sends, so the drum wedge falls silent too.',
      'The vocal channel must NOT be in group 2.',
    ],
    setup: (s: ConsoleState) => {
      for (const id of ['ch2', 'ch3', 'ch4']) setSend(s, id, 'mix3', -3);
    },
    check: (ctx) => {
      const drums = ['ch2', 'ch3', 'ch4'];
      const chs = ctx.state.channels;
      return soft(
        [
          ['Kick, snare and hi-hat are all assigned to mute group 2', drums.every((id) => chs[id].muteGroups.includes(2))],
          ['Mute group 2 is engaged', !!ctx.state.muteGroups[1]?.on],
          [
            'The drums are silent in the main mix (STEREO)',
            drums.every((id) => ctx.gain(`ch:${id}`, 'bus:st:out') <= NEG_INF),
          ],
          [
            'The drums are silent in Wedge 3 too',
            drums.every((id) => ctx.gain(`ch:${id}`, 'out:omni3') <= NEG_INF),
          ],
          ['The drum channels were muted by the group, not by their ON keys or faders', drums.every((id) => chs[id].on && chs[id].fader > NEG_INF)],
          ['The vocal still passes to the main mix', ctx.gain('ch:ch1', 'bus:st:out') > -40 && !chs.ch1.muteGroups.includes(2)],
        ],
        [['Vocal signal present (channel 1 post-fader)', ctx.peak('ch.ch1.post') > -60]],
        ctx,
      );
    },
  },

  {
    id: 'input-to-matrix',
    level: 'intermediate',
    title: 'Send the vocal straight to a matrix',
    goal: 'Feed a broadcast / recording feed: send the vocal channel directly to MATRIX 1 (send on, level above -20 dB) so it reaches MATRIX 1 at better than -30 dB.',
    steps: [
      'Select channel 1 (Vocal) and open SELECTED CH > ROUTING · SENDS.',
      'In the sends table find the MATRIX rows (MTX 1, MTX 2).',
      'Switch the MTX 1 send on and raise its level above -20 dB (about -6 dB is a good start).',
      'Check in SIGNAL FLOW that ch1 now reaches MATRIX 1, and with audio running watch the MATRIX 1 bus meter.',
    ],
    hints: [
      'Channels can send directly to a matrix bus, in the same way as to a mix bus; the matrix does not have to be fed from STEREO or a MIX.',
      'The send must be ON and have a level: a send at -infinity is silent even when switched on.',
      'The vocal must stay in the main mix as well - you are adding a feed, not moving the vocal.',
    ],
    check: (ctx) => {
      const s = ctx.state.channels.ch1.sends.mtx1;
      return soft(
        [
          ['MATRIX 1 send from the vocal is on', s.on],
          ['Send level above -20 dB (and not extreme)', s.level > -20 && s.level <= 6],
          ['Vocal reaches MATRIX 1 at better than -30 dB', ctx.gain('ch:ch1', 'bus:mtx1') > -30],
          ['Vocal still in the main mix', ctx.gain('ch:ch1', 'out:omni7') > -40],
        ],
        [['Signal on the MATRIX 1 bus', ctx.peak('bus.mtx1.in') > -60]],
        ctx,
      );
    },
  },

  // ============================================================ ADVANCED ====
  {
    id: 'diagnose-multiple-faults',
    level: 'advanced',
    title: 'Diagnose multiple simultaneous faults',
    goal: 'The vocal is missing from Wedge 1 due to several faults at once. Find and fix them all.',
    steps: [
      'Open SIGNAL FLOW and trace from channel 1 to OMNI OUT 1.',
      'Fix each broken connection you find: check sends, the bus master and the output patch.',
      'Re-trace after each fix - more than one thing is wrong.',
      'Stop when the vocal reaches OMNI OUT 1.',
    ],
    hints: [
      'There are three faults on this one path.',
      'One is on the channel (send), one on the bus master, one on the output patch.',
      'SIGNAL FLOW highlights the switched-off connections.',
    ],
    setup: (s: ConsoleState) => {
      setSend(s, 'ch1', 'mix1', -3, true, false);
      s.buses.mix1.on = false;
      s.outPorts.omni1.source = null;
    },
    check: (ctx) => {
      const g = ctx.gain('ch:ch1', 'out:omni1');
      const send = ctx.state.channels.ch1.sends.mix1;
      return soft(
        [
          ['Vocal send to MIX 1 on', send.on && send.level > NEG_INF],
          ['MIX 1 bus master on', ctx.state.buses.mix1.on],
          ['MIX 1 patched to an output', ctx.state.outPorts.omni1.source !== null],
          ['Vocal reaches OMNI OUT 1 (above -20 dB)', g > -20 && g <= 6],
        ],
        [['Signal at OMNI OUT 1', ctx.peak('out.omni1') > -60]],
        ctx,
      );
    },
  },

  {
    id: 'trace-iem-pair',
    level: 'advanced',
    title: 'Trace a stereo IEM pair',
    goal: 'The vocal must reach both sides of the stereo-linked IEM pair (MIX 5/6 to OMNI OUT 5/6). It currently reaches neither.',
    steps: [
      'Open the ROUTING tab and note MIX 5/6 are stereo-linked as one pair.',
      'Trace from channel 1 to OMNI OUT 5 and OMNI OUT 6 in SIGNAL FLOW.',
      'Fix the break on the shared MIX 5 master (a linked pair is governed by its left bus).',
      'Then fix the break on the right side after the bus: check the OUTPUT PATCH for OMNI OUT 6.',
    ],
    hints: [
      'In a linked pair, the odd bus (MIX 5) holds the master and sends for both sides.',
      'Check the MIX 5 master fader and the OMNI OUT 5/6 output patch.',
      'Both IEM sides must show the vocal when you are done.',
    ],
    setup: (s: ConsoleState) => {
      s.pairLinked.mix56 = true;
      setSend(s, 'ch1', 'mix5', -3);
      s.buses.mix5.fader = NEG_INF;
      s.outPorts.omni6.source = null;
    },
    check: (ctx) => {
      const left = ctx.gain('ch:ch1', 'out:omni5');
      const right = ctx.gain('ch:ch1', 'out:omni6');
      return soft(
        [
          ['MIX 5/6 stereo-linked', ctx.state.pairLinked.mix56],
          ['IEM L (OMNI OUT 5) receives the vocal', left > -20 && left <= 6],
          ['IEM R (OMNI OUT 6) receives the vocal', right > -20 && right <= 6],
        ],
        [
          ['Signal at OMNI OUT 5', ctx.peak('out.omni5') > -60],
          ['Signal at OMNI OUT 6', ctx.peak('out.omni6') > -60],
        ],
        ctx,
      );
    },
  },

  {
    id: 'post-fader-fx-send',
    level: 'advanced',
    title: 'Post-fader effect sends',
    goal: 'Make the vocal\'s FX 1 send post-fader so the reverb follows the vocal fader.',
    steps: [
      'Select channel 1 and open SELECTED CH > ROUTING.',
      'Find the FX 1 send and switch it from PRE to POST.',
      'Move the channel 1 fader and watch the FX 1 bus meter follow it.',
      'Confirm the send is still above -30 dB at the FX 1 rack.',
    ],
    hints: [
      'Effects are normally post-fader so a muted or faded-down vocal does not leave a reverb tail hanging.',
      'The PRE/POST switch is next to the send.',
      'Use SIGNAL FLOW to see where the send taps the channel.',
    ],
    setup: (s: ConsoleState) => {
      setSend(s, 'ch1', 'fx1', -6, true);
    },
    check: (ctx) => {
      const send = ctx.state.channels.ch1.sends.fx1;
      const g = ctx.gain('ch:ch1', 'fx:1');
      return soft(
        [
          ['FX 1 send is switched on', send.on],
          ['FX 1 send is post-fader', !send.pre],
          ['Vocal reaches FX 1 (above -30 dB)', g > -30 && g <= 6],
        ],
        [['Reverb output has signal', ctx.peak('fx.1.out') > -70]],
        ctx,
      );
    },
  },

  {
    id: 'clipping-and-gain-staging',
    level: 'advanced',
    title: 'Diagnose clipping and fix the gain staging',
    goal: 'Clean up a clipping input and an over-hot main bus, with the channel fader back in a normal range.',
    steps: [
      'Press POWER and PLAY ALL. Watch INPUT 1 and the STEREO master meter hit the top.',
      'Lower the INPUT 1 HA GAIN (I/O PATCH > INPUT SOCKETS) until peaks are below -3 dBFS.',
      'Raise channel 1\'s fader back to a normal position (above -15 dB).',
      'Bring the STEREO master down from +10 until its meter peaks below -1 dBFS.',
    ],
    hints: [
      'Fix gain at the source first, then the fader, then the master.',
      'Clipping at the input cannot be repaired later in the chain.',
      'Aim for input peaks around -12 dBFS and a master that never touches the top.',
    ],
    setup: (s: ConsoleState) => {
      s.ports.in1.gain = 34;
      s.channels.ch1.fader = -25;
      s.buses.st.fader = 10;
    },
    check: (ctx) =>
      hard(
        [['Channel 1 fader back above -15 dB', ctx.state.channels.ch1.fader > -15 && ctx.state.channels.ch1.fader <= 5]],
        (c) => {
          const pin = c.peak('port.in1');
          const pst = c.peak('bus.st.out');
          return [
            ['The vocal player is playing', c.playing(0)],
            ['INPUT 1 peaks below -3 dBFS (and present)', pin > -60 && pin < -3],
            ['STEREO master peaks below -1 dBFS (and present)', pst > -60 && pst < -1],
          ];
        },
        ctx,
      ),
  },

  {
    id: 'complete-small-event',
    level: 'advanced',
    title: 'Set up a complete small live event',
    goal: 'Build a working show: PA for the whole band, a vocal-heavy Wedge 1, drums in Wedge 3, and reverb on the vocal in the PA only.',
    steps: [
      'Assign channels 1-6 and ST IN to STEREO and patch STEREO L/R to OMNI OUT 7/8 (I/O PATCH).',
      'Build Wedge 1 on MIX 1: vocal pre-fader and at least 6 dB above everything else, and patch MIX 1 to OMNI OUT 1.',
      'Build Wedge 3 on MIX 3: kick, snare and hi-hat, and patch MIX 3 to OMNI OUT 3.',
      'Add reverb on the vocal: FX 1 send up, FX1 RTN on and assigned to STEREO, and keep the reverb out of the wedges.',
      'Play the band and check each output on the LISTEN selector of I/O PATCH.',
    ],
    hints: [
      'Work through the list one output at a time and re-check with SIGNAL FLOW.',
      'The FX1 RTN channel should go to STEREO only - no sends to the mix buses.',
      'Wedge 1 should contain mostly the vocal: keep other sends 6 dB or more below it.',
    ],
    setup: (s: ConsoleState) => {
      for (const id of ['ch1', 'ch2', 'ch3', 'ch4', 'ch5', 'ch6', 'stin']) s.channels[id].toSt = false;
      s.channels.fxr1.toSt = false;
      for (const id of ['omni1', 'omni3', 'omni7', 'omni8']) s.outPorts[id].source = null;
    },
    check: (ctx) => {
      const band = ['ch1', 'ch2', 'ch3', 'ch4', 'ch5', 'ch6', 'stin'];
      const foh = band.every((id) => ctx.gain(`ch:${id}`, 'out:omni7') > -40 && ctx.gain(`ch:${id}`, 'out:omni8') > -40);
      const patchedFoh = ctx.state.outPorts.omni7.source === 'st_l' && ctx.state.outPorts.omni8.source === 'st_r';
      const gv = ctx.gain('ch:ch1', 'out:omni1');
      const others = ['ch2', 'ch3', 'ch4', 'ch5', 'ch6', 'stin'];
      const heavy = gv > -20 && gv <= 6 && others.every((id) => ctx.gain(`ch:${id}`, 'out:omni1') <= gv - 6);
      const drums = ['ch2', 'ch3', 'ch4'].every((id) => ctx.gain(`ch:${id}`, 'out:omni3') > -30);
      const rev = ctx.gain('ch:ch1', 'ch:fxr1') > -30;
      const revFoh = ctx.state.channels.fxr1.toSt && ctx.gain('ch:fxr1', 'out:omni7') > -30;
      const revDry = ctx.gain('ch:fxr1', 'out:omni1') < -40 && ctx.gain('ch:fxr1', 'out:omni3') < -40;
      return soft(
        [
          ['Channels 1-6 and ST IN in the main mix', foh],
          ['STEREO L/R patched to OMNI OUT 7/8', patchedFoh],
          ['Wedge 1: MIX 1 patched, vocal-heavy and pre-fader', ctx.state.outPorts.omni1.source === 'mix1' && heavy && ctx.state.channels.ch1.sends.mix1.pre],
          ['Wedge 3: MIX 3 patched with kick, snare and hi-hat', ctx.state.outPorts.omni3.source === 'mix3' && drums],
          ['Vocal feeding the reverb', rev],
          ['Reverb return reaching the PA', revFoh],
          ['Reverb kept out of the wedges', revDry],
        ],
        [
          ['Signal on the STEREO master', ctx.peak('bus.st.out') > -60],
          ['Signal at OMNI OUT 1', ctx.peak('out.omni1') > -60],
          ['Signal at OMNI OUT 3', ctx.peak('out.omni3') > -60],
        ],
        ctx,
      );
    },
  },

  {
    id: 'ducking-keys',
    level: 'advanced',
    title: 'Duck the keys under the vocal',
    goal: 'Use the ducker on the keys (channel 6): Dynamics 1 on, mode DUCKER, key from channel 1 (the vocal), range between -20 and -6 dB.',
    steps: [
      'Select channel 6 (Keys) and open SELECTED CH > DYNAMICS 1 · GATE/DUCKER. (On the DM3 Dynamics 1 exists on CH 1-16 only, not on ST IN, so the ducked source has to be a mono channel.)',
      'Change the mode from GATE to DUCKER and switch Dynamics 1 ON.',
      'Set the KEY source to channel 1 (Vocal) so the ducker listens to the singer rather than the keys themselves.',
      'Set the RANGE between -20 and -6 dB, the THRESHOLD around the level of the vocal, and a slowish DECAY (300 ms or more) so the keys swell back smoothly.',
      'Play the band and watch the ducker meter dip whenever the vocal is loud.',
    ],
    hints: [
      'A ducker lowers its own channel by RANGE while the key signal is above the threshold - the opposite of a gate.',
      'KEY = SELF would duck the keys by their own level, which is not what we want. Pick channel 1.',
      'RANGE is how far the keys dip: -6 dB is subtle, -20 dB is dramatic.',
    ],
    check: (ctx) => {
      const g = ctx.state.channels.ch6.gate;
      return soft(
        [
          ['Keys dynamics 1 is on', g.on],
          ['Mode is DUCKER', g.mode === 'ducker'],
          ['Keyed from channel 1 (the vocal)', g.key === 'ch1'],
          ['Range between -20 and -6 dB', g.range >= -20 && g.range <= -6],
          ['Keys still reaching the PA (OMNI OUT 7)', ctx.gain('ch:ch6', 'out:omni7') > -40],
        ],
        [
          ['Keys are playing', ctx.peak('ch.ch6.in') > -60],
          ['Vocal key signal is present (channel 1 input meter)', ctx.peak('ch.ch1.in') > -60],
        ],
        ctx,
      );
    },
  },

  {
    id: 'ring-out-with-osc',
    level: 'advanced',
    title: 'Ring out a wedge with the oscillator',
    goal: 'Use the console oscillator to ring out Wedge 1: pink noise on and assigned to MIX 1 only, with the MIX 1 graphic EQ on and at least one band cut by 3 dB or more.',
    steps: [
      'Open the MASTER section and find the OSCILLATOR block. Set the type to PINK noise and a modest level (-20 dBFS is plenty).',
      'Assign the oscillator to MIX 1 only (press the MIX 1 assign key, and make sure no other bus is lit), then switch the oscillator ON.',
      'Select the MIX 1 bus and open its GEQ (31 band). Switch the GEQ ON.',
      'Listen to Wedge 1 (LISTEN selector on I/O PATCH) for a ringing or harsh frequency, and pull that band down by at least 3 dB.',
      'Switch the oscillator OFF when you are finished.',
    ],
    hints: [
      'Ringing out means finding the frequencies where the wedge + mic feeds back first, and notching them out on the monitor GEQ.',
      'Assign the oscillator only to the bus you are working on - anything else would put noise in the PA or in other wedges.',
      'Keep the oscillator level low; pink noise through a wedge is very fatiguing.',
    ],
    check: (ctx) => {
      const o = ctx.state.osc;
      const mix1 = ctx.state.buses.mix1;
      const cut = Math.min(...mix1.geq);
      return soft(
        [
          ['Oscillator is on and set to pink noise', o.on && o.type === 'pink'],
          ['Oscillator assigned to MIX 1 only', o.assign.length === 1 && o.assign[0] === 'mix1'],
          ['Oscillator level is moderate (-10 dBFS or lower)', o.level <= -10],
          ['Oscillator reaches Wedge 1 (OMNI OUT 1) and nothing else', ctx.gain('osc', 'out:omni1') > -50 && ctx.gain('osc', 'out:omni7') < -40],
          ['MIX 1 graphic EQ is on', mix1.geqOn],
          ['At least one GEQ band cut by 3 dB or more', cut <= -3],
        ],
        [['Oscillator signal present (meter)', ctx.peak('osc') > -70]],
        ctx,
      );
    },
  },

  {
    id: 'delay-speaker-alignment',
    level: 'advanced',
    title: 'Time-align the delay speakers',
    goal: 'Feed MATRIX 1 from STEREO (send above -20 dB), patch MATRIX 1 to OMNI OUT 5 and set its output delay between 20 and 60 ms.',
    steps: [
      'Select the STEREO bus and open its MATRIX sends. Switch the MTX 1 send on and raise it above -20 dB (0 dB is typical).',
      'Open I/O PATCH > OUTPUT PATCH and select MATRIX 1 as the source of OMNI OUT 5 (replacing the IEM mix).',
      'Select MATRIX 1 and open OUTPUT DELAY. Switch the delay ON.',
      'Set the delay between 20 and 60 ms: sound travels about 1 m every 3 ms, so 10 m between the main PA and the rear speakers is about 30 ms.',
      'Play the band and check OMNI OUT 5 carries the mix.',
    ],
    hints: [
      'Delay (fill) speakers must be delayed so their sound arrives together with the main PA sound reaching the same listeners.',
      'The delay belongs on the matrix output that feeds those speakers, not on every channel.',
      'Too little delay and the rear speakers pull the sound image to the back; too much and the audience hears an echo.',
    ],
    check: (ctx) => {
      const send = ctx.state.buses.st.mtxSends.mtx1;
      const m = ctx.state.buses.mtx1;
      return soft(
        [
          ['STEREO feeds MATRIX 1 (send on, above -20 dB)', !!send && send.on && send.level > -20 && send.level <= 6],
          ['MATRIX 1 patched to OMNI OUT 5', ctx.state.outPorts.omni5.source === 'mtx1'],
          ['Main mix reaches OMNI OUT 5', ctx.gain('ch:ch1', 'out:omni5') > -40],
          ['MATRIX 1 output delay is on and between 20 and 60 ms', m.delayOn && m.delayMs >= 20 && m.delayMs <= 60],
          ['PA outputs still carry the mix', ctx.gain('ch:ch1', 'out:omni7') > -40],
        ],
        [['Signal at OMNI OUT 5', ctx.peak('out.omni5') > -60]],
        ctx,
      );
    },
  },
];
