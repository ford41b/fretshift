# Phase 3 real note fixtures

GuitarSet v1.1.0 (Qingyang Xi, Rachel M. Bittner, Johan Pauwels, Xuzhou Ye, Juan P. Bello), CC BY 4.0. Original: https://zenodo.org/records/3371780 . Mirror: https://huggingface.co/datasets/jhartquist/guitarset . See LICENSE for attribution and terms.

Retrieved 2026-09-26 using the public dataset rows API, config default, split train, rows 1, 21, 25, 27 (solo) and 0 (comping). Each JSON preserves continuous MIDI pitch, onset_s, offset_s and string from the mirror, plus track_id, player, style, duration_s and the downloaded WAV SHA-256. Audio is the original mono microphone capture, not synthesized and not a separated stem. No audio or label modifications were made. The "train" split is the mirror's packaging; FretShift did no model training. All five selected recordings are player 0; this is a small evaluation slice, not representative production evidence.

The mirror documents three upstream errata corrections on different track IDs. Labels were accepted as provided and not independently audited by listening. Overlap is computed from all reference note intervals; even solo performances contain ringing strings. The benchmark uses continuous annotated pitch with a half-semitone match tolerance and does not infer ground truth from the detector. String-index convention was not independently verified, so no reference-string agreement score is reported.

Run `pnpm bench:audio-notes`. It verifies WAV hashes, measures monophonic reference frames separately from polyphonic reference frames, then reports event matching over the full recordings. Nonmonophonic metrics are limitations probes, not an assertion of support. All source annotations and audio required to repeat the benchmark are included.
