import { z } from "zod";

export const ChatWindowRectSchema = z.object({
  x: z.number().finite().min(0).max(10000),
  y: z.number().finite().min(0).max(10000),
  width: z.number().finite().min(320).max(10000),
  height: z.number().finite().min(320).max(10000),
});
export type ChatWindowRect = z.infer<typeof ChatWindowRectSchema>;

export const ReaderPreferencesSchema = z.object({
  rotation: z
    .union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)])
    .default(0),
  theme: z.enum(["system", "light", "dark"]).default("system"),
  navigation: z.boolean().default(false),
  navigationWidth: z.number().min(220).max(320).default(240),
  panel: z.enum(["none", "chat", "notes"]).default("none"),
  panelWidth: z.number().min(320).max(1600).default(400),
  chatWindow: ChatWindowRectSchema.optional(),
  zoom: z.number().min(0.4).max(3).default(1.1),
  experimentalTools: z.boolean().default(false),
});
export type ReaderPreferences = z.infer<typeof ReaderPreferencesSchema>;
