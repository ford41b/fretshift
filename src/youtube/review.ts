import { z } from "zod";
import { createAudioReview, gridAtBpm, audioReviewToSong, type AudioReview } from "../audio/intelligence/review";
import type { AudioIntelligenceResult, ChordSegment } from "../audio/intelligence/types";
import { loadSong } from "../schema/migrations";
import { MAX_CAPO, ProvenanceSchema, SectionKindSchema, type Song } from "../schema/song.v1";
import { NoteNameSchema, parseChordName } from "../theory/chordName";
import {
  analysisToRegions,
  median,
  mergeWindows,
  mode,
  votePasses,
  type Region,
} from "./accuracy";
import { CLOSE_UP_FPS, DEFAULT_FPS, type AccuracyOptions, type AnalysisRange, type PlannedRequest, type YouTubeWire } from "./types";

/** Below this, a chord is shown as a suggestion on an Unknown region rather than as the region's label. */
export const LOW_CONFIDENCE = 0.5;

export type YouTubeImportResult = {
  videoId: string;
  range: AnalysisRange;
  regions: Region[];
  tempoBpm: number | null;
  tempoAgreement: number;
  meter: 3 | 4 | null;
  firstDownbeatSeconds: number | null;
  key: string | null;
  capoGuess: number | null;
  sections: Array<{ label: string; startSeconds: number; endSeconds: number }>;
  modelId: string;
  promptVersion: string;
  processedAt: string;
  options: AccuracyOptions;
  requests: number;
  warnings: string[];
  video: { title?: string; channel?: string };
  usage: { promptTokens: number; outputTokens: number; totalTokens: number };
};

/** Combines every window × pass response: discard suspect timing, vote passes, merge windows. */
export function combineResponses(
  videoId: string,
  range: AnalysisRange,
  options: AccuracyOptions,
  responses: Array<{ planned: PlannedRequest; wire: YouTubeWire }>,
): YouTubeImportResult {
  if (!responses.length) throw new Error("Gemini returned no analysis for this video.");
  const warnings: string[] = [];
  const windows = new Map<number, { segment: AnalysisRange; passes: Region[][] }>();
  const trusted: YouTubeWire[] = [];
  for (const { planned, wire } of responses) {
    const window = windows.get(planned.window) ?? { segment: planned.segment, passes: [] };
    windows.set(planned.window, window);
    if (wire.analysis.timingSuspect) {
      warnings.push(`Discarded pass ${planned.pass} of ${formatRange(planned.segment)}: Gemini's timestamps did not match the requested range.`);
      continue;
    }
    trusted.push(wire);
    window.passes.push(analysisToRegions(wire.analysis, planned.segment));
  }
  if (!trusted.length) throw new Error("Gemini's timestamps did not match the requested range. Retry, or turn off overlapping windows.");
  const voted = [...windows.values()].filter((window) => window.passes.length)
    .map((window) => ({ segment: window.segment, regions: votePasses(window.passes, window.segment) }));
  const regions = mergeWindows(voted, range);
  const disputed = regions.filter((region) => region.disagreement).length;
  if (disputed) warnings.push(`${disputed} region${disputed === 1 ? "" : "s"} where passes disagreed ${disputed === 1 ? "is" : "are"} marked Unknown with each suggestion listed.`);
  const sanitizedLabels = trusted.reduce((sum, wire) => sum + wire.analysis.sanitized.labels, 0);
  if (sanitizedLabels) warnings.push(`${sanitizedLabels} unusable label${sanitizedLabels === 1 ? " was" : "s were"} replaced with Unknown.`);

  const tempos = trusted.map((wire) => wire.analysis.tempoBpm);
  const tempoBpm = median(tempos);
  const agreeing = tempoBpm === null ? 0 : tempos.filter((tempo) => tempo !== null && Math.abs(tempo - tempoBpm) / tempoBpm < 0.04).length;
  const firstWindow = Math.min(...responses.map((response) => response.planned.window));
  const first = responses.filter((response) => response.planned.window === firstWindow && !response.wire.analysis.timingSuspect);
  const sections = trusted.filter((wire) => wire.pass === 1).flatMap((wire) => wire.analysis.sections)
    .sort((a, b) => a.startSeconds - b.startSeconds)
    .reduce<YouTubeImportResult["sections"]>((list, section) => {
      const previous = list.at(-1);
      if (previous && section.startSeconds < previous.endSeconds) {
        if (previous.label === section.label) { previous.endSeconds = Math.max(previous.endSeconds, section.endSeconds); return list; }
        previous.endSeconds = section.startSeconds;
      }
      list.push({ ...section });
      return list;
    }, []).filter((section) => section.endSeconds - section.startSeconds >= 0.5);
  const usage = trusted.reduce((sum, wire) => ({
    promptTokens: sum.promptTokens + (wire.usage?.promptTokens ?? 0),
    outputTokens: sum.outputTokens + (wire.usage?.outputTokens ?? 0),
    totalTokens: sum.totalTokens + (wire.usage?.totalTokens ?? 0),
  }), { promptTokens: 0, outputTokens: 0, totalTokens: 0 });
  return {
    videoId, range, regions, tempoBpm: tempoBpm === null ? null : Number(tempoBpm.toFixed(2)),
    tempoAgreement: trusted.length ? Number((agreeing / trusted.length).toFixed(3)) : 0,
    meter: mode(trusted.map((wire) => wire.analysis.meter)),
    firstDownbeatSeconds: median(first.map((response) => response.wire.analysis.firstDownbeatSeconds)),
    key: mode(trusted.map((wire) => wire.analysis.key)),
    capoGuess: mode(trusted.map((wire) => wire.analysis.capoGuess)),
    sections, modelId: trusted[0].modelId, promptVersion: trusted[0].promptVersion,
    processedAt: trusted.map((wire) => wire.processedAt).sort().at(-1)!, options, requests: responses.length, warnings,
    video: trusted.find((wire) => wire.video.title)?.video ?? {}, usage,
  };
}

const formatRange = (range: AnalysisRange) => `${range.startSeconds.toFixed(0)}–${range.endSeconds.toFixed(0)} s`;
const parseable = (label: string) => { try { parseChordName(label); return true; } catch { return false; } };

/** Builds the same reviewed-draft structure Audio Intelligence uses. Every region and the timing start unreviewed. */
export function youtubeResultToReview(result: YouTubeImportResult): AudioReview {
  const duration = result.range.endSeconds;
  const meter = result.meter ?? 4;
  let beats: number[] = [];
  if (result.tempoBpm !== null) {
    const first = result.firstDownbeatSeconds ?? result.range.startSeconds;
    beats = first < duration ? gridAtBpm(duration, result.tempoBpm, first) : [];
  }
  const segments: ChordSegment[] = result.regions.map((region) => {
    const label = region.kind === "chord" && region.label && region.confidence >= LOW_CONFIDENCE ? region.label : null;
    const alternatives = new Map<string, number>();
    if (region.label) alternatives.set(region.label, region.confidence);
    for (const item of region.alternatives) alternatives.set(item.label, Math.max(alternatives.get(item.label) ?? 0, item.score));
    return {
      start: region.start, end: region.end, label,
      status: region.kind === "no-chord" && !region.disagreement ? "no-chord" : label ? "estimated" : "ambiguous",
      alternatives: [...alternatives].filter(([name]) => parseable(name)).map(([name, score]) => ({ label: name, score }))
        .sort((a, b) => b.score - a.score),
    };
  });
  const analysis: AudioIntelligenceResult = {
    version: 1, duration,
    beats: {
      providerId: result.modelId, tempoBpm: result.tempoBpm, beats,
      downbeats: beats.filter((_, i) => i % meter === 0), meter: result.meter,
      status: beats.length ? "estimated" : "insufficient-evidence", evidence: result.tempoAgreement,
      warnings: [beats.length
        ? "Tempo and downbeat are Gemini estimates from the video. Tap along to confirm them."
        : "Gemini found no steady tempo. Tap along or enter a BPM before saving."],
    },
    chords: {
      providerId: result.modelId,
      vocabulary: [...new Set(result.regions.flatMap((region) => region.label ? [region.label] : []))],
      segments,
      warnings: ["Chords come from Gemini watching and listening to the video. Review every region.", ...result.warnings],
    },
    measures: [], notes: null, stemProviderId: null, warnings: result.warnings,
  };
  return createAudioReview(analysis, `youtube:${result.videoId}`, []);
}

const YouTubeProvenanceSchema = ProvenanceSchema.shape.youtube.unwrap();
export const YouTubeSongMetaSchema = z.object({
  youtube: YouTubeProvenanceSchema,
  promptVersion: z.string().min(1),
  processedAt: z.string().min(1),
  artist: z.string().max(160).optional(),
  tuningId: z.string().optional(),
  capo: z.number().int().min(0).max(MAX_CAPO).optional(),
});
export type YouTubeSongMeta = z.infer<typeof YouTubeSongMetaSchema>;

export function youtubeSongMeta(result: YouTubeImportResult, choices: { artist?: string; tuningId?: string; capo?: number }): YouTubeSongMeta {
  const capo = choices.capo ?? result.capoGuess ?? undefined;
  return {
    youtube: {
      videoId: result.videoId, startSeconds: result.range.startSeconds, endSeconds: result.range.endSeconds,
      options: { useHints: result.options.useHints, windowSeconds: result.options.windowSeconds,
        overlapSeconds: result.options.overlapSeconds, fps: result.options.closeUp ? CLOSE_UP_FPS : DEFAULT_FPS,
        passes: result.options.passes, snapToBeats: result.options.snapToBeats },
      requests: result.requests, keyGuess: result.key, capoGuess: result.capoGuess, sections: result.sections,
    },
    promptVersion: result.promptVersion, processedAt: result.processedAt,
    ...(choices.artist ? { artist: choices.artist } : {}),
    ...(choices.tuningId ? { tuningId: choices.tuningId } : {}),
    ...(capo !== undefined && capo <= MAX_CAPO ? { capo } : {}),
  };
}

export function metaFromSong(song: Song): YouTubeSongMeta | null {
  const provenance = song.provenance;
  if (provenance?.source !== "youtube" || !provenance.youtube) return null;
  return { youtube: provenance.youtube, promptVersion: provenance.promptVersion ?? "unknown",
    processedAt: provenance.processedAt ?? song.createdAt };
}

const SECTION_KIND: Record<string, z.infer<typeof SectionKindSchema>> = {
  intro: "intro", verse: "verse", "pre-chorus": "prechorus", chorus: "chorus", bridge: "bridge", solo: "solo", outro: "outro",
};

/** Same validation and chart bridge as Audio Intelligence, with YouTube provenance, key/capo/tuning and sections. */
export function youtubeReviewToSong(title: string, providerId: string, review: AudioReview, meta: YouTubeSongMeta): Song {
  const song = audioReviewToSong(title, providerId, review);
  song.provenance = { ...song.provenance!, source: "youtube", promptVersion: meta.promptVersion,
    processedAt: meta.processedAt, youtube: structuredClone(meta.youtube) };
  if (meta.artist) song.artist = meta.artist;
  if (meta.tuningId) song.tuningId = meta.tuningId;
  if (meta.capo !== undefined) song.capo = meta.capo;
  const key = /^([A-G](?:#|b)?)(m?)$/.exec(meta.youtube.keyGuess ?? "");
  if (key && NoteNameSchema.safeParse(key[1]).success) {
    const parsed = { root: NoteNameSchema.parse(key[1]), mode: key[2] ? "minor" as const : "major" as const };
    song.originalKey = parsed;
    song.currentKey = { ...parsed };
  }
  const r = review.reviewed;
  for (const section of meta.youtube.sections) {
    let beat = -1;
    for (let i = 0; i < r.beats.length && r.beats[i] <= section.startSeconds + 0.25; i++) beat = i;
    const measure = song.measures[Math.max(0, Math.floor((beat - r.firstDownbeatIndex) / r.meter))];
    if (beat >= r.firstDownbeatIndex && measure && !measure.section)
      measure.section = SECTION_KIND[section.label]
        ? { kind: SECTION_KIND[section.label] }
        : { kind: "custom", label: section.label };
  }
  return loadSong(song);
}
