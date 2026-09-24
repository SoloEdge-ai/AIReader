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
