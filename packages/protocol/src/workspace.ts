import { z } from "zod";
import { PdfAnchorSchema } from "./index";

const identity = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[a-zA-Z0-9_-]+$/);
const position = z.number().finite().min(0).max(1000000);
// The document column leaves room for notes on either side. Coordinates are world units.
export const WORKSPACE_DOCUMENT_X = 1280;
export const WorkspaceCameraSchema = z
  .object({
    x: position,
    y: position,
    zoom: z.number().finite().min(0.4).max(3),
  })
  .strict();
export type WorkspaceCamera = z.infer<typeof WorkspaceCameraSchema>;
export const WorkspaceCardSchema = z
  .object({
    id: identity,
    kind: z.enum(["note", "excerpt"]),
    title: z.string().max(200),
    text: z.string().max(20000),
    comment: z.string().max(10000),
    x: position,
    y: position,
    width: z.number().finite().min(220).max(1200),
    height: z.number().finite().min(160).max(1600),
    source: z
      .object({
        fingerprint: z.string().min(1).max(128),
        anchors: PdfAnchorSchema.array().min(1).max(50),
      })
      .optional(),
  })
  .strict()
  .superRefine((card, context) => {
    if ((card.kind === "excerpt") !== Boolean(card.source))
      context.addIssue({
        code: "custom",
        message: "原文卡片必须包含来源，个人笔记不能冒充原文",
      });
  });
export const WorkspaceSchema = z
  .object({
    bookId: identity,
    revision: z.number().int().min(0),
    layoutVersion: z.literal(2).default(2),
    camera: WorkspaceCameraSchema.optional(),
    cards: WorkspaceCardSchema.array().max(500),
    links: z
      .array(
        z
          .object({
            id: identity,
            from: identity,
            to: identity,
            label: z.string().max(200),
          })
          .strict(),
      )
      .max(1000),
  })
  .strict();
export type WorkspaceCard = z.infer<typeof WorkspaceCardSchema>;
export type BookWorkspace = z.infer<typeof WorkspaceSchema>;
