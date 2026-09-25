import { z } from "zod";
import type { PdfAnchor } from "./anchors";

export const ReadingSnapshotSchema = z.object({
  bookId: z.string().min(1),
  page: z.number().int().positive(),
  selection: z.string().max(12000).default(""),
  scope: z.enum(["auto", "selection", "chapter", "book"]).default("auto"),
});
export type ReadingSnapshot = z.infer<typeof ReadingSnapshotSchema>;
export interface SourceAnchor {
  bookId: string;
  fingerprint: string;
  passageId: string;
  indexVersion: number;
  page: number;
  label: string;
  rects: number[][];
}
export interface Passage {
  id: string;
  bookId: string;
  page: number;
  text: string;
  anchor: SourceAnchor;
}
export interface ReadingSelection {
  text: string;
  page: number;
  anchors: PdfAnchor[];
  screen: { x: number; y: number };
}
