// Yamaha DM3 hardware description.
// Counts verified against Yamaha's published DM3 specifications
// (manual.yamaha.com DM3 Reference Manual "General Specifications"):
//   - 22 input mixing channels: 16 mono + 1 stereo (ST IN) + 2 stereo FX returns
//   - 1 stereo bus, 6 mix buses, 2 FX buses, 2 matrix buses, 1 cue bus
//   - 16 analog mic/line inputs, 8 analog (OMNI) outputs
//   - USB audio interface 18 in / 18 out
//   - Dante 16 in / 16 out on the DM3 (not on the DM3 Standard)
//   - 2 internal FX racks, 6 mute groups, input + output delay 0-1000 ms,
//     Dynamics 1 = gate/ducker, Dynamics 2 = compressor, GEQ on STEREO + MIX 1-6,
//     oscillator: sine / pink noise / burst noise (published spec listings)
//   - No DCA groups (data sheet "DCA Group: No"; Sound On Sound + AudioTechnology reviews)
//   - Digital gain -24..+24 dB; HPF 20-600 Hz and Dynamics 1 on CH 1-16 only;
//     PEQ LOW = shelf/bell, HIGH = LPF/shelf/bell; Dynamics 2 = compressor only
//     (key-in self pre/post EQ, 1-knob mode); 200 scenes; Recall Safe yes;
//     no dedicated talkback; scene Focus not documented
//   - Head amp range -6..+66 dB is NOT confirmed for the DM3 (spec quotes +64 dB gain)
// Anything this file marks "simulator" is a training simplification.

import type { BusDef, ChannelDef, ConsoleModel, InPortDef, OutPortDef, PatchSourceDef } from './types';

const range = (n: number) => Array.from({ length: n }, (_, i) => i + 1);

export function buildDm3Model(withDante: boolean): ConsoleModel {
  const channels: ChannelDef[] = [
    ...range(16).map((n) => ({ id: `ch${n}`, kind: 'mono' as const, defaultName: `CH ${n}`, short: `${n}` })),
    { id: 'stin', kind: 'stereo', defaultName: 'ST IN', short: 'ST IN' },
    { id: 'fxr1', kind: 'fxreturn', defaultName: 'FX1 RTN', short: 'FX1', fxRack: 1 },
    { id: 'fxr2', kind: 'fxreturn', defaultName: 'FX2 RTN', short: 'FX2', fxRack: 2 },
  ];

  const buses: BusDef[] = [
    { id: 'st', kind: 'stereo', defaultName: 'STEREO', short: 'ST' },
    ...range(6).map((n) => ({
      id: `mix${n}`,
      kind: 'mix' as const,
      defaultName: `MIX ${n}`,
      short: `MX${n}`,
      pair: Math.ceil(n / 2),
    })),
    { id: 'fx1', kind: 'fx', defaultName: 'FX 1', short: 'FX1' },
    { id: 'fx2', kind: 'fx', defaultName: 'FX 2', short: 'FX2' },
    { id: 'mtx1', kind: 'matrix', defaultName: 'MATRIX 1', short: 'MT1', pair: 1 },
    { id: 'mtx2', kind: 'matrix', defaultName: 'MATRIX 2', short: 'MT2', pair: 1 },
  ];

  const inPorts: InPortDef[] = [
    ...range(16).map((n) => ({ id: `in${n}`, group: 'analog' as const, label: `INPUT ${n}`, hasPreamp: true })),
    ...range(18).map((n) => ({ id: `usb${n}`, group: 'usb' as const, label: `USB IN ${n}`, hasPreamp: false })),
    ...(withDante
      ? range(16).map((n) => ({ id: `dante${n}`, group: 'dante' as const, label: `DANTE IN ${n}`, hasPreamp: false }))
      : []),
  ];

  const outPorts: OutPortDef[] = [
    ...range(8).map((n) => ({ id: `omni${n}`, group: 'analog' as const, label: `OMNI OUT ${n}` })),
    ...range(18).map((n) => ({ id: `usbo${n}`, group: 'usb' as const, label: `USB OUT ${n}` })),
    ...(withDante ? range(16).map((n) => ({ id: `danteo${n}`, group: 'dante' as const, label: `DANTE OUT ${n}` })) : []),
  ];

  const patchSources: PatchSourceDef[] = [
    { id: 'st_l', label: 'STEREO L', group: 'Stereo', allowed: true },
    { id: 'st_r', label: 'STEREO R', group: 'Stereo', allowed: true },
    ...range(6).map((n) => ({ id: `mix${n}`, label: `MIX ${n}`, group: 'Mix', allowed: true })),
    ...range(2).map((n) => ({ id: `mtx${n}`, label: `MATRIX ${n}`, group: 'Matrix', allowed: true })),
    { id: 'mon_l', label: 'MONITOR L', group: 'Monitor', allowed: true },
    { id: 'mon_r', label: 'MONITOR R', group: 'Monitor', allowed: true },
    ...range(16).map((n) => ({ id: `dir_ch${n}`, label: `CH ${n} DIRECT`, group: 'Direct Out', allowed: true })),
    ...range(2).map((n) => ({
      id: `fxbus${n}`,
      label: `FX ${n} BUS`,
      group: 'FX',
      allowed: false,
      reason: 'Simulator: FX buses feed the internal FX racks only. Use a Mix bus to send effects to an output.',
    })),
    ...range(2).map((n) => ({
      id: `fxrtn${n}`,
      label: `FX ${n} RETURN`,
      group: 'FX',
      allowed: false,
      reason:
        'An FX return is an input channel, not an output source. Route the FX RTN channel to STEREO or a MIX bus, then patch that bus.',
    })),
  ];

  return {
    id: withDante ? 'DM3' : 'DM3S',
    name: withDante ? 'Yamaha DM3 (with Dante)' : 'Yamaha DM3 Standard',
    channels,
    buses,
    inPorts,
    outPorts,
    patchSources,
    dcaCount: 0, // Yamaha DM3 data sheet: "DCA Group: No"
    muteGroupCount: 6,
    maxScenes: 200,
    features: { talkback: false, focus: false },
    geqBuses: ['st', 'mix1', 'mix2', 'mix3', 'mix4', 'mix5', 'mix6'],
    maxDelayMs: 1000,
    fxRackCount: 2,
    haGainRange: [-6, 66],
    digitalGainRange: [-24, 24],
    notes: [
      'Channel counts, buses and I/O follow the published DM3 specifications.',
      'Processing uses browser Web Audio filters/compressor and a custom gate worklet; curves and timing approximate the DM3, not Yamaha\'s exact algorithms.',
      'Per Yamaha\'s data sheet the DM3 has no DCA groups, no dedicated talkback and no scene Focus, so the simulator leaves them out. Use mute groups and scenes as on the real console.',
      'Unverified against Yamaha documentation: head-amp range (-6..+66 dB), EQ/dynamics numeric ranges, HPF slope (12 dB/oct here), effect algorithm names and processing order.',
      'The browser runs at its own sample rate (usually 44.1 or 48 kHz).',
    ],
  };
}

export const MIX_PAIRS = ['mix12', 'mix34', 'mix56'] as const;
export const MTX_PAIRS = ['mtx12'] as const;

/** Return the pair key ('mix12') for a pairable bus id, or null. */
export function pairKeyOf(busId: string): string | null {
  const m = /^(mix|mtx)(\d)$/.exec(busId);
  if (!m) return null;
  const n = Number(m[2]);
  const odd = n % 2 === 1 ? n : n - 1;
  return `${m[1]}${odd}${odd + 1}`;
}

/** For a linked pair, the odd (left) bus id; the even one is its right side. */
export function pairPartner(busId: string): { left: string; right: string } | null {
  const m = /^(mix|mtx)(\d)$/.exec(busId);
  if (!m) return null;
  const n = Number(m[2]);
  const odd = n % 2 === 1 ? n : n - 1;
  return { left: `${m[1]}${odd}`, right: `${m[1]}${odd + 1}` };
}
