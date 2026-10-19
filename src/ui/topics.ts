// Explanations shown in the Coach panel (learning mode) when a control is used.

export const TOPICS: Record<string, { title: string; text: string }> = {
  'channel-fader': {
    title: 'Channel fader',
    text:
      'Sets how much of this channel goes to the STEREO bus and to every POST-fader send. It does not change PRE-fader sends, so moving it does not disturb monitor mixes that use pre-fader sends. Compare: a send level sets one channel\'s contribution to one bus; a bus master fader sets the overall level of a whole bus.',
  },
  'send-level': {
    title: 'Send level',
    text:
      'A send sets how much of ONE channel feeds ONE mix bus. Each mix bus has its own independent set of send levels, which is why a monitor mix can have a loud vocal while the main (STEREO) mix does not. A send only fills the bus: the bus master and output patch still decide where the bus goes.',
  },
  'bus-master': {
    title: 'Bus master fader',
    text:
      'The bus master scales the whole mix bus after all channel sends are summed. Turning it down lowers everything in that mix equally without changing the balance between sources. The bus ON key mutes the entire mix. If a bus meter moves but the output is silent, check this master, its ON key and the output patch.',
  },
  sof: {
    title: 'Sends on Fader',
    text:
      'With Sends on Fader active, each channel fader temporarily controls that channel\'s SEND LEVEL to the selected bus instead of its main channel level. The fader caps change color and the selected bus is shown in the master section. Switch buses to edit a different monitor mix; turn it off to get normal faders back. The bus master stays independently controllable.',
  },
  'ha-gain': {
    title: 'Head amp (analog) gain',
    text:
      'Analog preamp gain at the INPUT socket, before the A/D converter. Set it so peaks sit around -18 to -6 dBFS on the port meter. Too much gain clips the converter at 0 dBFS: that distortion is baked in and no fader downstream can remove it.',
  },
  'digital-gain': {
    title: 'Digital gain (trim)',
    text:
      'Digital gain applied inside the channel after the converter. Useful for digital sources (USB/Dante) that have no preamp, or for fine trim. It cannot fix clipping that already happened at the input.',
  },
  polarity: {
    title: 'Polarity (Ø)',
    text: 'Inverts the waveform. Used to fix cancellation between two mics on the same source (e.g. snare top/bottom). On a single source alone it sounds the same.',
  },
  hpf: {
    title: 'High-pass filter',
    text: 'Removes low frequencies below the cutoff (12 dB/octave in this simulator). Use it on vocals and most non-bass sources to reduce rumble, handling noise and mud.',
  },
  eq: {
    title: '4-band parametric EQ',
    text: 'LOW and HIGH are shelving bands; the two middle bands are peaking bands with adjustable Q (width). Cut problem frequencies narrowly, boost broadly. EQ OFF bypasses all four bands.',
  },
  comp: {
    title: 'Compressor',
    text:
      'Above the THRESHOLD, level increases are reduced by the RATIO. ATTACK/RELEASE set how fast it reacts. The GR meter shows how many dB are being removed right now. MAKEUP restores level afterwards. Heavy gain reduction (more than ~10 dB constantly) usually means the threshold is too low.',
  },
  pan: {
    title: 'Pan',
    text: 'Positions a mono channel between left and right of the STEREO bus (constant-power law, -3 dB at center). On stereo channels it acts as balance.',
  },
  'st-assign': {
    title: 'ST assign',
    text: 'Routes the channel (post-fader, post-pan) to the STEREO bus. With it off, the channel can still feed mix buses via sends but will not be in the main mix.',
  },
  'on-key': {
    title: 'ON key (mute)',
    text:
      'Yamaha consoles use an ON key: lit = channel live, dark = muted. Turning a channel off silences its STEREO assign and ALL its sends, including pre-fader sends. The PRE-fader meter still shows the input so you can see signal arriving.',
  },
  cue: {
    title: 'CUE (solo)',
    text: 'Sends the channel to the CUE bus so you can listen on PHONES without changing any mix. PFL listens before the fader; AFL listens after the fader and pan. While any CUE is active, the monitor carries the cue signal.',
  },
  'pre-post': {
    title: 'PRE / POST fader sends',
    text:
      'PRE: the send is taken before the channel fader, so FOH fader moves do not change the monitor mix (typical for wedges/IEMs). POST: the send follows the fader (typical for effects, so reverb fades with the dry signal). Both are after the ON key.',
  },
  'output-patch': {
    title: 'Output patch',
    text:
      'The output patch decides which internal signal (STEREO L/R, a MIX bus, MATRIX, MONITOR, a direct out) appears on each physical socket. It is NOT a send: a send puts a channel into a bus; the patch puts a bus onto a socket. A bus can be patched to several sockets, but each socket takes exactly one source.',
  },
  'input-patch': {
    title: 'Input patch',
    text: 'Chooses which input socket (INPUT 1-16, USB, Dante) feeds a channel. If the wrong socket is patched, the channel shows nothing even though the source meter is moving.',
  },
  listen: {
    title: 'Listening position (browser output)',
    text:
      'Your speakers/headphones are "plugged into" output sockets. You only hear what physically reaches those sockets, exactly like standing in front of a wedge or the PA. Choose PHONES to hear the console monitor/cue bus instead.',
  },
  matrix: {
    title: 'Matrix',
    text: 'Matrix buses are fed from the STEREO and MIX buses (not directly from channels in this simulator). Use them for delay speakers, recording feeds or zone outputs that need their own blend of existing mixes.',
  },
  dca: {
    title: 'DCA groups',
    text: 'A DCA is a remote control for the faders of its member channels. Moving the DCA offsets their fader levels (and therefore post-fader sends); muting it mutes all members. Pre-fader sends are not affected by the DCA level, but are muted by DCA mute in this simulator.',
  },
  'fx-send': {
    title: 'FX send',
    text: 'Feeds a channel into an FX bus, which drives the internal effect rack. The effect is only audible once its FX RTN channel is ON, has its fader up, and is routed to STEREO (or a mix bus).',
  },
  'fx-return': {
    title: 'FX return channel',
    text: 'The effect output comes back on an FX RTN channel, which behaves like a stereo input channel: it has ON, fader, ST assign and its own mix sends (e.g. reverb in the vocalist\'s wedge).',
  },
  'stereo-link': {
    title: 'Stereo-linked mix pair',
    text: 'Two adjacent mix buses can be linked as a stereo pair (e.g. for in-ear monitors). The odd bus sets the controls, each send gets a pan, and the pair outputs left/right on two sockets.',
  },
  clip: {
    title: 'Clipping stages',
    text:
      'Converters clip: the input A/D (port meter) and the output D/A (output socket meter) cannot exceed 0 dBFS, so overloading them distorts. Inside the console the mix engine is floating point: a channel or bus meter can show OVER without distortion, but whatever is downstream (an output socket) will clip if it stays over.',
  },
  monitor: {
    title: 'Monitor / Phones',
    text: 'The monitor bus carries the selected source (normally STEREO) or the CUE bus while any cue is active. It feeds PHONES and can be patched to OMNI outputs for an engineer\'s wedge.',
  },
  loop: {
    title: 'Loop cable',
    text: 'A cable from an output socket back into an input socket. If that input is routed back to the same output, you create a feedback loop: signal circulates and builds into a howl. Loops are flagged in red.',
  },
  scene: {
    title: 'Scenes',
    text: 'A scene stores the console settings (patch, gains, processing, faders, sends). It does not store what is plugged into the sockets or the audio files. Recall restores every stored parameter at once.',
  },
  meters: {
    title: 'Meter points',
    text: 'IN = after head amp/digital gain; PRE = after EQ and dynamics, before ON and fader; POST = after the fader. Bus IN = the summed sends; bus OUT = after the bus master. Output meters show what actually leaves the socket.',
  },
  'direct-out': {
    title: 'Direct out',
    text: 'A copy of one channel (pre-fader, post-ON) that can be patched to any output, typically USB for multitrack recording.',
  },
  gate: {
    title: 'Gate (Dynamics 1)',
    text: 'A gate turns the channel down by RANGE whenever the signal falls below THRESHOLD, cutting spill and noise between notes or drum hits. ATTACK sets how fast it opens, HOLD keeps it open briefly, DECAY sets how fast it closes. Too high a threshold chops the start and end of words.',
  },
  ducker: {
    title: 'Ducker (Dynamics 1)',
    text: 'A ducker turns this channel DOWN by RANGE while its KEY IN source is above THRESHOLD — e.g. background music dips automatically whenever the announcer (key) talks. The key is another channel, taken after its digital gain.',
  },
  delay: {
    title: 'Delay (input / output)',
    text: 'Input delay time-aligns sources (e.g. a mic and a DI on the same instrument). Output delay aligns delay/fill speakers with the main PA: sound travels about 34 cm per millisecond, so a speaker 10 m further out needs about 29 ms.',
  },
  'mute-group': {
    title: 'Mute groups',
    text: 'A mute group mutes all of its member channels and buses with one key (e.g. all band inputs during a speech). Members are assigned on the channel / bus screen. A forgotten engaged mute group is a classic "why is nothing working" fault.',
  },
  geq: {
    title: 'Graphic EQ (31 band)',
    text: 'A 1/3-octave graphic EQ inserted on an output bus. Used to tame room resonances and to "ring out" wedges: raise the gain until feedback starts, find the frequency, and cut that band a few dB.',
  },
  phantom: {
    title: '+48V phantom power',
    text: 'Condenser microphones need +48V phantom power from the console input to work; without it they produce no signal at all. Dynamic mics do not need it. Phantom into unbalanced line devices can damage them, so only switch it on where it is needed.',
  },
  talkback: {
    title: 'Talkback',
    text: 'Talkback routes the engineer\'s mic straight to selected buses (usually the monitor mixes) so the engineer can speak to performers. It bypasses the channel faders. A latched talkback key leaks the engineer\'s chatter into every wedge.',
  },
  osc: {
    title: 'Oscillator',
    text: 'The internal oscillator injects a test signal (sine, pink noise or burst noise) directly into selected buses — for checking lines, levels and speaker coverage, or ringing out wedges. Always switch it off afterwards.',
  },
  'recall-safe': {
    title: 'Recall Safe',
    text: 'Channels/buses marked Recall Safe keep their current settings when a scene is recalled — e.g. protect the presenter\'s mic or the PA processing while changing band scenes.',
  },
  focus: {
    title: 'Scene Focus',
    text: 'Focus limits what a particular scene recalls. A scene with only "Faders" focused will recall levels and mutes but leave patching, gains and EQ alone.',
  },
  'device-kind': {
    title: 'Device type',
    text: 'Line sources (players, keyboards) arrive hot and need little gain. Dynamic mics are about 30 dB quieter and need more head-amp gain. Condenser mics also need +48V phantom power on their input socket.',
  },
  'output-device': {
    title: 'Audio output device',
    text: 'Choose which audio interface the browser plays through. With a multichannel interface you can map OMNI OUT 1-8 to its physical outputs 1-8 and drive real speakers or wedges from the simulator.',
  },
};
