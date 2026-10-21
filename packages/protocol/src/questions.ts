import { z } from "zod";
import { QuestionMaterialInputSchema, type QuestionMaterialSnapshot, type QuestionMaterialTarget } from "./question-materials";

const id = z.string().min(1).max(100).regex(/^[a-zA-Z0-9_-]+$/);
export const QuestionStateSchema = z.enum(["open", "exploring", "concluded", "review"]);
export const QuestionMetadataSchema = z.object({
  status: QuestionStateSchema,
  sessionId: id.optional(),
  sourceTurnId: id.optional(),
  sourceQuestion: z.string().max(6000).optional(),
  materialCount: z.number().int().min(0).max(20).default(0),
  conclusionNoteIds: z.array(id).max(100),
  currentConclusionId: id.optional(),
  parentQuestionId: id.optional(),
}).strict().superRefine((value, context) => {
  if (new Set(value.conclusionNoteIds).size !== value.conclusionNoteIds.length ||
      value.currentConclusionId && !value.conclusionNoteIds.includes(value.currentConclusionId))
    context.addIssue({ code: "custom", message: "问题结论引用无效" });
});
export type QuestionMetadata = z.infer<typeof QuestionMetadataSchema>;
export const questionStateLabels: Record<QuestionMetadata["status"], string> = {
  open: "待探索", exploring: "探索中", concluded: "已有结论", review: "待复核",
};

export type QuestionSummary = {
  id: string; bookId: string; bookTitle: string; title: string;
  status: QuestionMetadata["status"]; updatedAt: string; lastOpenedAt?: string;
  currentConclusionId?: string; conclusionTitle?: string; materialCount: number; cardId?: string; placed: boolean;
};
export type MaterialReviewPlan = {
  bookId: string; questionId: string; questionRevision: number; sessionId: string;
  workspaceRevision: number; baselineTurnId?: string; baseline: QuestionMaterialSnapshot[];
  targets: { target: QuestionMaterialTarget; title: string; available: boolean; added: boolean;
    relation?: { from: string; to: string } }[];
};
export type MaterialReviewEntry = {
  targetId: string; title: string; status: "added" | "updated" | "unchanged" | "missing" | "removed";
  before: import("./question-materials").QuestionMaterialSection[];
  after: import("./question-materials").QuestionMaterialSection[];
};
export type MaterialReview = {
  plan: MaterialReviewPlan; latest: QuestionMaterialSnapshot; entries: MaterialReviewEntry[];
};
export const MaterialReviewInputSchema = QuestionMaterialInputSchema.omit({ bookId: true, sessionId: true }).safeExtend({
  questionRevision: z.number().int().positive(), baselineTurnId: id.optional(),
});
