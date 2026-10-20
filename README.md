# DM3 Console Simulator

This is a browser-based training simulator modeled on the **Yamaha DM3** compact digital mixer. You can use it to practise signal flow, routing, monitor mixes, output patching, gain staging and troubleshooting, with real audio processing. You do not need the hardware.

It is not affiliated with Yamaha. It uses no Yamaha assets, and the demo band is procedurally synthesized.

## Open it

**Online:** https://jayshauncoleman.github.io/Digital-Console-Simulator/

It is deployed automatically from `master` by GitHub Actions (`.github/workflows/pages.yml`). It works on desktop, tablet and phone, and it can be installed as an app with "Add to Home Screen" / "Install app", after which it also works offline.

> One-time setup for the repository owner: **Settings → Pages → Build and deployment → Source: GitHub Actions**. Then re-run the "Deploy to GitHub Pages" workflow, or push any commit. The repository must be public, unless your GitHub plan includes Pages for private repositories.

**On a phone:**
- The console shows one section at a time; switch with **FADERS / SCREENS / MASTER** at the bottom.
- Rotate to landscape for more faders.
- On iPhone, audio plays even with the silent switch on (iOS 16.4+). Tapping a channel name opens its processing.

## Run it locally

You need Node.js 20 or newer.

```bash
npm install
npm run dev          # http://localhost:5173  (development)
# or
npm run build && npm run preview   # http://localhost:4173  (production build)
```

1. Open the URL in Chrome, Edge, Firefox or Safari (desktop or tablet).
2. Press **POWER** in the top bar. Browsers only start audio after a click.
3. Open **SOURCES** and press **▶ PLAY ALL** to start the demo band.
4. You hear the **FOH PA**, which is OMNI OUT 7/8. Change what you listen to with **MONITOR / LISTEN** in the master section.

### Microphone
- Go to **SOURCES → CONNECT MIC** and allow the permission prompt.
- The mic is cabled into **INPUT 8 → CH 8 "Mic"** by default. To move it, use **I/O PATCH → INPUT SOCKETS**.
- Microphone access needs `https://` or `http://localhost`. Use headphones, because a live mic on speakers can cause real acoustic feedback.
- Browser echo cancellation, noise suppression and AGC are turned off, so you get the raw signal.

### Audio files
- Go to **SOURCES → LOAD FILE…** on any of the 8 players. It accepts WAV, MP3, OGG, M4A or FLAC, whatever your browser can decode.
- Each player is a stage device. Cable it into an input socket on **I/O PATCH → INPUT SOCKETS**, and choose L, R or L+R for stereo files.
- Loaded files stay in memory only, so you need to load them again after a page reload.

### Test signals
**SOURCES → SIGNAL GENERATOR** offers sine (with frequency control), pink noise, white noise, an impulse train and a log sweep, all with a level control. It is cabled into **INPUT 16 → CH 16 "Gen"** by default.

## Screens

| Screen | What it does |
|---|---|
| Channel strips (bottom) | Each strip has the input patch, name, ST assign, pan, CUE, PRE + POST meters, fader, ON and SEL. Layers are ALL / 1-8 / 9-16 / ST IN-FX / MIX-MTX (bus masters). |
| Master section (right) | **Sends on Fader** (MIX 1-6, FX 1-2, with the selected bus master), the STEREO master, the monitor/cue controls (PFL/AFL), the browser listening position, volume and the safety limiter. |
| OVERVIEW | All channels, buses and output sockets at a glance. |
| SELECTED CH | Channel processing: input patch, HA gain, digital gain, Ø, HPF, 4-band PEQ with a curve, compressor with transfer curve and GR meter, ST/pan/fader, mute-group assign, and a sends table with ON/level/PRE-POST/pan. In learning mode it adds a live gain-staging table. Selecting a bus opens **bus processing** instead: master, EQ, compressor, stereo link, matrix sends, and where the bus is patched. |
| ROUTING | Channel × bus assignment matrix. Click a cell to toggle it, use the wheel for level, and shift-click to switch pre/post. It also shows bus masters and output patching. |
| I/O PATCH | Output patch grid (sources × OMNI outs) plus per-socket tables for OMNI, USB and Dante. Each socket shows its status (UNPATCHED / DUPLICATE), whether signal is present, its attenuator and its meter. Sources that are not routable are listed but disabled, with the reason. The input sockets table shows what is plugged in, the HA gain and the meter, and lets you add a loop cable. |
| FX RACK | 2 racks (hall/plate reverb, stereo/mono delay) with live status of send → bus → rack → return. |
| SOURCES | Players, demo band, microphone and generator. |
| SCENES | Store, recall, delete, export and import scenes. Reset the console or the stage wiring. Switch between DM3 and DM3 Standard. |
| SIGNAL FLOW | A dynamic trace of the selected channel or bus to every destination. Each block has a live signal LED, breaks are drawn in red with the reason, and clicking a block opens its controls. |
| TRAINING | 20 fault-finding scenarios (e.g. phantom off on a condenser, an engaged mute group, a gate chopping the vocal, a talkback mic channel left open, the oscillator left on, a ducker on the wrong key, misaligned delay speakers, feedback loops, wrong patches) plus a random fault. Each has hints, "reveal signal path" and "reveal solution", and it detects automatically when you have fixed it. |
| ACADEMY | 28 exercises across beginner, intermediate and advanced, with live checks. Progress is tracked and exercises can be repeated. |

**Learning mode** is on by default. Touch any control and the coach panel explains it, including channel fader vs send level vs bus master, pre vs post, output patch vs send, and the clipping stages.

## How the routing engine works

There is one source of truth: a Zustand store holding the **ConsoleState** (everything a scene stores) and the **RigState** (the physical stage: what is cabled into each socket, and which sockets your speakers are plugged into).

Two consumers read the same state:

1. **The audio engine** (`src/engine/AudioEngine.ts`) builds a real Web Audio graph:

   ```
   device → INPUT socket (HA gain → A/D clip at 0 dBFS) → input patch → channel:
     digital gain/Ø → [HPF] → [4-band EQ] → [DYN1 gate] → [DYN2 comp] → PRE meter → ON → fader → POST meter → pan → ST assign → STEREO bus
     pre (after ON) / post-fader sends → MIX 1-6 (mono or stereo-linked) / FX 1-2
   bus: sum → [EQ] → [COMP] → ON → master → (matrix sends) → output patch source
   FX bus → FX rack → FX RTN channel (a normal stereo channel)
   output patch → OMNI / USB / Dante socket (ATT → D/A clip at 0 dBFS)
   listening position: chosen sockets (or PHONES) → browser volume → protective limiter → ceiling at -0.9 dBFS → speakers
   ```

   Every switch, send and patch is a real connection or gain. A meter moving somewhere does not make audio appear anywhere else. Bypassed stages are physically rewired out of the chain. Feedback loops through loop cables are real cycles, bounded by the converter clippers and flagged in the UI.

2. **The routing resolver** (`src/engine/routing.ts`) builds a directed graph of the same connections with nominal gains. The Signal Flow view, the troubleshooting checks and the break explanations ("send to MIX 1 is switched off", "bus master ON is off", "not patched to any socket") come from this graph. Loop detection also uses it.

**Meters** are computed from the audio itself. `AnalyserNode`s sit at every tap point (device, socket, channel IN/PRE/POST, bus IN/OUT, FX out, output sockets, browser output), and the compressor GR comes from `DynamicsCompressorNode.reduction`. Meters use peak ballistics (26 dB/s release), a 1.5 s peak hold and a clip latch.

**Hardware vs engine**: the DM3-specific facts live in `src/model/dm3.ts`: channel, bus and port counts, patch rules, gain ranges, and which sources are not patchable. The engine and the UI are generic and read that model.

## DM3 configuration modeled

A fact-check in this release cross-checked these against Yamaha's DM3 data sheet, reference-manual pages and published reviews (Sound On Sound, AudioTechnology). Yamaha's own sites could only be reached through search summaries, so the checked items count as cross-checked rather than read first-hand.

**Confirmed:**
- 22 input channels: 16 mono, 1 stereo (ST IN) and 2 stereo FX returns.
- 1 stereo bus, 6 mix buses (odd/even stereo link), 2 FX buses and 2 matrices (which also take input channels), plus a cue bus.
- 16 analog inputs (12 XLR + 4 combo) and 8 OMNI XLR outputs.
- USB audio 18 × 18. Dante 16 × 16 on the DM3 only.
- 6 mute groups, 2 FX racks (18 effect types on the hardware) and 200 scenes with Recall Safe.
- Oscillator: sine, pink noise or burst noise.
- Digital gain -24 to +24 dB.
- HPF 20–600 Hz on CH 1-16 only.
- PEQ 4 band: LOW shelf/bell, HIGH LPF/shelf/bell.
- Dynamics 1 = gate/ducking on CH 1-16 only, with key-in from self pre-EQ, self post-EQ, another channel or a MIX bus.
- Dynamics 2 = compressor with key-in self pre/post-EQ and a 1-knob mode (attack 25 ms, release 296 ms, knee Med).
- GEQ on STEREO + MIX 1-6.
- Input/output delay.
- Meter points: input PRE HPF / PRE FADER / POST ON; output PRE EQ / PRE FADER / POST ON. Peak hold is global.
- Per-mix-bus pre-send point (pre-EQ / pre-fader).

**Not on the DM3, so removed from the simulator:**
- DCA groups (data sheet: "DCA Group: No").
- A dedicated talkback. Use an ordinary mic channel sent to the wedges.
- Scene Focus.

**Unverified** (the simulator uses reasonable values):
- Head-amp range -6 to +66 dB.
- EQ and dynamics numeric ranges.
- HPF slope (12 dB/oct here).
- Effect algorithm names.
- Full processing order.
- Meter OVER level and ballistics.

## Implemented vs not implemented

**Implemented and working on real audio:**
- **Inputs:** browser mic (stereo interfaces: L/R picks input 1/2), 8 file players (files saved in IndexedDB so they survive a reload), and a test generator (sine / pink / white / impulse / sweep / burst).
- **Device types:** line, dynamic mic (30 dB lower) and condenser mic (needs **+48V phantom power** on its socket, otherwise silent).
- **Channel processing:**
  - Input patch, HA gain with A/D clipping, digital gain (±24 dB), polarity, HPF on CH 1-16.
  - 4-band PEQ: LOW shelf/bell, HIGH LPF/shelf/bell.
  - **Dynamics 1 (CH 1-16):** gate or ducker (AudioWorklet) with threshold, range, attack, hold and decay. Key-in can be self pre-EQ, self post-EQ, another channel or a MIX bus. It has an attenuation meter.
  - **Dynamics 2:** a custom AudioWorklet compressor:
    - Feed-forward, soft knee, peak detector, stereo-linked.
    - Threshold, ratio, attack, release, knee and out gain.
    - Key-in self pre-EQ or post-EQ.
    - 1-knob mode.
    - No hidden make-up gain.
    - Its gain-reduction meter matches the static curve shown on screen.
  - **Input delay** 0–1000 ms.
- **Channel → bus routing:**
  - ON, fader, pan and ST assign.
  - Mix, FX and **matrix** sends with pre/post and pan on linked pairs. The pre-send point is selectable per mix bus: **PRE FADER** or **PRE EQ**.
  - Stereo-linked mix and matrix pairs.
- **Buses:**
  - EQ, compressor, **31-band GEQ** (STEREO + MIX 1-6), **output delay** 0–1000 ms, and master.
  - Bus → matrix sends.
- **Mute groups:** 6, covering channels and buses.
- **Meters:** selectable meter points, as on the DM3 METER screen, with a global **PEAK HOLD**.
- **Internal oscillator:** sine, pink or burst noise, assigned straight to buses.
- **Monitoring:** CUE (PFL/AFL) with the monitor interrupting to the cue, PHONES and monitor source.
- **Outputs:** output patch with attenuation and D/A clipping, plus direct outs.
- **Browser output device selection** (Chrome/Edge). **Multichannel mode** sends OMNI OUT 1-8 to the outputs of an audio interface with more than 2 outputs, so the simulator can drive real wedges.
- **FX racks**, 10 algorithm families: hall, room and plate reverb, early reflections, ping-pong and mono delay (with **tap tempo**), chorus, flanger, phaser, tremolo.
- **Scenes:** up to 200, with **Recall Safe** per channel and bus, export/import, autosave, and automatic upgrade of saves from older versions.
- **Learning tools:** signal-flow trace (now showing gate/delay and phantom faults), 20 troubleshooting scenarios, 29 academy exercises, and the gain-staging panel.
- **Phones and tablets:** single-pane phone layout with bottom navigation, compact landscape strips, touch-sized controls, an installable PWA and offline use.

**Not simulated:**
- Real **USB-audio / Dante streaming** into the console's ports. A browser cannot be a Dante device or a class-compliant USB mixer. The closest working alternatives are the output-device and multichannel mode above, and a multichannel interface as the mic input.
- Yamaha's exact algorithms and full 18-type effect library. The simulator has 10 families.
- Channel inserts and a DAW remote.
- Oscillator → individual output routing. The oscillator goes to buses only.
- Insert points (firmware V2.00) and the 8-channel automixer (V3.00).
- 1-knob EQ modes.
- Pad switches. No manual pad is documented for the DM3.
- Remote/Editor connectivity and user-level security.

## Known differences from a physical DM3

- The browser's sample rate (44.1/48 kHz) is used instead of the DM3's 96 kHz engine.
- Latency depends on your audio device.
- Processing is modeled, not cloned. The EQ uses Web Audio biquads. The compressor and gate are custom worklets with textbook curves. Yamaha's exact curves, numeric ranges and 1-knob mapping are not published.
- Meter scale and ballistics are approximations of the DM3's.
- The UI is inspired by the DM3's workflow (layers, Sends on Fader, Selected Channel) but is not a replica of its touchscreen.
- In this simulator, FX buses feed only the internal racks and cannot be patched to outputs.
- The defaults (channel names, output patch, faders up on the demo channels) form a training scene. They are not Yamaha's initial data.
- Mute groups and the channel ON key also mute pre-fader sends in the simulator. Whether ON affects pre-fader sends on the DM3 is unverified.
- **Processing order** in the simulator is HPF → EQ → Dynamics 1 → Dynamics 2 → delay. Yamaha documents only the meter points, not the full order.

## Tests

```bash
npm test                         # routing / training content unit tests (vitest)
npm run build && npm run test:e2e  # acceptance tests A–G in headless Chromium, writes TEST_RESULTS.md
npm run test:mobile              # emulated iPhone: panes, touch fader drag, audio reaches the output (needs `npm run preview` running)
```

The e2e suite drives the real UI and reads every level from the live analysers. See [TEST_RESULTS.md](TEST_RESULTS.md) for the last run.
