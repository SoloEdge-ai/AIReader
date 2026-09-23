import { z } from "zod";

export const ReaderToolSchema = z.enum(["pointer", "text", "region", "sticky"]);
export type ReaderTool = z.infer<typeof ReaderToolSchema>;

export const ToolPreferencesSchema = z.object({
  dock: z.enum(["bottom", "left", "right"]).default("bottom"),
  offset: z.number().finite().min(0).max(1).default(0.5),
  collapsed: z.boolean().default(false),
}).strict();
export type ToolPreferences = z.infer<typeof ToolPreferencesSchema>;
