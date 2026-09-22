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
  rotation: z
    .union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)])
    .default(0),
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
  model?: string;
  effort?: string;
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
  model?: string;
  effort?: string;
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
  type:
    | "book"
    | "turn"
    | "index"
    | "account"
    | "runtime"
    | "annotation"
    | "note";
  bookId?: string;
  taskId?: string;
  data?: unknown;
}
export interface ModelOption {
  id: string;
  model: string;
  displayName: string;
  isDefault?: boolean;
  supportedReasoningEfforts: {
    reasoningEffort: string;
    description?: string;
  }[];
  defaultReasoningEffort: string;
}
export const ModelSelectionSchema = z.object({
  model: z.string().min(1).max(100),
  effort: z.string().min(1).max(30),
});
export type ModelSelection = z.infer<typeof ModelSelectionSchema>;
export interface AiRuntimeStatus {
  status: "missing" | "downloading" | "verifying" | "ready" | "error";
  version: string;
  received?: number;
  total?: number;
  error?: string;
}
export interface AccountState {
  connected: boolean;
  version?: string;
  account?: { type: string; email?: string | null; planType?: string } | null;
  error?: string;
  login?: { loginId: string; authUrl: string } | null;
}
export const PdfAnchorSchema = z.object({
  page: z.number().int().positive(),
  rects: z
    .array(
      z.tuple([
        z.number().finite().min(-200000).max(200000),
        z.number().finite().min(-200000).max(200000),
        z.number().finite().min(-200000).max(200000),
        z.number().finite().min(-200000).max(200000),
      ]),
    )
    .min(1)
    .max(500),
});
export type PdfAnchor = z.infer<typeof PdfAnchorSchema>;
export const AnnotationInputSchema = z.object({
  kind: z.enum(["highlight", "underline", "strike", "sticky", "region"]),
  color: z.enum(["yellow", "green", "blue", "pink"]).default("yellow"),
  quote: z.string().max(20000).default(""),
  anchors: z.array(PdfAnchorSchema).min(1).max(50),
  image: z
    .string()
    .max(12 * 1024 * 1024)
    .optional(),
});
export interface RichNode {
  type: string;
  text?: string;
  attrs?: Record<string, unknown>;
  content?: RichNode[];
  marks?: { type: string; attrs?: Record<string, unknown> }[];
}
export interface Annotation
  extends Omit<z.infer<typeof AnnotationInputSchema>, "image"> {
  id: string;
  bookId: string;
  fingerprint: string;
  noteId: string;
  assetId?: string;
  createdAt: string;
  updatedAt: string;
  revision: number;
  deletedAt?: string;
}
export interface Note {
  id: string;
  bookId: string;
  annotationId?: string;
  title: string;
  document: RichNode;
  createdAt: string;
  updatedAt: string;
  revision: number;
  deletedAt?: string;
}
export interface ReadingSelection {
  text: string;
  page: number;
  anchors: PdfAnchor[];
  screen: { x: number; y: number };
}
