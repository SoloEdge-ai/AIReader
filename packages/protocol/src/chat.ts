import type { ReadingSnapshot, Passage, SourceAnchor } from "./reading";
import type { ChatImage } from "./images";

export interface ContextManifest {
  estimatedTokens: number;
  budget: number;
  coverage: string;
  reading: ReadingSnapshot;
  evidence: Passage[];
  memory: string;
  recent: string;
  navigation: string;
  materials?: import("./question-materials").QuestionMaterialSnapshot[];
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
  images?: ChatImage[];
  materialIds?: string[];
  /** Service-provided public summary only; absent on records predating summary support. */
  reasoning?: string;
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
