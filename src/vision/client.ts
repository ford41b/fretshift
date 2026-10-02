import { cloudConfig, getAccessToken, getSession } from "../cloud/client";
import { pdfPagesToSongs } from "../io/pdfText";
import {
  MAX_VISION_PAGES,
  PreparedVisionPageSchema,
  VisionHintsSchema,
  VisionWireResultSchema,
  type PreparedVisionPage,
  type VisionHints,
  type VisionResult,
  type VisionSource,
} from "./types";

export type VisionTransport = (
  request: Request,
  signal: AbortSignal,
) => Promise<unknown>;

const fetchTransport: VisionTransport = async (request, signal) => {
  const response = await fetch(request, { signal });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      body && typeof body === "object" && "error" in body
        ? String(body.error)
        : `Vision proxy returned HTTP ${response.status}.`;
    throw new Error(`HTTP ${response.status}: ${message}`);
  }
  return body;
};

export function validateVisionResult(
  raw: unknown,
  source: VisionSource,
  expectedPageIds: string[],
  hints: VisionHints = {},
): VisionResult {
  const wire = VisionWireResultSchema.parse(raw);
  if (
    wire.pageIds.length !== expectedPageIds.length ||
    wire.pageIds.some((id, index) => id !== expectedPageIds[index]) ||
    wire.pages.length !== expectedPageIds.length ||
    wire.pages.some((page, index) => page.id !== expectedPageIds[index])
  )
    throw new Error("OCR response page IDs did not match the uploaded pages.");
  const song = pdfPagesToSongs(
    wire.pages.map((page, index) => ({ number: index + 1, text: page.text })),
    new Set(),
  )[0];
  if (hints.title) song.title = hints.title;
  if (hints.artist) song.artist = hints.artist;
  song.provenance = {
    source,
    modelId: wire.modelId,
    promptVersion: wire.promptVersion,
    processedAt: wire.processedAt,
  };
  const { pages: _pages, ...metadata } = wire;
  return { ...metadata, song };
}

function describeVisionFailure(error: unknown) {
  if (error instanceof DOMException && error.name === "AbortError")
    return "The vision service timed out.";
  if ((error instanceof TypeError || error instanceof Error) &&
      /fetch|load failed|network error/i.test(error.message))
    return "Could not reach the visual OCR service. Check your connection, and verify that the vision-import Supabase function is deployed and allows this app's origin (ALLOWED_ORIGINS).";
  return error instanceof Error ? error.message : String(error);
}

export async function importVision(
  pages: PreparedVisionPage[],
  source: VisionSource,
  hints: VisionHints = {},
  transport: VisionTransport = fetchTransport,
  timeoutMs = 30_000,
): Promise<VisionResult> {
  const validPages = pages.map((page) => PreparedVisionPageSchema.parse(page));
  if (!validPages.length || validPages.length > MAX_VISION_PAGES)
    throw new Error(`Choose between 1 and ${MAX_VISION_PAGES} prepared pages.`);
  if (new Set(validPages.map((page) => page.id)).size !== validPages.length)
    throw new Error("Prepared page IDs must be unique.");
  const validHints = VisionHintsSchema.parse(hints);
  const config = cloudConfig();
  if (!config)
    throw new Error(
      "Photo import isn't configured. Add the Supabase URL and anonymous key first.",
    );
  const accountId = getSession()?.user.id;
  const token = await getAccessToken();
  if (!token || !accountId || getSession()?.user.id !== accountId)
    throw new Error("The signed-in account changed. Start the import again.");
  const pageIds = validPages.map((page) => page.id);
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const request = new Request(`${config.url}/functions/v1/vision-import`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: config.key,
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ pages: validPages, hints: validHints }),
      });
      const raw = await transport(request, controller.signal);
      return validateVisionResult(raw, source, pageIds, validHints);
    } catch (error) {
      lastError = error;
    } finally {
      clearTimeout(timeout);
    }
  }
  const names = validPages
    .map((page, index) => `page ${index + 1} (${page.fileName})`)
    .join(", ");
  const detail = describeVisionFailure(lastError);
  throw new Error(
    `Could not read ${names} after one retry: ${detail} Use ChordPro or manual entry instead.`,
  );
}

/** OCR a SINGLE page. Keep recognized text even when it cannot be parsed as music.
 * The caller owns the page cache, so retrying page 4 cannot redo pages 1–3. */
export async function recognizeVisionTextPage(
  page: PreparedVisionPage,
  signal?: AbortSignal,
  transport: VisionTransport = fetchTransport,
  timeoutMs = 38_000,
): Promise<{ text: string; modelId: string; promptVersion: string }> {
  const valid = PreparedVisionPageSchema.parse(page);
  const config = cloudConfig();
  if (!config) throw new Error("Photo OCR is not configured. Local PDF text is still available.");
  const accountId = getSession()?.user.id;
  const token = await getAccessToken();
  if (!token || !accountId || getSession()?.user.id !== accountId)
    throw new Error("Sign in to run visual OCR. Local PDF text stays on your device.");
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (signal?.aborted) throw new DOMException("Import cancelled", "AbortError");
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    signal?.addEventListener("abort", onAbort, { once: true });
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const request = new Request(`${config.url}/functions/v1/vision-import`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: config.key,
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ pages: [valid], hints: {} }),
      });
      const response = VisionWireResultSchema.parse(await transport(request, controller.signal));
      if (response.pageIds.length !== 1 || response.pageIds[0] !== valid.id ||
          response.pages.length !== 1 || response.pages[0].id !== valid.id)
        throw new Error("OCR returned a page ID that does not match this upload.");
      return { text: response.pages[0].text, modelId: response.modelId, promptVersion: response.promptVersion };
    } catch (error) {
      if (signal?.aborted) throw new DOMException("Import cancelled", "AbortError");
      lastError = error;
      // Authentication/permission/configuration errors are not transient.
      if (error instanceof Error && /sign in|not configured|401|403|429.*limit/i.test(error.message)) break;
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", onAbort);
    }
  }
  throw new Error(`Page ${valid.fileName}: ${describeVisionFailure(lastError)} Retry this page without redoing completed pages.`);
}
