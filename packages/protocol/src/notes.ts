import { z } from "zod";
import { PdfAnchorSchema } from "./anchors";
import type { SourceAnchor } from "./reading";
import type { ChatImage } from "./images";

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
  /** Read-only source projection, including a deleted annotation's provenance. */
  annotationSource?: Annotation;
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
