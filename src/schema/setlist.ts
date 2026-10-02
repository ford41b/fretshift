import { z } from "zod";
export const SetlistEntrySchema = z.object({
  songId: z.string(),
  note: z.string().optional(),
});
export type SetlistEntry = z.infer<typeof SetlistEntrySchema>;
export const SetlistSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  entries: z.array(SetlistEntrySchema),
  ownerId: z.string().nullable().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  deletedAt: z.string().datetime().nullable().optional(),
});
export type Setlist = z.infer<typeof SetlistSchema>;
