export const MAX_PAGES = 10;
export const MAX_BODY_BYTES = 42 * 1024 * 1024;

export class VisionProxyError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

type Page = {
  id: string;
  fileName: string;
  dataUrl: string;
  width: number;
  height: number;
};
type Hints = { title?: string; artist?: string; pageOrder?: string };

const isObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);
const boundedString = (value: unknown, max: number) =>
  typeof value === "string" && value.length <= max;

export async function readRequestJson(
  request: Request,
  maxBytes = MAX_BODY_BYTES,
): Promise<unknown> {
  if (!request.body)
    throw new VisionProxyError(400, "Request body must be valid JSON.");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > maxBytes) {
      await reader.cancel();
      throw new VisionProxyError(413, "Vision request exceeds 42 MB.");
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
    throw new VisionProxyError(400, "Request body must be valid JSON.");
  }
}

export function validateVisionRequest(raw: unknown): {
  pages: Page[];
  hints: Hints;
} {
  if (
    !isObject(raw) ||
    !Array.isArray(raw.pages) ||
    raw.pages.length < 1 ||
    raw.pages.length > MAX_PAGES
  )
    throw new VisionProxyError(400, `Send between 1 and ${MAX_PAGES} pages.`);
  const pages = raw.pages.map((value) => {
    if (
      !isObject(value) ||
      !boundedString(value.id, 200) ||
      !value.id ||
      !boundedString(value.fileName, 300) ||
      !value.fileName ||
      typeof value.dataUrl !== "string" ||
      !/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(value.dataUrl) ||
      !Number.isInteger(value.width) ||
      !Number.isInteger(value.height) ||
      Number(value.width) < 1 ||
      Number(value.height) < 1 ||
      Math.max(Number(value.width), Number(value.height)) > 1600
    )
      throw new VisionProxyError(
        400,
        "Every page needs a unique ID, filename, dimensions, and preprocessed JPEG data URL.",
      );
    return value as Page;
  });
  if (new Set(pages.map((page) => page.id)).size !== pages.length)
    throw new VisionProxyError(400, "Every page ID must be unique.");
  const encodedBytes = pages.reduce((sum, page) => {
    const data = page.dataUrl.slice(page.dataUrl.indexOf(",") + 1);
    return (
      sum +
      Math.floor((data.length * 3) / 4) -
      (data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0)
    );
  }, 0);
  if (encodedBytes > MAX_BODY_BYTES)
    throw new VisionProxyError(
      413,
      "Encoded page data exceeds the upload limit.",
    );
  const sourceHints = raw.hints ?? {};
  if (
    !isObject(sourceHints) ||
    Object.keys(sourceHints).some(
      (name) => !["title", "artist", "pageOrder"].includes(name),
    )
  )
    throw new VisionProxyError(
      400,
      "Hints must use only title, artist, and pageOrder.",
    );
  const hints: Hints = {};
  for (const [name, max] of [
    ["title", 160],
    ["artist", 160],
    ["pageOrder", 500],
  ] as const) {
    const value = sourceHints[name];
    if (value !== undefined && !boundedString(value, max))
      throw new VisionProxyError(400, `${name} hint is too long.`);
    if (typeof value === "string") hints[name] = value;
  }
  return { pages, hints };
}

export function parseOcrSpaceResult(raw: unknown) {
  if (
    !isObject(raw) ||
    raw.IsErroredOnProcessing === true ||
    !Array.isArray(raw.ParsedResults) ||
    raw.ParsedResults.length !== 1
  )
    throw new VisionProxyError(502, "OCR.space could not read this page.");
  const page = raw.ParsedResults[0];
  if (
    !isObject(page) ||
    Number(page.FileParseExitCode) !== 1 ||
    typeof page.ParsedText !== "string" ||
    !page.ParsedText.trim()
  )
    throw new VisionProxyError(502, "OCR.space could not read this page.");
  return page.ParsedText.replace(/\r\n?/g, "\n").trim();
}
