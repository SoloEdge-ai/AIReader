import { z } from "zod";

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
