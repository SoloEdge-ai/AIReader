import { z } from "zod";

export const ReaderToolSchema = z.enum([
  "pointer", "text", "region", "sticky", "pen", "highlighter", "eraser",
  "free-text", "note-card", "rectangle", "ellipse", "line", "arrow", "link", "lasso",
]);
export type ReaderTool = z.infer<typeof ReaderToolSchema>;

export const BrushStyleSchema = z.object({
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  width: z.number().finite().min(0.5).max(100),
  opacity: z.number().finite().min(0.05).max(1),
}).strict();
export type BrushStyle = z.infer<typeof BrushStyleSchema>;

export const ToolPreferencesSchema = z.object({
  dock: z.enum(["bottom", "left", "right"]).default("bottom"),
  offset: z.number().finite().min(0).max(1).default(0.5),
  collapsedOffset: z.number().finite().min(0).max(1).default(0.5),
  collapsed: z.boolean().default(false),
  pen: BrushStyleSchema.default({ color: "#345d84", width: 2, opacity: 1 }),
  highlighter: BrushStyleSchema.default({ color: "#e6b72d", width: 12, opacity: 0.3 }),
}).strict();
export type ToolPreferences = z.infer<typeof ToolPreferencesSchema>;
