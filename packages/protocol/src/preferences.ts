import { z } from "zod";

export const ChatWindowRectSchema = z.object({
  x: z.number().finite().min(0).max(10000),
  y: z.number().finite().min(0).max(10000),
  width: z.number().finite().min(320).max(10000),
  height: z.number().finite().min(320).max(10000),
});
export type ChatWindowRect = z.infer<typeof ChatWindowRectSchema>;

export const PdfViewSchema = z.object({
  page: z.number().int().positive().max(100000),
  x: z.number().finite().min(0).max(1),
  y: z.number().finite().min(0).max(1),
}).strict();
export type PdfView = z.infer<typeof PdfViewSchema>;

export const ReaderPreferencesSchema = z.object({
  rotation: z
    .union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)])
    .default(0),
  theme: z.enum(["system", "light", "dark"]).default("system"),
  visualStyle: z.enum(["professional", "paper"]).default("professional"),
  navigation: z.boolean().default(false),
  navigationWidth: z.number().min(220).max(320).default(240),
  panel: z.enum(["none", "chat", "notes"]).default("none"),
  panelWidth: z.number().min(320).max(1600).default(400),
  chatWindow: ChatWindowRectSchema.optional(),
  splitRatio: z.number().finite().min(0.3).max(0.7).default(0.5),
  readerPaneMode: z.enum(["split", "pdf", "board"]).default("split"),
  pdfZoom: z.number().finite().min(0.4).max(3).default(1.1),
  boardZoom: z.number().finite().min(0.4).max(3).default(1),
  pdfView: PdfViewSchema.optional(),
  experimentalTools: z.boolean().default(false),
}).strict();
export type ReaderPreferences = z.infer<typeof ReaderPreferencesSchema>;
