// Verifies the criteria-based Immersive release gate (src/audio/immersive/release.ts).
// Static source checks plus the real release module loaded through Vite SSR.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createServer } from 'vite';

const read = (p) => fs.readFileSync(p, 'utf8');
const app = read('src/ui/App.tsx');
const room = read('src/ui/screens/Immersive.tsx');
const gate = read('src/ui/screens/ImmersiveBeta.tsx');
const calibration = read('src/ui/components/ImmersiveCalibration.tsx');
const worklet = read('src/audio/immersive/capture.worklet.js');

// 1. Routing: one criteria-based route; the hard "Coming soon" gate is only the fallback.
assert.match(app, /<Route path="\/immersive" element=\{<ImmersiveRoute \/>\}/);
assert.match(app, /<Route path="\/immersive\/:id" element=\{<ImmersiveRoute \/>\}/);
assert.match(app, /canOpenImmersive\(isAudioSong\) \? <Immersive \/> : <ImmersiveBeta \/>/);
assert.doesNotMatch(app, /element=\{<ImmersiveBeta \/>\}/);
assert.match(gate, /Coming soon/);
assert.doesNotMatch(gate, /openPracticeInput|EventScorer|AudioContext|mediaDevices/);
console.log('PASS: /immersive and /immersive/:id use the criteria-based route; ImmersiveBeta remains only as the unreleased fallback');

// 2. Badge follows the physical-acceptance evidence.
assert.equal((app.match(/n\.to === "\/immersive" && IMMERSIVE_BETA \? <span className="imm-beta-nav-badge">BETA<\/span>/g) ?? []).length, 2);
assert.match(room, /IMMERSIVE_BETA && <span className="imm-beta-chip">BETA<\/span>/);
assert.match(read('src/ui/mobile-glass.css'), /imm-beta-nav-badge/);
console.log('PASS: BETA badge in navigation and room is driven by IMMERSIVE_BETA');

// 3. The room honours each flag.
assert.match(room, /const COMPILE = \{ chordScoring: IMMERSIVE_FEATURES\.chordScoring\.enabled \}/);
assert.match(room, /const scoring = scoringEnabledFor\(song\)/);
assert.match(room, /scoredPassageAllowed = scoring && plan\.targets\.length > 0 && plan\.targets\.every\(t => t\.supported\)/);
assert.match(room, /IMMERSIVE_FEATURES\.latencyCalibration\.enabled && <ImmersiveCalibration/);
assert.match(room, /\{ chords: COMPILE\.chordScoring \}/);
console.log('PASS: scored modes, chord scoring and calibration follow their flags');

// 4. Safety rules: no guide audio in scored practice, silent capture, nothing leaves the device.
assert.doesNotMatch(room, /createOscillator|createBufferSource|new Audio\(/);
assert.doesNotMatch(worklet, /outputs\s*\[/);
assert.match(calibration, /createBufferSource/); // clicks exist only in setup calibration
for (const file of [...fs.readdirSync('src/audio/immersive').filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts')).map((f) => `src/audio/immersive/${f}`), 'src/ui/screens/Immersive.tsx', 'src/ui/components/ImmersiveCalibration.tsx'])
  assert.doesNotMatch(read(file), /\bfetch\(|XMLHttpRequest|sendBeacon|WebSocket|supabase/i, `${file} must not send audio or results off the device`);
assert.match(read('src/audio/immersive/microphone.ts'), /echoCancellation: false/);
console.log('PASS: no guide audio in scored practice, silent capture worklet, no network calls in immersive audio code');

// 5. Flags recomputed from the committed evidence.
const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
try {
  const release = await server.ssrLoadModule('/src/audio/immersive/release.ts');
  const { chordThresholdFailures } = await server.ssrLoadModule('/src/audio/immersive/chordEvaluation.ts');
  const chordReport = JSON.parse(read('src/audio/immersive/evidence/chord-evaluation.json'));
  const physical = JSON.parse(read('src/audio/immersive/evidence/physical-acceptance.json'));
  const f = release.IMMERSIVE_FEATURES;
  for (const feature of Object.values(f)) {
    assert.equal(feature.enabled, feature.criteria.every((c) => c.met), `${feature.id} enabled must equal all criteria met`);
    for (const c of feature.criteria) assert.ok(['synthetic', 'local', 'emulated', 'physical'].includes(c.evidence));
  }
  const chordOk = chordThresholdFailures(chordReport).length === 0;
  assert.equal(f.chordScoring.enabled, chordOk);
  if (chordReport.evidence !== 'physical') assert.equal(f.chordScoring.enabled, false);
  assert.equal(release.IMMERSIVE_BETA, !(physical.complete === true && physical.failedSteps.length === 0));
  console.log(`PASS: flags match evidence — room ${on(f.room)}, ordinary single notes ${on(f.ordinarySingleNotes)}, audio-review notes ${on(f.audioReviewSingleNotes)}, calibration ${on(f.latencyCalibration)}, chord scoring ${on(f.chordScoring)} (chord evidence: ${chordReport.evidence}), beta badge ${release.IMMERSIVE_BETA ? 'shown' : 'removed'}`);
} finally {
  await server.close();
}

// 6. Documentation exists for the release decision and the hardware checklist.
const handoff = read('docs/handoffs/IMMERSIVE_RELEASE_HANDOFF.md');
assert.match(handoff, /iPhone acceptance checklist/i);
assert.match(read('docs/features/IMMERSIVE_BETA_GATE.md'), /criteria/i);
console.log('PASS: docs/features/IMMERSIVE_BETA_GATE.md and docs/handoffs/IMMERSIVE_RELEASE_HANDOFF.md document the criteria and the iPhone checklist');

function on(feature) {
  return feature.enabled ? 'on' : 'off';
}
