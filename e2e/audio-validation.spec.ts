import { expect, test } from "@playwright/test";

const fixture = "test-fixtures/audio-notes/single-note-melody.wav";

test("reopening and repeated correction saves preserve song metadata and beat phase", async ({ page }) => {
  await page.goto("/import");
  await page.getByRole("button", { name: /Audio recording/ }).click();
  await page.getByLabel(/Also transcribe a single-note/).check();
  await page.getByLabel("Choose audio for Audio Intelligence").setInputFiles(fixture);
  await expect(page.locator(".ai-tab-note")).toHaveCount(5);
  await page.getByRole("button", { name: "Mark all uncertain regions Unknown" }).click();
  await page.getByLabel("BPM", { exact: true }).fill("120");
  await page.getByLabel("First beat (s)").fill("0.1");
  await page.getByRole("button", { name: "Apply BPM and rebuild beats" }).click();
  await page.getByRole("button", { name: "Save as FretShift song" }).click();
  const link = page.getByRole("link", { name: "Reopen transcription" });
  await expect(link).toBeVisible();
  const href = await link.getAttribute("href");
  const id = href!.split("/").at(-1)!;
  await page.evaluate(async (songId) => {
    const { useSongStore, flushPersistence } = await import("/src/store/songStore.ts");
    useSongStore.getState().edit(songId, s => { s.artist = "Test performer"; s.tags = ["Keep me"]; s.difficultyOverride = 7; });
    await flushPersistence();
  }, id);
  await page.goto(href!);
  await expect(page.getByLabel("First beat (s)")).toHaveValue("0.1");
  for (const title of ["Correction one", "Correction two"]) {
    await page.getByLabel("Song title").fill(title);
    await page.getByRole("button", { name: "Save corrections" }).click();
    await expect(page.getByRole("link", { name: "Reopen transcription" })).toBeVisible();
  }
  await page.reload();
  await expect(page.getByLabel("Song title")).toHaveValue("Correction two");
  const saved = await page.evaluate(async (songId) => {
    const { useSongStore } = await import("/src/store/songStore.ts");
    const songs = useSongStore.getState().songs.filter(s => s.id === songId);
    return { count: songs.length, artist: songs[0].artist, tags: songs[0].tags,
      difficulty: songs[0].difficultyOverride, timing: songs[0].provenance!.audioReview!.reviewed.timingConfirmed };
  }, id);
  expect(saved).toEqual({ count: 1, artist: "Test performer", tags: ["Keep me"], difficulty: 7, timing: false });
});

test("navigation during a stalled Worker terminates it without saving a result", async ({ page }) => {
  await page.goto("/import");
  await page.evaluate(() => {
    const Native = window.Worker;
    const state = window as typeof window & { workerTerminations: number; workerStarts: number };
    state.workerTerminations = 0; state.workerStarts = 0;
    window.Worker = class extends Native {
      postMessage() { state.workerStarts++; }
      terminate() { state.workerTerminations++; super.terminate(); }
    };
  });
  await page.getByRole("button", { name: /Audio recording/ }).click();
  await page.getByLabel(/Also transcribe a single-note/).check();
  await page.getByLabel("Choose audio for Audio Intelligence").setInputFiles(
    "test-fixtures/audio-validation/02_BN1-129-Eb_comp.wav");
  await expect.poll(() => page.evaluate(() => (window as typeof window & {workerStarts:number}).workerStarts)).toBe(1);
  await page.getByRole("link", { name: "fretshift", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Your songbook" })).toBeVisible();
  // The transport was intentionally stalled after a real Worker was constructed.
  await expect(page.locator(".ai-review")).toHaveCount(0);
  const state = await page.evaluate(async () => ({
    saved: (await import("/src/store/songStore.ts")).useSongStore.getState().songs.filter(s => s.provenance?.source === "audio").length,
    terminated: (window as typeof window & {workerTerminations:number}).workerTerminations,
  }));
  expect(state.saved).toBe(0);
  expect(state.terminated).toBe(1);
});

test("five-minute recording completes, persists and reopens without confirming inferred notes", async ({ page }, info) => {
  test.setTimeout(180000);
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { analyzeAudioIntelligenceFile } = await import("/src/audio/intelligence/index.ts");
    const { createAudioReview, audioReviewToSong, gridAtBpm } = await import("/src/audio/intelligence/review.ts");
    const { useSongStore, flushPersistence } = await import("/src/store/songStore.ts");
    const { compileTargets } = await import("/src/audio/immersive/score.ts");
    // Label-independent stress signal: 300 s / 44.1 kHz PCM16, 26.46 MB.
    const rate = 44100, count = rate * 300;
    const bytes = new ArrayBuffer(44 + count * 2), view = new DataView(bytes);
    const text = (at: number, value: string) => [...value].forEach((c, i) => view.setUint8(at+i,c.charCodeAt(0)));
    text(0,"RIFF"); view.setUint32(4,bytes.byteLength-8,true); text(8,"WAVEfmt ");
    view.setUint32(16,16,true); view.setUint16(20,1,true); view.setUint16(22,1,true);
    view.setUint32(24,rate,true); view.setUint32(28,rate*2,true); view.setUint16(32,2,true); view.setUint16(34,16,true);
    text(36,"data"); view.setUint32(40,count*2,true);
    for (let i=0;i<count;i++) {
      const phase=(i/rate)%1, hz=220;
      const sample=phase<.6 ? .15*Math.min(1,phase/.01)*Math.exp(-phase*3)*Math.sin(2*Math.PI*hz*i/rate) : 0;
      view.setInt16(44+i*2,Math.round(sample*32767),true);
    }
    const file = new File([bytes],"five-minute-stress.wav");
    let waveform: number[] = [];
    const stages: { stage: string; atMs: number }[] = [];
    const start=performance.now();
    const analyzed=await analyzeAudioIntelligenceFile(file,undefined,{transcribeNotes:true,
      onWaveform: value=>{waveform=value;}, onStage: stage=>stages.push({stage,atMs:performance.now()-start})});
    const analysisMs=performance.now()-start;
    const review=createAudioReview(analyzed,file.name,waveform);
    review.reviewed.beats=gridAtBpm(300,120,0); review.reviewed.firstDownbeatIndex=0;
    review.reviewed.segments.forEach(s=>{if(!s.label)s.decision="unknown";});
    const song=audioReviewToSong("Five minute stress","local",review);
    const saveStart=performance.now(); useSongStore.getState().add(song); await flushPersistence();
    const saveMs=performance.now()-saveStart;
    const targets=compileTargets(song);
    return {id:song.id,bytes:file.size,duration:analyzed.duration,analysisMs,saveMs,stages,
      frames:analyzed.notes!.frames.length,notes:analyzed.notes!.notes.length,jsonBytes:new Blob([JSON.stringify(song)]).size,
      supportedTargets:targets.targets.filter(t=>t.supported).length,needsTiming:targets.needsTimingConfirmation,
      saveState:useSongStore.getState().saveState};
  });
  expect(result.duration).toBe(300);
  expect(result.frames).toBeGreaterThan(29000);
  expect(result.notes).toBeGreaterThan(0);
  expect(result.supportedTargets).toBe(0);
  expect(result.needsTiming).toBe(true);
  expect(result.saveState).toBe("Saved on this device");
  await info.attach("five-minute-measurements", { body: JSON.stringify(result,null,2), contentType:"application/json" });
  await page.goto(`/audio-review/${result.id}`);
  await expect(page.getByLabel("Song title")).toHaveValue("Five minute stress",{timeout:30000});
  await expect(page.getByText(/Raw audio was not retained/)).toBeVisible();
  await expect(page.locator(".ai-tab-note.confirmed")).toHaveCount(0);
});
