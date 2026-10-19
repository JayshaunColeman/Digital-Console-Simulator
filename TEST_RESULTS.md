# Acceptance test results

Run: 2026-10-19T21:42:05.227Z · headless Chromium · levels read from live AnalyserNodes

## ✅ TEST A: Main mix

- PASS — Input 1 (port) shows signal (-12.4 dB)
- PASS — Channel 1 input meter shows signal (-8.7 dB)
- PASS — ST assign off -> STEREO bus silent (-140.0 dB)
- PASS — ST assign on -> STEREO master meter responds (-24.7 dB)
- PASS — Audio reaches OMNI OUT 7 (FOH PA L) (-32.1 dB)
- PASS — Audio reaches the browser output (-32.0 dB)
- PASS — Muted: channel PRE meter still shows input (-13.0 dB)
- PASS — Muted: POST-fader meter silent (-140.0 dB)
- PASS — Muted: STEREO bus silent (-140.0 dB)
- PASS — Muted: OMNI 7 and browser output silent

## ✅ TEST B: Monitor mix

- PASS — Send ch1 -> MIX 1 is ON at 0 dB, PRE
- PASS — STEREO bus silent (ch1 not assigned to ST) (-140.0 dB)
- PASS — MIX 1 bus meter responds (-18.0 dB)
- PASS — MIX 1 reaches OMNI OUT 1 (default patch) (-18.0 dB)
- PASS — Browser hears Wedge 1 (OMNI 1) (-24.9 dB)
- PASS — Send level set to -20 dB via the send control
- PASS — MIX 1 level dropped accordingly (~20 dB) (-18.0 dB -> -38.0 dB)
- PASS — Bus master muted: MIX 1 output silent (-140.0 dB)
- PASS — Bus master muted: OMNI 1 and browser silent
- PASS — Bus input (sum of sends) still has signal (-18.0 dB)

## ✅ TEST C: Output patching

- PASS — Unpatched: MIX 1 still shows signal (-18.0 dB)
- PASS — Unpatched: OMNI 1 silent (-140.0 dB)
- PASS — Unpatched: browser (listening at OMNI 1) silent (-140.0 dB)
- PASS — UI marks OMNI 1 UNPATCHED
- PASS — Patch restored: OMNI 1 has signal again (-18.0 dB)
- PASS — Patch restored: browser hears it again (-24.9 dB)
- PASS — Incompatible source (FX RETURN) is listed but not selectable

## ✅ TEST D: Sends on Fader

- PASS — SOF shows selected bus
- PASS — Channel fader moved the MIX 1 send (0 -> -12 dB) (send=-12)
- PASS — Channel fader level itself unchanged in SOF
- PASS — MIX 1 bus level followed (~12 dB lower) (-18.0 dB -> -30.0 dB)
- PASS — Switching bus: fader now shows MIX 2 send (-inf)
- PASS — Normal mode: fader again controls channel level (fader=-20)
- PASS — Normal mode: MIX 1 send untouched (-12 dB)
- PASS — POST-fader meter dropped ~10 dB (-28.0 dB -> -38.0 dB)

## ✅ TEST E: Processing (EQ / HPF / compressor / meter points)

- PASS — 1 kHz sine at -18 dBFS arrives on CH 16 (-18.0 dB)
- PASS — POST meter = PRE meter - 10 dB fader (-18.0 dB / -28.0 dB)
- PASS — EQ +12 dB at 1 kHz raises the 1 kHz tone by ~12 dB (-18.0 dB -> -6.0 dB)
- PASS — EQ OFF bypasses it
- PASS — HPF @400 Hz attenuates a 100 Hz tone strongly (> 18 dB) (-18.0 dB -> -41.8 dB)
- PASS — Comp ON, signal below threshold: level unchanged (no hidden make-up gain) (-18.0 dB -> -18.0 dB)
- PASS — Comp threshold -30 / 4:1 on -18 dBFS tone: ~9 dB gain reduction (GR -8.8 dB)
- PASS — Output level reduced accordingly (-18.0 dB -> -26.7 dB)
- PASS — GR meter element present on the screen
- PASS — MAKEUP +6 dB raises output by 6 dB (-26.7 dB -> -20.7 dB)
- PASS — Compressor GR responds to the vocal programme (max GR -11.5 dB)

## ✅ TEST F: Independent mixes

- PASS — Monitor send -20 dB: MIX 1 drops ~20 dB (-24.0 dB -> -44.0 dB)
- PASS — ...and the main STEREO mix is unchanged (-21.0 dB -> -21.0 dB)
- PASS — Main fader -10 dB: STEREO drops ~10 dB (-21.0 dB -> -31.0 dB)
- PASS — ...and the PRE-fader monitor mix is unchanged (-44.0 dB -> -44.0 dB)
- PASS — Switching the send to POST makes the monitor follow the fader (-10 dB) (-44.0 dB -> -54.0 dB)

## ✅ TEST G: Save and restore

- PASS — Settings changed after storing
- PASS — Recall restores the exact stored configuration
- PASS — Restored routing carries audio again (OMNI 1 has the vocal) (-20.2 dB)
- PASS — Scene persisted in local storage across reload

## ✅ EXTRA: Loop detection, troubleshooting scenario, signal flow

- PASS — Feedback loop flagged in UI
- PASS — Loop warning clears when the cable is removed
- PASS — Scenario starts with fault present (Not fixed)
- PASS — Hint system reveals a hint
- PASS — Reveal path shows the path analysis
- PASS — Signal-flow view renders a verdict
- PASS — No page errors during the run
