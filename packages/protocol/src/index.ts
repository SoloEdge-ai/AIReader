import { z } from "zod";
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
export interface Chapter {
  depth?: number;
  parentId?: string;
  id: string;
  title: string;
  page: number;
  endPage: number;
  inferred: boolean;
}
export interface Book {
  lastOpenedAt?: string;
  id: string;
  fingerprint: string;
  title: string;
  pages: number;
  parsedPages: number;
  textPages: number;
  status: "queued" | "parsing" | "ready" | "error";
  error?: string;
  progress: number;
  createdAt: string;
  chapters: Chapter[];
  labels: string[];
  indexVersion: number;
}
export const ReaderPreferencesSchema = z.object({
  theme: z.enum(["system", "light", "dark"]).default("system"),
  navigation: z.boolean().default(false),
  panel: z.enum(["none", "chat", "notes"]).default("none"),
  panelWidth: z.number().min(320).max(560).default(400),
  zoom: z.number().min(0.4).max(3).default(1.1),
  experimentalTools: z.boolean().default(false),
});
export type ReaderPreferences = z.infer<typeof ReaderPreferencesSchema>;
export interface Bookmark {
  id: string;
  bookId: string;
  page: number;
  note: string;
}
export interface IndexJob {
  id: string;
  bookId: string;
  kind: "semantic";
  status: "queued" | "running" | "paused" | "cancelled" | "complete" | "error";
  completed: string[];
  error?: string;
  full: boolean;
}
export interface SemanticNode {
  id: string;
  bookId: string;
  title: string;
  summary: string;
  concepts: string[];
  sourcePassageIds: string[];
  indexVersion: number;
}
export interface ContextManifest {
  estimatedTokens: number;
  budget: number;
  coverage: string;
  reading: ReadingSnapshot;
  evidence: Passage[];
  memory: string;
  recent: string;
  navigation: string;
}
export interface ToolRun {
  id: string;
  bookId: string;
  turnId: string;
  command: string;
  output: string;
  status: "running" | "complete" | "failed";
  files?: string[];
}
export interface ChatTurn {
  id: string;
  bookId: string;
  sessionId: string;
  question: string;
  answer: string;
  status: "running" | "complete" | "cancelled" | "error";
  error?: string;
  createdAt: string;
  context: ContextManifest;
  citations: SourceAnchor[];
  tools: ToolRun[];
  usage?: unknown;
}
export interface CoreEvent {
  type: "book" | "turn" | "index" | "account";
  bookId?: string;
  taskId?: string;
  data?: unknown;
}
