import { z } from "zod";
import { PdfAnchorSchema } from "./anchors";

const identity = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[a-zA-Z0-9_-]+$/);
const position = z.number().finite().min(0).max(1000000);
const inkAxis = z.number().finite().min(-1000000).max(1000000);
const coordinate = z.tuple([inkAxis, inkAxis]);
const fingerprint = z.string().regex(/^[a-f0-9]{64}$/);
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
export const SurfaceAnchorSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("board") }).strict(),
  z.object({ kind: z.literal("pdf"), fingerprint, page: z.number().int().positive().max(100000) }).strict(),
]);
export type SurfaceAnchor = z.infer<typeof SurfaceAnchorSchema>;
export const InkStrokeSchema = z.object({
  id: identity,
  kind: z.literal("ink"),
  brush: z.enum(["pen", "highlighter"]),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  width: z.number().finite().min(0.5).max(100),
  opacity: z.number().finite().min(0.05).max(1),
  segments: z.array(z.object({
    surface: SurfaceAnchorSchema,
    points: z.array(coordinate).min(2).max(10000),
  }).strict()).min(1).max(128),
}).strict().superRefine((stroke, context) => {
  if (stroke.segments.reduce((n, segment) => n + segment.points.length, 0) > 10000)
    context.addIssue({ code: "custom", message: "单笔最多保存 10000 个点" });
});
export type InkStroke = z.infer<typeof InkStrokeSchema>;
export const WorkspaceObjectSchema = z.discriminatedUnion("kind", [
  InkStrokeSchema,
  z.object({
    id: identity, kind: z.literal("text"), surface: SurfaceAnchorSchema,
    x: inkAxis, y: inkAxis, width: z.number().finite().min(20).max(2000),
    height: z.number().finite().min(20).max(2000), text: z.string().max(20000),
    fontSize: z.number().finite().min(8).max(120), color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    bold: z.boolean(), align: z.enum(["left", "center", "right"]),
  }).strict(),
  z.object({
    id: identity, kind: z.literal("shape"), shape: z.enum(["rectangle", "ellipse", "line", "arrow"]),
    surface: SurfaceAnchorSchema, x: inkAxis, y: inkAxis,
    width: z.number().finite().min(1).max(10000), height: z.number().finite().min(1).max(10000),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/), strokeWidth: z.number().finite().min(0.5).max(100),
    fill: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(), fillOpacity: z.number().finite().min(0).max(1).optional(),
    startCorner: z.enum(["top-left", "top-right", "bottom-left", "bottom-right"]).optional(),
  }).strict(),
]);
export type WorkspaceObject = z.infer<typeof WorkspaceObjectSchema>;
export const RegionExcerptCardSchema = z.object({
  fingerprint,
  page: z.number().int().positive().max(100000),
  rect: z.tuple([position, position, position, position]),
  assetId: identity,
  includePersonalMarks: z.boolean(),
}).strict();
export type RegionExcerptCard = z.infer<typeof RegionExcerptCardSchema>;
export const WorkspaceGroupSchema = z.object({
  id: identity,
  title: z.string().max(200),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  x: position,
  y: position,
  width: z.number().finite().min(220).max(1000000),
  height: z.number().finite().min(120).max(1000000),
  memberIds: z.array(identity).max(5500),
  collapsed: z.boolean(),
}).strict().superRefine((group, context) => {
  if (new Set(group.memberIds).size !== group.memberIds.length)
    context.addIssue({ code: "custom", message: "主题组成员不能重复" });
});
export type WorkspaceGroup = z.infer<typeof WorkspaceGroupSchema>;
export const WorkspaceCardSchema = z
  .object({
    id: identity,
    kind: z.enum(["note", "excerpt", "region"]),
    placed: z.boolean().optional(),
    noteId: identity.optional(),
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
    region: RegionExcerptCardSchema.optional(),
  })
  .strict()
  .superRefine((card, context) => {
    if (card.noteId && (card.comment || (card.kind === "note" && (card.title || card.text))))
      context.addIssue({ code: "custom", message: "笔记位置只保存 Note 引用，不保存另一份正文" });
    if ((card.kind === "excerpt") !== Boolean(card.source) ||
        (card.kind === "region") !== Boolean(card.region))
      context.addIssue({
        code: "custom",
        message: "卡片类型与来源不匹配",
      });
  });
export const WorkspaceSchema = z
  .object({
    bookId: identity,
    revision: z.number().int().min(0),
    formatVersion: z.literal(5).default(5),
    layoutVersion: z.literal(3).default(3),
    camera: WorkspaceCameraSchema.optional(),
    cards: WorkspaceCardSchema.array().max(500),
    objects: WorkspaceObjectSchema.array().max(5000).default([]),
    groups: WorkspaceGroupSchema.array().max(500),
    links: z
      .array(
        z
          .object({
            id: identity,
            from: identity,
            to: identity,
            label: z.string().max(200),
            directed: z.boolean().optional(),
          })
          .strict(),
      )
      .max(1000),
  })
  .strict();
export type WorkspaceCard = z.infer<typeof WorkspaceCardSchema>;
export type BookWorkspace = z.infer<typeof WorkspaceSchema>;

export const WorkspaceCommandSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("upsert-card"), card: WorkspaceCardSchema }).strict(),
  z.object({ type: z.literal("delete-card"), id: identity }).strict(),
  z.object({ type: z.literal("upsert-link"), link: WorkspaceSchema.shape.links.element }).strict(),
  z.object({ type: z.literal("delete-link"), id: identity }).strict(),
  z.object({ type: z.literal("upsert-object"), object: WorkspaceObjectSchema }).strict(),
  z.object({ type: z.literal("delete-object"), id: identity }).strict(),
  z.object({ type: z.literal("upsert-group"), group: WorkspaceGroupSchema }).strict(),
  z.object({ type: z.literal("delete-group"), id: identity }).strict(),
]);
export const WorkspaceCommandBatchSchema = z.object({
  bookId: identity,
  commandId: identity,
  expectedVersion: z.number().int().nonnegative(),
  changes: z.array(WorkspaceCommandSchema).min(1).max(2000),
}).strict();
export type WorkspaceCommand = z.infer<typeof WorkspaceCommandSchema>;
export type WorkspaceCommandBatch = z.infer<typeof WorkspaceCommandBatchSchema>;

export const RegionExcerptInputSchema = z.object({
  bookId: identity, commandId: identity, expectedVersion: z.number().int().nonnegative(),
  fingerprint, page: z.number().int().positive().max(100000),
  rect: RegionExcerptCardSchema.shape.rect,
  image: z.string().startsWith("data:image/png;base64,").max(12 * 1024 * 1024),
  includePersonalMarks: z.boolean(), title: z.string().max(200),
  x: position, y: position,
}).strict();
export type RegionExcerptInput = z.infer<typeof RegionExcerptInputSchema>;
