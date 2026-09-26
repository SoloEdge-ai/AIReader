import { z } from "zod";
import { PdfAnchorSchema } from "./anchors";
import type { SourceAnchor } from "./reading";
import type { ChatImage } from "./images";
import type { WorkspaceCard } from "./workspace";

const noteIdentity = z.string().min(1).max(100).regex(/^[a-zA-Z0-9_-]+$/);
const pdfCoordinate = z.number().finite().min(-200000).max(200000);
export const NoteReferenceRegionSchema = z.object({
  fingerprint: z.string().min(1).max(128),
  page: z.number().int().positive().max(100000),
  rect: z.tuple([pdfCoordinate, pdfCoordinate, pdfCoordinate, pdfCoordinate]),
  assetId: noteIdentity,
  includePersonalMarks: z.boolean(),
}).strict();
export const NoteSourceReferenceSchema = z.object({
  id: noteIdentity,
  kind: z.enum(["card", "annotation"]),
  targetId: noteIdentity,
  title: z.string().max(200),
  text: z.string().max(20000),
  source: z.object({
    fingerprint: z.string().min(1).max(128),
    anchors: z.array(PdfAnchorSchema).min(1).max(50),
  }).strict().optional(),
  region: NoteReferenceRegionSchema.optional(),
  regionAssetKind: z.enum(["workspace", "annotation"]).optional(),
}).strict().superRefine((reference, context) => {
  if (reference.kind === "annotation" && !reference.source)
    context.addIssue({ code: "custom", message: "标记来源必须保留 PDF 锚点" });
  if (Boolean(reference.region) !== Boolean(reference.regionAssetKind))
    context.addIssue({ code: "custom", message: "图片来源必须说明资源归属" });
});
export type NoteSourceReference = z.infer<typeof NoteSourceReferenceSchema>;
export const NoteSourceReferencesSchema = z.array(NoteSourceReferenceSchema).max(500);

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
  /** Core-validated Tiptap JSON. Supported content includes tables and
   * explicit inlineMath/blockMath nodes; formula source lives in attrs.latex. */
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
  noteId?: string;
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
  /** Immutable source retained if the excerpt card is later removed. */
  sourceCard?: Pick<WorkspaceCard, "kind" | "title" | "text" | "source" | "region"> & { cardId: string };
  /** Read-only source projection, including a deleted annotation's provenance. */
  annotationSource?: Annotation;
  /** Frozen Core-owned projections. Rich text only stores the reference id. */
  sourceReferences: NoteSourceReference[];
  /** Frozen, Core-owned provenance; user edits never rewrite this metadata. */
  origin?: {
    kind: "chat";
    turnId: string;
    question: string;
    createdAt: string;
    model?: string;
    effort?: string;
    sources: { anchor: SourceAnchor; text: string }[];
    images?: ChatImage[];
    materials?: {
      title: string;
      sections: Omit<import("./question-materials").QuestionMaterialSection, "targetId">[];
      images: (ChatImage & Pick<import("./question-materials").QuestionMaterialImage,
        "userRendered" | "includesPdfBackground" | "surface" | "page">)[];
    }[];
  };
  title: string;
  document: RichNode;
  createdAt: string;
  updatedAt: string;
  revision: number;
  deletedAt?: string;
}
