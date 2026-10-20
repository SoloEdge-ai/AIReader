import { z } from "zod";
import type { PdfAnchor } from "./anchors";
import type { SourceAnchor } from "./reading";

export const MAX_QUESTION_MATERIALS = 20;

const identifier = z.string().min(1).max(100).regex(/^[a-zA-Z0-9_-]+$/);
export const QuestionMaterialTargetSchema = z.object({
  kind: z.enum(["card", "object", "annotation", "note", "relation"]),
  id: identifier,
  revision: z.number().int().nonnegative().optional(),
}).strict();
export type QuestionMaterialTarget = z.infer<typeof QuestionMaterialTargetSchema>;

export const QuestionMaterialPreviewInputSchema = z.object({
  objectIds: z.array(identifier).min(1).max(MAX_QUESTION_MATERIALS),
  surface: z.enum(["pdf", "board"]),
  page: z.number().int().positive().optional(),
  includesPdfBackground: z.boolean(),
  image: z.string().startsWith("data:image/png;base64,").max(12 * 1024 * 1024),
}).strict().superRefine((preview, context) => {
  if ((preview.surface === "pdf") !== Boolean(preview.page))
    context.addIssue({ code: "custom", message: "预览页面与表面类型不匹配" });
});
export const QuestionMaterialInputSchema = z.object({
  bookId: identifier,
  sessionId: identifier,
  requestId: identifier,
  workspaceRevision: z.number().int().nonnegative(),
  targets: z.array(QuestionMaterialTargetSchema).min(1).max(MAX_QUESTION_MATERIALS),
  previews: z.array(QuestionMaterialPreviewInputSchema).max(4).default([]),
}).strict();
export type QuestionMaterialInput = z.infer<typeof QuestionMaterialInputSchema>;

export type QuestionMaterialSection = {
  kind: "book-excerpt" | "book-region" | "user-note" | "user-mark" | "relation";
  targetId?: string;
  title: string;
  text: string;
  anchors?: PdfAnchor[];
  imageIds?: string[];
  /** Core-verified selected text only; never the rest of its containing page. */
  citation?: SourceAnchor;
  provenance?: { kind: "ai"; turnId: string; edited: boolean };
  relation?: { from: string; to: string; directed?: boolean };
};
export type QuestionMaterialImage = {
  id: string;
  name: string;
  width: number;
  height: number;
  bytes: number;
  /** Renderer previews are user-provided pixels, not Core-verified PDF originals. */
  userRendered: boolean;
  surface?: "pdf" | "board";
  page?: number;
  includesPdfBackground?: boolean;
  objectIds?: string[];
};
export type QuestionMaterialSnapshot = {
  id: string;
  bookId: string;
  sessionId: string;
  createdAt: string;
  title: string;
  itemCount: number;
  targets: QuestionMaterialTarget[];
  sections: QuestionMaterialSection[];
  images: QuestionMaterialImage[];
  committedTurnId?: string;
};

/** Project an immutable snapshot without re-reading or re-freezing its remaining objects. */
export function omitMaterialTargets(snapshot: QuestionMaterialSnapshot, omitted: string[]): QuestionMaterialSnapshot {
  const removed = new Set(omitted);
  const available = new Set(snapshot.targets.filter((target) => target.kind !== "relation" && !removed.has(target.id))
    .map((target) => target.id));
  const sections = snapshot.sections.filter((section) => !section.targetId || !removed.has(section.targetId))
    .filter((section) => !section.relation || available.has(section.relation.from) && available.has(section.relation.to));
  const sectionTargets = new Set(sections.map((section) => section.targetId));
  const targets = snapshot.targets.filter((target) => !removed.has(target.id) &&
    (target.kind !== "relation" || sectionTargets.has(target.id)));
  const imageIds = new Set(sections.flatMap((section) => section.imageIds ?? []));
  return { ...snapshot, targets, sections, images: snapshot.images.filter((image) => imageIds.has(image.id)),
    itemCount: targets.length };
}
export function questionMaterialCount(materials: Pick<QuestionMaterialSnapshot, "itemCount">[],
  imageCount = 0, hasSelection = false) {
  return materials.reduce((count, material) => count + material.itemCount,
    imageCount + Number(hasSelection));
}
export function questionMaterialImageCount(materials: Pick<QuestionMaterialSnapshot, "images">[],
  imageCount = 0) {
  return materials.reduce((count, material) => count + material.images.length, imageCount);
}
