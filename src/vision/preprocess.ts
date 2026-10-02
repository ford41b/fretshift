import type { PDFDocumentProxy } from "pdfjs-dist/types/src/display/api";
import pdfWorkerUrl from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url";
import {
  MAX_OCR_SPACE_PAGE_BYTES,
  MAX_VISION_FILE_BYTES,
  MAX_VISION_PAGES,
  MAX_VISION_TOTAL_BYTES,
  type PreparedVisionPage,
} from "./types";

export type CropEdges = { top: number; right: number; bottom: number; left: number };
export type PageAdjustments = { rotation?: 0 | 90 | 180 | 270; crop?: number | CropEdges };
export function cropRectangle(width: number, height: number, crop: PageAdjustments["crop"] = 0): [number, number, number, number] {
  const edges: CropEdges = typeof crop === "number"
    ? { top: crop, right: crop, bottom: crop, left: crop }
    : crop ?? { top: 0, right: 0, bottom: 0, left: 0 };
  const safe = (n: number) => Number.isFinite(n) ? Math.min(.45, Math.max(0, n)) : 0;
  const left = safe(edges.left), right = safe(edges.right);
  const top = safe(edges.top), bottom = safe(edges.bottom);
  return [Math.round(width * left), Math.round(height * top),
    Math.max(1, Math.round(width * (1 - left - right))),
    Math.max(1, Math.round(height * (1 - top - bottom)))];
}
/** Dense sheets are divided into overlapping upper/lower areas so chord suffixes
 * survive the provider's 1 MB / 1600px limit. Each tile is shown before OCR. */
export function tileCrops(crop: PageAdjustments["crop"] = 0): CropEdges[] {
  const e: CropEdges = typeof crop === "number"
    ? { top: crop, right: crop, bottom: crop, left: crop }
    : crop ?? { top: 0, right: 0, bottom: 0, left: 0 };
  const midpoint = (e.top + 1 - e.bottom) / 2;
  const overlap = (1 - e.top - e.bottom) * .035;
  return [{ ...e, bottom: 1 - Math.min(1 - e.bottom, midpoint + overlap) },
    { ...e, top: Math.max(e.top, midpoint - overlap) }];
}

type Raster = { width: number; height: number; close?: () => void };
type RasterDeps = {
  decode: (blob: Blob) => Promise<Raster>;
  encode: (
    source: Raster,
    sourceRect: [number, number, number, number],
    size: [number, number],
    rotation: number,
    quality: number,
  ) => Promise<Blob>;
};

function assertFiles(files: File[]) {
  if (!files.length)
    throw new Error("Choose at least one photo or scanned page.");
  if (files.length > MAX_VISION_PAGES)
    throw new Error(`Choose no more than ${MAX_VISION_PAGES} pages at once.`);
  const tooLarge = files.find((file) => file.size > MAX_VISION_FILE_BYTES);
  if (tooLarge)
    throw new Error(`${tooLarge.name} is larger than 12 MB. Resize it first.`);
  if (files.reduce((sum, file) => sum + file.size, 0) > MAX_VISION_TOTAL_BYTES)
    throw new Error("The selected pages exceed the 40 MB upload limit.");
  const unsupported = files.find(
    (file) => !file.type.startsWith("image/") && !/\.hei[cf]$/i.test(file.name),
  );
  if (unsupported)
    throw new Error(`${unsupported.name} is not a supported image.`);
}

export function fitVisionDimensions(
  width: number,
  height: number,
  edge = 1600,
) {
  const scale = Math.min(1, edge / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

async function normalizeHeic(file: File): Promise<Blob> {
  if (!/hei[cf]/i.test(file.type) && !/\.hei[cf]$/i.test(file.name))
    return file;
  const { default: heic2any } = await import("heic2any");
  const converted = await heic2any({
    blob: file,
    toType: "image/jpeg",
    quality: 0.9,
  });
  return Array.isArray(converted) ? converted[0] : converted;
}

/** Safari sometimes rejects canvas-generated PDF JPEGs with "Load failed" from
 * createImageBitmap even though <img> can display exactly the same Blob. Decode
 * through an image element as a fallback, and revoke its temporary URL once the
 * image has been drawn. Do not retry OCR for an image that could not be decoded. */
async function decodeImage(blob: Blob): Promise<Raster> {
  let bitmapFailure: unknown;
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(blob, { imageOrientation: "from-image" });
    } catch (cause) {
      bitmapFailure = cause;
    }
  }
  const url = URL.createObjectURL(blob);
  const image = new Image();
  try {
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("The browser could not display this image."));
      image.src = url;
    });
    if (!image.naturalWidth || !image.naturalHeight)
      throw new Error("The decoded image has no dimensions.");
    return Object.assign(image, {
      close: () => { image.src = ""; URL.revokeObjectURL(url); },
    });
  } catch (cause) {
    URL.revokeObjectURL(url);
    const original = bitmapFailure instanceof Error ? ` (bitmap: ${bitmapFailure.message})` : "";
    throw new Error(`Could not decode this image on your device${original}. ${cause instanceof Error ? cause.message : String(cause)}`);
  }
}

const browserDeps: RasterDeps = {
  decode: decodeImage,
  encode: async (
    source,
    [sx, sy, sw, sh],
    [width, height],
    rotation,
    quality,
  ) => {
    const turns = (rotation / 90) % 2;
    const canvas = document.createElement("canvas");
    canvas.width = turns ? height : width;
    canvas.height = turns ? width : height;
    const context = canvas.getContext("2d");
    if (!context)
      throw new Error("This browser cannot prepare images for import.");
    context.translate(canvas.width / 2, canvas.height / 2);
    context.rotate((rotation * Math.PI) / 180);
    context.drawImage(
      source as CanvasImageSource,
      sx,
      sy,
      sw,
      sh,
      -width / 2,
      -height / 2,
      width,
      height,
    );
    return new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (blob) =>
          blob
            ? resolve(blob)
            : reject(new Error("Could not encode this page.")),
        "image/jpeg",
        quality,
      ),
    );
  },
};

function blobToDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () =>
      reject(new Error("Could not read the prepared page."));
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(blob);
  });
}

export async function preprocessImage(
  file: File,
  adjustments: PageAdjustments = {},
  deps: RasterDeps = browserDeps,
): Promise<PreparedVisionPage> {
  const sourceBlob = await normalizeHeic(file);
  let raster: Raster;
  try {
    raster = await deps.decode(sourceBlob);
  } catch (cause) {
    throw new Error(`Could not prepare ${file.name}: ${cause instanceof Error ? cause.message : String(cause)} Try local PDF text if available, or choose a clear JPG/PNG image.`);
  }
  try {
    const [sx, sy, sw, sh] = cropRectangle(raster.width, raster.height, adjustments.crop);
    const rotation = adjustments.rotation ?? 0;
    const attempts = [
      { edge: 1600, quality: 0.86 },
      { edge: 1400, quality: 0.8 },
      { edge: 1200, quality: 0.74 },
      { edge: 1000, quality: 0.68 },
      { edge: 800, quality: 0.62 },
    ];
    let size = fitVisionDimensions(sw, sh, attempts[0].edge);
    let jpeg: Blob | undefined;
    for (const attempt of attempts) {
      size = fitVisionDimensions(sw, sh, attempt.edge);
      jpeg = await deps.encode(
        raster,
        [sx, sy, sw, sh],
        [size.width, size.height],
        rotation,
        attempt.quality,
      );
      if (jpeg.size <= MAX_OCR_SPACE_PAGE_BYTES) break;
    }
    if (!jpeg || jpeg.size > MAX_OCR_SPACE_PAGE_BYTES)
      throw new Error(
        "This page could not be compressed below OCR.space's 1 MB limit.",
      );
    return {
      id: crypto.randomUUID(),
      fileName: file.name,
      dataUrl: await blobToDataUrl(jpeg),
      width: rotation % 180 ? size.height : size.width,
      height: rotation % 180 ? size.width : size.height,
    };
  } finally {
    raster.close?.();
  }
}

export async function preprocessImages(
  files: File[],
  adjustments: PageAdjustments[] = [],
) {
  assertFiles(files);
  return Promise.all(
    files.map((file, index) => preprocessImage(file, adjustments[index])),
  );
}

export async function scannedPdfPages(file: File): Promise<File[]> {
  if (file.size > 25 * 1024 * 1024)
    throw new Error(
      "This PDF is larger than 25 MB. Split it before importing.",
    );
  const { getDocument, GlobalWorkerOptions } = await import(
    "pdfjs-dist/legacy/build/pdf.mjs"
  );
  if (typeof Worker !== "undefined")
    GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
  const pdf: PDFDocumentProxy = await getDocument({
    data: new Uint8Array(await file.arrayBuffer()),
    isEvalSupported: false,
    useSystemFonts: true,
  }).promise;
  if (pdf.numPages > MAX_VISION_PAGES)
    throw new Error(
      `This PDF has ${pdf.numPages} pages. Split it into groups of ${MAX_VISION_PAGES} or fewer.`,
    );
  try {
    const pages: File[] = [];
    // A mixed document must keep every page. Sending only its scanned pages
    // would silently lose text-layer verses and break page order.
    for (let number = 1; number <= pdf.numPages; number++) {
      const page = await pdf.getPage(number);
      const base = page.getViewport({ scale: 1 });
      // Keep source details for later user-selected crop/overlapping tiles.
      // Provider uploads are still capped at 1600px per prepared tile.
      const scale = Math.min(2.6, 2100 / Math.max(base.width, base.height));
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const context = canvas.getContext("2d");
      if (!context)
        throw new Error("This browser cannot render scanned PDF pages.");
      await page.render({ canvasContext: context, viewport }).promise;
      const blob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob(
          (value) =>
            value
              ? resolve(value)
              : reject(new Error(`Could not render PDF page ${number}.`)),
          "image/jpeg",
          0.9,
        ),
      );
      pages.push(
        new File([blob], `${file.name}-page-${number}.jpg`, {
          type: "image/jpeg",
        }),
      );
      page.cleanup();
    }
    return pages;
  } finally {
    await pdf.destroy();
  }
}
