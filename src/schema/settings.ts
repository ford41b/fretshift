import { z } from "zod";
export const SettingsSchema = z.object({
  theme: z.enum(["system", "dark", "light"]).default("system"),
  interfaceScale: z.number().min(0.85).max(1.2).default(1),
  leftHanded: z.boolean().default(false),
  a4Hz: z.number().min(432).max(446).default(440),
  defaultView: z.enum(["chord", "tab", "combined"]).default("combined"),
  metronome: z
    .object({
      sound: z.enum(["click", "wood", "beep"]),
      countIn: z.union([z.literal(0), z.literal(1), z.literal(2)]),
      accentDownbeat: z.boolean(),
      subdivisionClicks: z.boolean(),
    })
    .default({
      sound: "click",
      countIn: 1,
      accentDownbeat: true,
      subdivisionClicks: false,
    }),
  nameDisplay: z.enum(["sounding", "shape"]).default("sounding"),
});
export type Settings = z.infer<typeof SettingsSchema>;
export const defaultSettings = SettingsSchema.parse({});
