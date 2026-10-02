import { createServer } from 'vite';
import { performance } from 'node:perf_hooks';
import { writeFileSync } from 'node:fs';
import { syntheticNotes } from '../test-fixtures/audio-notes/synthetic.mjs';
const server = await createServer({server:{middlewareMode:true},appType:'custom'});
try {
  const { LocalAnalysisOrchestrator } = await server.ssrLoadModule('/src/audio/intelligence/index.ts');
  const { YinNoteTranscriber } = await server.ssrLoadModule('/src/audio/intelligence/notes.ts');
  const { createAudioReview, audioReviewToSong, gridAtBpm } = await server.ssrLoadModule('/src/audio/intelligence/review.ts');
  const unit = syntheticNotes(), duration=300;
  const pcm = new Float32Array(duration*unit.sampleRate);
  for(let at=0;at<pcm.length;at+=unit.samples.length)pcm.set(unit.samples.subarray(0,Math.min(unit.samples.length,pcm.length-at)),at);
  const cpuBefore=process.cpuUsage(), rssBefore=process.memoryUsage().rss, start=performance.now();
  const result=await new LocalAnalysisOrchestrator(undefined,undefined,undefined,new YinNoteTranscriber()).analyze({samples:pcm,sampleRate:unit.sampleRate});
  const analysisMs=performance.now()-start, cpu=process.cpuUsage(cpuBefore);
  const review=createAudioReview(result,'generated-five-minute.wav',[]);
  review.reviewed.beats=gridAtBpm(duration,120,0); review.reviewed.firstDownbeatIndex=0;
  review.reviewed.segments.forEach(s=>{if(!s.label)s.decision='unknown';});
  const conversionStart=performance.now();
  const song=audioReviewToSong('Stress benchmark','local',review);
  const conversionMs=performance.now()-conversionStart;
  const report={generatedAt:new Date().toISOString(),environment:{node:process.version,platform:process.platform,arch:process.arch},
    kind:'generated synthetic repeated melody; performance stress, not representative music accuracy',duration,sampleRate:unit.sampleRate,
    analysisMs,conversionMs,cpuMs:(cpu.user+cpu.system)/1000,rssBeforeMb:rssBefore/1048576,rssAfterMb:process.memoryUsage().rss/1048576,
    peakProcessRssMb:process.resourceUsage().maxRSS/1024,
    peakDefinition:'Process high-water RSS since Node start, including Vite, loaded modules, fixture, analysis and conversion. Not per-algorithm allocation or browser/mobile memory.',
    frames:result.notes.frames.length,notes:result.notes.notes.length,songJsonBytes:Buffer.byteLength(JSON.stringify(song)),
    automaticallyConfirmedNotes:song.provenance.audioReview.noteTranscription.notes.filter(n=>n.confirmed).length,
    trainedModelRuntimeMs:null,serverComputeCostUsd:0};
  writeFileSync('docs/post-phase-3-validation/node-stress.json',JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report,null,2));
} finally {await server.close();}
