# Audio Intelligence fixtures

`manifest.json` and `fixtures.mjs` define the 11 deterministic PCM benchmark cases. Names such as “acoustic-like” and “vocal-like” describe synthesized signals; these are not recordings of real instruments or singers. The generator supplies independent beat, bar, chord, and note annotations. No third-party audio is included.

`codec-c-major.wav` is a four-second, 44.1 kHz, mono PCM file synthesized from C3/E3/G3 sine tones with repeated decays. `codec-c-major.mp3` and `codec-c-major.m4a` are the same signal encoded with FFmpeg 9.0.1 using `libmp3lame -q:a 4` and `aac -b:a 96k`. They exercise browser decoding and the real analysis Worker, not musical accuracy. All three fixtures are generated for this project and may be reused without third-party attribution.

The benchmark does not use a real-guitar corpus. GuitarSet and Guitar-TECHS are identified in `docs/features/AUDIO_INTELLIGENCE_ARCHITECTURE.md` as candidates for the next evaluation gate.
