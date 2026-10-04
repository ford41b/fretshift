import { cloudConfig, getAccessToken, getSession } from "../cloud/client";
import { planRequests } from "./accuracy";
import { combineResponses, type YouTubeImportResult } from "./review";
import {
  YouTubeHintsSchema,
  YouTubeWireSchema,
  type AccuracyOptions,
  type AnalysisRange,
  type PlannedRequest,
  type YouTubeHints,
  type YouTubeWire,
} from "./types";
import { parseYouTubeVideoId, watchUrl } from "./url";

export type YouTubeTransport = (request: Request, signal: AbortSignal) => Promise<unknown>;

export class YouTubeImportRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly retryable: boolean,
    readonly retryAfterSeconds = 0,
  ) {
    super(message);
    this.name = "YouTubeImportRequestError";
  }
}

const fetchTransport: YouTubeTransport = async (request, signal) => {
  const response = await fetch(request, { signal });
  const body = await response.json().catch(() => null) as { error?: unknown; code?: unknown; retryable?: unknown } | null;
  if (!response.ok)
    throw new YouTubeImportRequestError(
      typeof body?.error === "string" ? body.error : `YouTube import returned HTTP ${response.status}.`,
      response.status,
      typeof body?.code === "string" ? body.code : "http",
      typeof body?.retryable === "boolean" ? body.retryable : response.status >= 500 && response.status !== 503,
      Number(response.headers.get("Retry-After")) || 0,
    );
  return body;
};

export type ServiceStatus = { reachable: boolean; providerConfigured: boolean | null; modelId?: string };

/** Unauthenticated GET; reports whether the server has a Gemini key. Never throws. */
export async function youtubeServiceStatus(signal?: AbortSignal): Promise<ServiceStatus> {
  const config = cloudConfig();
  if (!config) return { reachable: false, providerConfigured: false };
  try {
    const response = await fetch(`${config.url}/functions/v1/youtube-import`, { headers: { apikey: config.key }, signal });
    if (!response.ok) return { reachable: false, providerConfigured: null };
    const body = await response.json() as { providerConfigured?: unknown; modelId?: unknown };
    return { reachable: true, providerConfigured: typeof body.providerConfigured === "boolean" ? body.providerConfigured : null,
      ...(typeof body.modelId === "string" ? { modelId: body.modelId } : {}) };
  } catch {
    return { reachable: false, providerConfigured: null };
  }
}

const abortError = () => new DOMException("YouTube import cancelled", "AbortError");

function describe(error: unknown): string {
  if (error instanceof YouTubeImportRequestError) return error.message;
  if (error instanceof DOMException && error.name === "TimeoutError") return "The YouTube import request timed out.";
  if (error instanceof TypeError && /fetch|load failed|network/i.test(error.message))
    return "Could not reach the YouTube import service. Check your connection, and verify the youtube-import function is deployed and allows this app's origin (ALLOWED_ORIGINS).";
  if (error && typeof error === "object" && "issues" in error) return "The YouTube import service returned an answer FretShift could not verify.";
  return error instanceof Error ? error.message : String(error);
}

const transient = (error: unknown) =>
  error instanceof YouTubeImportRequestError ? error.retryable :
    !(error instanceof Error && /signed-in account|sign in/i.test(error.message));

export type AnalyzeParams = {
  url: string;
  range: AnalysisRange;
  options: AccuracyOptions;
  hints?: YouTubeHints;
  videoDurationSeconds?: number;
  signal?: AbortSignal;
  transport?: YouTubeTransport;
  /** Completed parts survive a failed or cancelled run, so Retry only redoes what is missing. */
  cache?: Map<string, YouTubeWire>;
  onProgress?: (progress: { done: number; total: number; current: PlannedRequest[] }) => void;
  timeoutMs?: number;
};

export const requestKey = (videoId: string, planned: PlannedRequest, hints: YouTubeHints) =>
  JSON.stringify([videoId, planned.segment.startSeconds, planned.segment.endSeconds, planned.fps, planned.pass, hints]);

/** Runs every planned window × pass through the Edge Function and combines them. Nothing is saved. */
export async function analyzeYouTube(params: AnalyzeParams): Promise<YouTubeImportResult> {
  const videoId = parseYouTubeVideoId(params.url);
  if (!videoId) throw new Error("Paste a youtube.com/watch, youtu.be or youtube.com/shorts link to one video.");
  const config = cloudConfig();
  if (!config) throw new Error("YouTube import isn't configured. Add the Supabase URL and public key first.");
  const accountId = getSession()?.user.id;
  if (!accountId) throw new Error("Sign in under Account & sync to analyze YouTube links.");
  const hints = params.options.useHints ? YouTubeHintsSchema.parse(params.hints ?? {}) : {};
  const plan = planRequests(params.range, params.options);
  const cache = params.cache ?? new Map<string, YouTubeWire>();
  const transport = params.transport ?? fetchTransport;
  const signal = params.signal;
  const timeoutMs = params.timeoutMs ?? 150_000;
  const results: Array<{ planned: PlannedRequest; wire: YouTubeWire }> = [];
  const inFlight = new Set<PlannedRequest>();
  const report = () => params.onProgress?.({ done: results.length, total: plan.length, current: [...inFlight] });

  async function run(planned: PlannedRequest): Promise<YouTubeWire> {
    const key = requestKey(videoId!, planned, hints);
    const cached = cache.get(key);
    if (cached) return cached;
    let lastError: unknown;
    for (let attempt = 0; attempt < 2; attempt++) {
      if (signal?.aborted) throw abortError();
      const token = await getAccessToken();
      if (!token || getSession()?.user.id !== accountId)
        throw new Error("The signed-in account changed. Start the YouTube import again.");
      const controller = new AbortController();
      const onAbort = () => controller.abort();
      signal?.addEventListener("abort", onAbort, { once: true });
      const timer = setTimeout(() => controller.abort(new DOMException("timeout", "TimeoutError")), timeoutMs);
      try {
        const raw = await transport(new Request(`${config!.url}/functions/v1/youtube-import`, {
          method: "POST",
          headers: { "Content-Type": "application/json", apikey: config!.key, Authorization: `Bearer ${token}` },
          body: JSON.stringify({ url: watchUrl(videoId!), segment: planned.segment, fps: planned.fps, pass: planned.pass,
            hints, ...(params.videoDurationSeconds ? { videoDurationSeconds: params.videoDurationSeconds } : {}) }),
        }), controller.signal);
        const wire = YouTubeWireSchema.parse(raw);
        if (wire.videoId !== videoId || wire.pass !== planned.pass ||
            Math.abs(wire.segment.startSeconds - planned.segment.startSeconds) > 0.001 ||
            Math.abs(wire.segment.endSeconds - planned.segment.endSeconds) > 0.001)
          throw new Error("The YouTube import answer did not match the requested video range.");
        // The account must still be the one that started the import when the answer lands.
        if (getSession()?.user.id !== accountId)
          throw new Error("The signed-in account changed. Start the YouTube import again.");
        cache.set(key, wire);
        return wire;
      } catch (error) {
        if (signal?.aborted) throw abortError();
        lastError = controller.signal.aborted && !(error instanceof YouTubeImportRequestError)
          ? new DOMException("timeout", "TimeoutError") : error;
        if (!transient(lastError)) break;
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
      }
    }
    throw lastError;
  }

  const queue = [...plan];
  const state: { failure: { planned: PlannedRequest; error: unknown } | null } = { failure: null };
  async function worker() {
    while (queue.length && !state.failure) {
      const planned = queue.shift()!;
      inFlight.add(planned);
      report();
      try {
        results.push({ planned, wire: await run(planned) });
      } catch (error) {
        state.failure ??= { planned, error };
      } finally {
        inFlight.delete(planned);
        report();
      }
    }
  }
  await Promise.all([worker(), worker()]);
  if (signal?.aborted) throw abortError();
  if (state.failure) {
    const { planned, error } = state.failure;
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    const part = plan.length > 1 ? ` (part ${plan.indexOf(planned) + 1} of ${plan.length})` : "";
    const kept = results.length ? ` ${results.length} completed part${results.length === 1 ? " is" : "s are"} kept for Retry.` : "";
    const wrapped = new Error(`${describe(error)}${part}${kept}`);
    if (error instanceof YouTubeImportRequestError) Object.assign(wrapped, { status: error.status, code: error.code });
    throw wrapped;
  }
  results.sort((a, b) => plan.indexOf(a.planned) - plan.indexOf(b.planned));
  return combineResponses(videoId, params.range, params.options, results);
}
