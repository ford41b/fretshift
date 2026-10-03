// Pure logic for the youtube-import Edge Function. No Deno or network globals,
// so Deno tests and the local benchmark (through Vite) can load it directly.
//
// Provider contract checked 2026-10-03 against Google's js-genai 2.27.0 types
// and the Gemini cookbook; see DECISIONS.md "YouTube link import".

export const PROMPT_VERSION = "youtube-chords-v1";
export const DEFAULT_MODEL = "gemini-3.8-flash";
export const MAX_BODY_BYTES = 16 * 1024;
/** One Gemini request analyzes at most this many seconds of video frames. */
export const MAX_SEGMENT_SECONDS = 600;
export const MIN_SEGMENT_SECONDS = 5;
/**
 * Longest video accepted. Google currently bills the whole YouTube audio track
 * on every clipped request (see DECISIONS.md), so long videos multiply cost.
 */
export const MAX_VIDEO_SECONDS = 3600;
export const MIN_FPS = 0.25;
export const MAX_FPS = 8;
export const MAX_FRAMES_PER_REQUEST = 2400;
export const MAX_CHORDS = 800;
export const MAX_SECTIONS = 60;
export const SECTION_LABELS = [
  "intro",
  "verse",
  "pre-chorus",
  "chorus",
  "bridge",
  "solo",
  "interlude",
  "outro",
  "other",
] as const;
export const EVIDENCE = ["heard", "seen", "heard_and_seen"] as const;

export type ErrorCode =
  | "bad-request"
  | "invalid-url"
  | "too-long"
  | "private-video"
  | "not-found"
  | "provider-quota"
  | "provider-rejected"
  | "provider-unavailable"
  | "not-configured"
  | "blocked"
  | "truncated"
  | "invalid-response"
  | "timeout";

export class YouTubeImportError extends Error {
  status: number;
  code: ErrorCode;
  retryable: boolean;
  constructor(
    status: number,
    message: string,
    options: { code?: ErrorCode; retryable?: boolean } = {},
  ) {
    super(message);
    this.name = "YouTubeImportError";
    this.status = status;
    this.code = options.code ?? "bad-request";
    this.retryable = options.retryable ?? false;
  }
}

export type Hints = {
  title?: string;
  artist?: string;
  tuning?: string;
  capo?: number;
};
export type Segment = { startSeconds: number; endSeconds: number };
export type ImportRequest = {
  videoId: string;
  segment: Segment;
  fps: number;
  hints: Hints;
  pass: number;
  videoDurationSeconds?: number;
};

export type ChordChange = {
  startSeconds: number;
  endSeconds: number;
  /** Chord symbol, or null for Unknown / No chord (see `kind`). */
  chord: string | null;
  kind: "chord" | "unknown" | "no-chord";
  confidence: number;
  evidence: (typeof EVIDENCE)[number];
};
export type SectionMark = {
  label: (typeof SECTION_LABELS)[number];
  startSeconds: number;
  endSeconds: number;
};
export type Analysis = {
  tempoBpm: number | null;
  meter: 3 | 4 | null;
  key: string | null;
  capoGuess: number | null;
  firstDownbeatSeconds: number | null;
  sections: SectionMark[];
  chords: ChordChange[];
  /** Counts of provider values FretShift normalized instead of trusting. */
  sanitized: { labels: number; times: number; outsideWindowSeconds: number };
  /** True when most reported time lies outside the requested window. */
  timingSuspect: boolean;
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);
const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);
const round = (value: number, places = 3) => Number(value.toFixed(places));
const bad = (message: string) =>
  new YouTubeImportError(400, message, { code: "bad-request" });

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const YOUTUBE_HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com"]);

/**
 * Accepts only youtube.com/watch?v=, youtu.be/ and youtube.com/shorts/ links
 * to one video and returns its 11-character ID. Playlists, channels, embeds,
 * live pages and other hosts are rejected. Keep in sync with src/youtube/url.ts.
 */
export function parseYouTubeVideoId(input: unknown): string {
  const invalid = () =>
    new YouTubeImportError(
      400,
      "Paste a youtube.com/watch, youtu.be or youtube.com/shorts link to one video.",
      { code: "invalid-url" },
    );
  if (typeof input !== "string" || !input.trim() || input.length > 500)
    throw invalid();
  let text = input.trim();
  if (!/^[a-z][a-z0-9+.-]*:/i.test(text)) text = `https://${text}`;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw invalid();
  }
  if (
    !["https:", "http:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.port
  )
    throw invalid();
  const host = url.hostname.toLowerCase();
  let id: string | null = null;
  if (host === "youtu.be") {
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts.length === 1) id = parts[0];
  } else if (YOUTUBE_HOSTS.has(host)) {
    if (url.pathname === "/watch" || url.pathname === "/watch/")
      id = url.searchParams.get("v");
    else id = /^\/shorts\/([^/]+)\/?$/.exec(url.pathname)?.[1] ?? null;
  }
  if (!id || !VIDEO_ID.test(id)) throw invalid();
  return id;
}

export const watchUrl = (videoId: string) =>
  `https://www.youtube.com/watch?v=${videoId}`;

/** Single-line printable text: hints are quoted into the prompt. */
function cleanHint(value: unknown, name: string, max: number) {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.length > max)
    throw bad(`${name} hint must be text up to ${max} characters.`);
  const text = value.replace(/[\u0000-\u001f\u007f]+/g, " ").trim();
  return text || undefined;
}

export async function readRequestJson(
  request: Request,
  maxBytes = MAX_BODY_BYTES,
): Promise<unknown> {
  if (!request.body) throw bad("Request body must be valid JSON.");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > maxBytes) {
      await reader.cancel();
      throw new YouTubeImportError(413, "YouTube import request is too large.");
    }
    chunks.push(value);
  }
  const joined = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(joined));
  } catch {
    throw bad("Request body must be valid JSON.");
  }
}

const REQUEST_KEYS = ["url", "segment", "fps", "hints", "pass", "videoDurationSeconds"];
const HINT_KEYS = ["title", "artist", "tuning", "capo"];

export function validateImportRequest(raw: unknown): ImportRequest {
  if (!isObject(raw) || Object.keys(raw).some((key) => !REQUEST_KEYS.includes(key)))
    throw bad(`Send only ${REQUEST_KEYS.join(", ")}.`);
  const videoId = parseYouTubeVideoId(raw.url);
  const tooLong = (message: string) =>
    new YouTubeImportError(413, message, { code: "too-long" });

  let videoDurationSeconds: number | undefined;
  if (raw.videoDurationSeconds !== undefined) {
    if (!finite(raw.videoDurationSeconds) || raw.videoDurationSeconds <= 0)
      throw bad("videoDurationSeconds must be a positive number.");
    videoDurationSeconds = raw.videoDurationSeconds;
    if (videoDurationSeconds > MAX_VIDEO_SECONDS)
      throw tooLong(
        `This video is longer than ${MAX_VIDEO_SECONDS / 60} minutes. FretShift analyzes videos up to an hour long.`,
      );
  }

  const segment = raw.segment;
  if (
    !isObject(segment) ||
    Object.keys(segment).some((key) => !["startSeconds", "endSeconds"].includes(key)) ||
    !finite(segment.startSeconds) ||
    !finite(segment.endSeconds) ||
    segment.startSeconds < 0 ||
    segment.endSeconds <= segment.startSeconds
  )
    throw bad("segment needs startSeconds and a later endSeconds.");
  const startSeconds = round(segment.startSeconds);
  const endSeconds = round(segment.endSeconds);
  const length = endSeconds - startSeconds;
  if (length < MIN_SEGMENT_SECONDS)
    throw bad(`Analyze at least ${MIN_SEGMENT_SECONDS} seconds of video.`);
  if (length > MAX_SEGMENT_SECONDS)
    throw tooLong(
      `One analysis covers at most ${MAX_SEGMENT_SECONDS / 60} minutes. Choose a shorter start/end range or overlapping windows.`,
    );
  if (endSeconds > MAX_VIDEO_SECONDS)
    throw tooLong(`End time must be within the first ${MAX_VIDEO_SECONDS / 60} minutes.`);
  if (videoDurationSeconds !== undefined && startSeconds >= videoDurationSeconds)
    throw bad("Start time is after the end of the video.");
  if (videoDurationSeconds !== undefined && endSeconds > videoDurationSeconds + 1)
    throw bad("End time is after the end of the video.");

  if (!finite(raw.fps) || raw.fps < MIN_FPS || raw.fps > MAX_FPS)
    throw bad(`fps must be between ${MIN_FPS} and ${MAX_FPS}.`);
  const fps = raw.fps;
  if (length * fps > MAX_FRAMES_PER_REQUEST)
    throw tooLong(
      "This range has too many video frames at that frame rate. Lower the frame rate or analyze a shorter range.",
    );

  const pass = raw.pass ?? 1;
  if (!Number.isInteger(pass) || Number(pass) < 1 || Number(pass) > 3)
    throw bad("pass must be 1, 2 or 3.");

  const sourceHints = raw.hints ?? {};
  if (!isObject(sourceHints) || Object.keys(sourceHints).some((key) => !HINT_KEYS.includes(key)))
    throw bad("Hints may contain only title, artist, tuning and capo.");
  const hints: Hints = {};
  const title = cleanHint(sourceHints.title, "Title", 160);
  const artist = cleanHint(sourceHints.artist, "Artist", 160);
  const tuning = cleanHint(sourceHints.tuning, "Tuning", 60);
  if (title) hints.title = title;
  if (artist) hints.artist = artist;
  if (tuning) hints.tuning = tuning;
  if (sourceHints.capo !== undefined) {
    if (!Number.isInteger(sourceHints.capo) || Number(sourceHints.capo) < 0 || Number(sourceHints.capo) > 12)
      throw bad("Capo hint must be a whole fret from 0 to 12.");
    hints.capo = Number(sourceHints.capo);
  }
  return {
    videoId,
    segment: { startSeconds, endSeconds },
    fps,
    hints,
    pass: Number(pass),
    ...(videoDurationSeconds === undefined ? {} : { videoDurationSeconds }),
  };
}

/** Gemini `responseSchema` (OpenAPI 3.0 subset). No free-text field exists, so lyrics have nowhere to go. */
export const RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    tempoBpm: { type: "NUMBER", nullable: true },
    meter: { type: "STRING", enum: ["3/4", "4/4", "unknown"] },
    key: { type: "STRING", nullable: true },
    capoGuess: { type: "INTEGER", nullable: true },
    firstDownbeatSeconds: { type: "NUMBER", nullable: true },
    sections: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          label: { type: "STRING", enum: [...SECTION_LABELS] },
          startSeconds: { type: "NUMBER" },
          endSeconds: { type: "NUMBER" },
        },
        required: ["label", "startSeconds", "endSeconds"],
        propertyOrdering: ["label", "startSeconds", "endSeconds"],
      },
    },
    chords: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          startSeconds: { type: "NUMBER" },
          endSeconds: { type: "NUMBER" },
          chord: { type: "STRING" },
          confidence: { type: "NUMBER" },
          evidence: { type: "STRING", enum: [...EVIDENCE] },
        },
        required: ["startSeconds", "endSeconds", "chord", "confidence", "evidence"],
        propertyOrdering: ["startSeconds", "endSeconds", "chord", "confidence", "evidence"],
      },
    },
  },
  required: ["tempoBpm", "meter", "key", "capoGuess", "firstDownbeatSeconds", "sections", "chords"],
  propertyOrdering: ["tempoBpm", "meter", "key", "capoGuess", "firstDownbeatSeconds", "sections", "chords"],
} as const;

const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${(seconds % 60).toFixed(1).padStart(4, "0")}`;

export function buildPrompt(input: ImportRequest): string {
  const { startSeconds, endSeconds } = input.segment;
  const hints = Object.entries(input.hints)
    .map(([name, value]) => `- ${name}: ${JSON.stringify(value)}`)
    .join("\n");
  return [
    "You transcribe the guitar chords played in a YouTube video into a private practice chart.",
    `Analyze only the video from ${startSeconds} s to ${endSeconds} s (${clock(startSeconds)} to ${clock(endSeconds)}).`,
    "Report every time as seconds from the start of the whole video, not from the start of the requested range, with at most two decimals.",
    "",
    "Rules:",
    "- Never transcribe, quote or paraphrase lyrics, speech or on-screen text. No field may contain words from the video.",
    "- chords: chord changes in time order without overlaps, covering the analyzed range. Merge repeated strums of one chord into one entry.",
    "- chord: the sounding chord written as a root (A-G, optional # or b), an optional quality (m, dim, aug, sus2, sus4, 5), optional extensions in this order (6, 7, maj7, 9, maj9, 11, 13, add9, b5, #5, b9, #9, #11, b13) and an optional /bass note, for example G, Em, D/F#, Cadd9, Bm7b5, Asus4 or Cmaj7.",
    '- Use "N.C." where no chord sounds (talking, silence, single-note riffs) and "Unknown" whenever you cannot tell. A wrong chord is worse than "Unknown".',
    "- With a capo, name the sounding (concert-pitch) chord, not the shape, and report the capo fret in capoGuess.",
    "- confidence: your probability from 0 to 1 that the chord symbol is right.",
    '- evidence: "heard" when only the audio supports the chord, "seen" when only the fretting hand on the fretboard does, "heard_and_seen" when both agree.',
    '- tempoBpm: quarter-note tempo if there is a steady pulse, else null. meter: "3/4", "4/4" or "unknown". firstDownbeatSeconds: the first beat 1 inside the range, or null.',
    '- key: the overall key such as "G" or "Em", or null. capoGuess: the capo fret, 0 for none, or null if unsure.',
    "- sections: musical sections using only the allowed labels; return an empty list when unclear.",
    ...(hints
      ? ["", "Hints from the player (they may be wrong; trust what you hear and see):", hints]
      : []),
  ].join("\n");
}

/** generateContent body. The video is referenced by URL; FretShift never downloads it. */
export function buildGeminiRequest(input: ImportRequest) {
  return {
    contents: [
      {
        role: "user",
        parts: [
          {
            fileData: { fileUri: watchUrl(input.videoId) },
            videoMetadata: {
              startOffset: `${input.segment.startSeconds}s`,
              endOffset: `${input.segment.endSeconds}s`,
              fps: input.fps,
            },
          },
          { text: buildPrompt(input) },
        ],
      },
    ],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: RESPONSE_SCHEMA,
    },
  };
}

// Root, then only chord-quality tokens, then an optional bass note. Ordinary
// words ("Baby", "Gonna") do not match, so prose cannot pass as a chord.
const CHORD_SYMBOL =
  /^[A-G](?:#|b)?(?:maj|min|dim|aug|sus|add|alt|m|M|°|ø|\+|-|6\/9|[0-9]|#|b|\(|\)|,)*(?:\/[A-G](?:#|b)?)?$/;

/** Returns a chord symbol, "unknown" or "no-chord". Anything else (including prose) becomes Unknown. */
export function normalizeChordLabel(value: unknown): { kind: ChordChange["kind"]; chord: string | null; valid: boolean } {
  if (typeof value !== "string") return { kind: "unknown", chord: null, valid: false };
  const text = value.trim().replace(/♯/g, "#").replace(/♭/g, "b");
  if (/^(n\.?\s?c\.?|no chord|none|silence)$/i.test(text)) return { kind: "no-chord", chord: null, valid: true };
  if (/^(unknown|\?+|x)$/i.test(text)) return { kind: "unknown", chord: null, valid: true };
  if (text.length <= 16 && CHORD_SYMBOL.test(text)) return { kind: "chord", chord: text, valid: true };
  return { kind: "unknown", chord: null, valid: false };
}

export function normalizeKey(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = /^([A-G](?:#|b)?)\s*(m|min|minor|maj|major)?$/.exec(
    value.trim().replace(/♯/g, "#").replace(/♭/g, "b"),
  );
  if (!match) return null;
  return `${match[1]}${match[2] && /^m(in(or)?)?$/.test(match[2]) ? "m" : ""}`;
}

function parseGeminiJson(raw: unknown): unknown {
  if (!isObject(raw))
    throw new YouTubeImportError(502, "Gemini returned malformed output.", { code: "invalid-response", retryable: true });
  const feedback = raw.promptFeedback;
  if (isObject(feedback) && typeof feedback.blockReason === "string")
    throw new YouTubeImportError(422, "Gemini declined to analyze this video.", { code: "blocked" });
  const candidate = Array.isArray(raw.candidates) ? raw.candidates[0] : undefined;
  if (!isObject(candidate))
    throw new YouTubeImportError(502, "Gemini returned no answer.", { code: "invalid-response", retryable: true });
  const reason = candidate.finishReason;
  if (reason === "MAX_TOKENS")
    throw new YouTubeImportError(
      502,
      "Gemini's answer was cut off. Analyze a shorter range or turn on overlapping windows.",
      { code: "truncated" },
    );
  if (typeof reason === "string" && !["STOP", "FINISH_REASON_UNSPECIFIED"].includes(reason))
    throw new YouTubeImportError(422, `Gemini stopped without a usable answer (${reason.slice(0, 40)}).`, {
      code: "blocked",
    });
  const parts = isObject(candidate.content) && Array.isArray(candidate.content.parts) ? candidate.content.parts : [];
  const text = parts
    .filter((part): part is { text: string } => isObject(part) && typeof part.text === "string" && part.thought !== true)
    .map((part) => part.text)
    .join("")
    .trim()
    .replace(/^```(?:json)?\s*|\s*```$/g, "");
  try {
    return JSON.parse(text);
  } catch {
    throw new YouTubeImportError(502, "Gemini returned malformed output.", { code: "invalid-response", retryable: true });
  }
}

/**
 * Strictly checks Gemini's structured output and returns FretShift's normalized
 * analysis. Structural problems are errors; implausible values are normalized
 * to Unknown/null and counted, never trusted.
 */
export function validateGeminiResponse(raw: unknown, segment: Segment): Analysis {
  const data = parseGeminiJson(raw);
  const malformed = () =>
    new YouTubeImportError(502, "Gemini's answer did not match the chord schema.", {
      code: "invalid-response",
      retryable: true,
    });
  if (!isObject(data) || !Array.isArray(data.chords) || !Array.isArray(data.sections)) throw malformed();
  if (data.chords.length > MAX_CHORDS)
    throw new YouTubeImportError(502, "Gemini returned too many chord changes for one range.", {
      code: "invalid-response",
      retryable: true,
    });
  const { startSeconds: low, endSeconds: high } = segment;
  const sanitized = { labels: 0, times: 0, outsideWindowSeconds: 0 };
  let reportedSeconds = 0;
  const clip = (start: number, end: number) => {
    reportedSeconds += end - start;
    const outside = Math.max(0, Math.min(end, low - 1) - start) + Math.max(0, end - Math.max(start, high + 1));
    sanitized.outsideWindowSeconds += outside;
    const clipped = [Math.max(low, start), Math.min(high, end)] as const;
    if (clipped[0] !== start || clipped[1] !== end) sanitized.times++;
    return clipped;
  };

  const chords: ChordChange[] = [];
  for (const item of data.chords) {
    if (!isObject(item) || !finite(item.startSeconds) || !finite(item.endSeconds)) throw malformed();
    if (item.startSeconds < 0 || item.endSeconds <= item.startSeconds) {
      sanitized.times++;
      continue;
    }
    const [start, end] = clip(item.startSeconds, item.endSeconds);
    const label = normalizeChordLabel(item.chord);
    if (!label.valid) sanitized.labels++;
    if (end - start < 0.05) continue;
    chords.push({
      startSeconds: round(start),
      endSeconds: round(end),
      chord: label.chord,
      kind: label.kind,
      confidence: finite(item.confidence) ? round(Math.min(1, Math.max(0, item.confidence)), 3) : 0,
      evidence: EVIDENCE.includes(item.evidence as never) ? (item.evidence as ChordChange["evidence"]) : "heard",
    });
  }
  chords.sort((a, b) => a.startSeconds - b.startSeconds || a.endSeconds - b.endSeconds);
  // Overlaps: the later change wins; a fully covered earlier entry is dropped.
  const ordered: ChordChange[] = [];
  for (const chord of chords) {
    const previous = ordered.at(-1);
    if (previous && chord.startSeconds < previous.endSeconds) {
      sanitized.times++;
      previous.endSeconds = chord.startSeconds;
      if (previous.endSeconds - previous.startSeconds < 0.05) ordered.pop();
    }
    ordered.push(chord);
  }

  const candidates: SectionMark[] = [];
  for (const item of data.sections.slice(0, MAX_SECTIONS)) {
    if (!isObject(item) || !finite(item.startSeconds) || !finite(item.endSeconds)) throw malformed();
    if (!SECTION_LABELS.includes(item.label as never) || item.endSeconds <= item.startSeconds) {
      sanitized.labels++;
      continue;
    }
    const start = Math.max(low, item.startSeconds), end = Math.min(high, item.endSeconds);
    if (end - start >= 0.5)
      candidates.push({ label: item.label as SectionMark["label"], startSeconds: round(start), endSeconds: round(end) });
  }
  candidates.sort((a, b) => a.startSeconds - b.startSeconds);
  const sections: SectionMark[] = [];
  for (const section of candidates) {
    const previous = sections.at(-1);
    if (previous && section.startSeconds < previous.endSeconds) {
      previous.endSeconds = section.startSeconds;
      if (previous.endSeconds - previous.startSeconds < 0.5) sections.pop();
    }
    sections.push(section);
  }

  const tempo = finite(data.tempoBpm) && data.tempoBpm >= 20 && data.tempoBpm <= 400 ? round(data.tempoBpm, 2) : null;
  const downbeat =
    finite(data.firstDownbeatSeconds) && data.firstDownbeatSeconds >= low - 1 && data.firstDownbeatSeconds < high
      ? round(Math.max(low, data.firstDownbeatSeconds))
      : null;
  const capo = Number.isInteger(data.capoGuess) && Number(data.capoGuess) >= 0 && Number(data.capoGuess) <= 12
    ? Number(data.capoGuess)
    : null;
  sanitized.outsideWindowSeconds = round(sanitized.outsideWindowSeconds, 2);
  return {
    tempoBpm: tempo,
    meter: data.meter === "3/4" ? 3 : data.meter === "4/4" ? 4 : null,
    key: normalizeKey(data.key),
    capoGuess: capo,
    firstDownbeatSeconds: downbeat,
    sections,
    chords: ordered,
    sanitized,
    timingSuspect: reportedSeconds > 0 && sanitized.outsideWindowSeconds / reportedSeconds > 0.5,
  };
}

export function usageFrom(raw: unknown) {
  const usage = isObject(raw) && isObject(raw.usageMetadata) ? raw.usageMetadata : null;
  if (!usage) return null;
  const count = (value: unknown) => (Number.isInteger(value) && Number(value) >= 0 ? Number(value) : 0);
  return {
    promptTokens: count(usage.promptTokenCount),
    outputTokens: count(usage.candidatesTokenCount) + count(usage.thoughtsTokenCount),
    totalTokens: count(usage.totalTokenCount),
  };
}

/** Maps a Gemini HTTP error to a clear, non-leaky message. Provider text is never echoed. */
export function classifyGeminiError(httpStatus: number, body: unknown): YouTubeImportError {
  const error = isObject(body) && isObject(body.error) ? body.error : {};
  const message = typeof error.message === "string" ? error.message : "";
  const status = typeof error.status === "string" ? error.status : "";
  if (httpStatus === 429 || status === "RESOURCE_EXHAUSTED")
    return new YouTubeImportError(429, "This FretShift server has used its Gemini quota for now. Try again later.", {
      code: "provider-quota",
    });
  if (httpStatus === 400 || status === "INVALID_ARGUMENT" || status === "FAILED_PRECONDITION") {
    if (/api.?key/i.test(message))
      return new YouTubeImportError(503, "YouTube import is not configured correctly on the server.", {
        code: "not-configured",
      });
    if (/token|too (long|large)|exceed|context window|duration/i.test(message))
      return new YouTubeImportError(413, "This video is too long for one Gemini request. Choose a shorter start/end range.", {
        code: "too-long",
      });
    if (/private|unlisted|unavailable|not available|accessib|permission|age|region|removed|not found|does not exist/i.test(message))
      return new YouTubeImportError(
        422,
        "Gemini could not open this video. It may be private, unlisted, age-restricted, region-blocked or removed. Only public videos can be analyzed.",
        { code: "private-video" },
      );
    // Google reports intermittent 400s for valid public YouTube URLs that succeed on retry.
    return new YouTubeImportError(502, "Gemini rejected this video request. Retry once; if it keeps failing, Gemini cannot use this video.", {
      code: "provider-rejected",
      retryable: true,
    });
  }
  if (httpStatus === 401 || httpStatus === 403)
    return new YouTubeImportError(503, "The server's Gemini API key was rejected. Ask the app owner to check GEMINI_API_KEY.", {
      code: "not-configured",
    });
  if (httpStatus === 404)
    return new YouTubeImportError(503, "The configured Gemini model is unavailable. Ask the app owner to check GEMINI_MODEL.", {
      code: "not-configured",
    });
  if (httpStatus === 504 || status === "DEADLINE_EXCEEDED")
    return new YouTubeImportError(504, "Gemini took too long. Retry, or analyze a shorter range.", { code: "timeout", retryable: true });
  return new YouTubeImportError(502, "Gemini is temporarily unavailable. Retry shortly.", {
    code: "provider-unavailable",
    retryable: httpStatus >= 500,
  });
}

/**
 * YouTube oEmbed is a free metadata endpoint (no video bytes). It rejects
 * private and non-embeddable videos before any paid Gemini call. Returns null
 * when the result is inconclusive so the import can still try Gemini.
 */
export function interpretOEmbed(status: number, body: unknown): { title?: string; channel?: string } | null {
  if (status === 200) {
    const text = (value: unknown) => (typeof value === "string" && value.length <= 300 ? value : undefined);
    return isObject(body) ? { title: text(body.title), channel: text(body.author_name) } : {};
  }
  if (status === 401 || status === 403)
    throw new YouTubeImportError(
      422,
      "This video is private or its owner turned off embedding. FretShift can analyze only public videos that play in an embedded player.",
      { code: "private-video" },
    );
  if (status === 404)
    throw new YouTubeImportError(404, "That YouTube video does not exist or was removed.", { code: "not-found" });
  if (status === 400)
    throw new YouTubeImportError(400, "YouTube did not recognize that link.", { code: "invalid-url" });
  return null;
}
