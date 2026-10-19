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
};
