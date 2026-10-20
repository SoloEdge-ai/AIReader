import { z } from "zod";

const id = z.string().min(1).max(100).regex(/^[a-zA-Z0-9_-]+$/);
export const QuestionStateSchema = z.enum(["open", "exploring", "concluded", "review"]);
export const QuestionMetadataSchema = z.object({
  status: QuestionStateSchema,
  sessionId: id.optional(),
  sourceTurnId: id.optional(),
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
