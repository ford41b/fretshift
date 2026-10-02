import { z } from "zod";
import type { Song } from "../schema/song.v1";

export const MAX_VISION_PAGES = 10;
export const MAX_VISION_FILE_BYTES = 12 * 1024 * 1024;
export const MAX_VISION_TOTAL_BYTES = 40 * 1024 * 1024;
export const MAX_OCR_SPACE_PAGE_BYTES = 1_000_000;

export type VisionSource = "photo" | "pdf-scan";

export type PreparedVisionPage = {
  id: string;
  fileName: string;
  dataUrl: string;
  width: number;
  height: number;
};

export const PreparedVisionPageSchema = z
  .object({
    id: z.string().min(1).max(200),
    fileName: z.string().min(1).max(300),
    dataUrl: z.string().regex(/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/),
    width: z.number().int().min(1).max(1600),
    height: z.number().int().min(1).max(1600),
  })
  .strict();

const RecognizedPageSchema = z
  .object({
    id: z.string().min(1).max(200),
    text: z.string().min(1),
  })
  .strict();
export const VisionWireResultSchema = z
  .object({
    pages: z.array(RecognizedPageSchema).min(1).max(MAX_VISION_PAGES),
    pageIds: z.array(z.string().min(1)).min(1).max(MAX_VISION_PAGES),
    modelId: z.string().min(1),
    promptVersion: z.string().min(1),
    processedAt: z.string().datetime(),
  })
  .strict();

export type VisionWireResult = z.infer<typeof VisionWireResultSchema>;
export type VisionResult = Omit<VisionWireResult, "pages"> & { song: Song };

export type VisionHints = {
  title?: string;
  artist?: string;
  pageOrder?: string;
};

export const VisionHintsSchema = z
  .object({
    title: z.string().max(160).optional(),
    artist: z.string().max(160).optional(),
    pageOrder: z.string().max(500).optional(),
  })
  .strict();
