import { z } from "zod";
import { WorkspaceCommandSchema } from "./workspace";
import type { Annotation, Note } from "./notes";
import type { WorkspaceCommand } from "./workspace";

const id = z.string().min(1).max(100).regex(/^[a-zA-Z0-9_-]+$/);
const position = z.number().finite().min(0).max(1000000);
const placement = z.object({
  id,
  x: position,
  y: position,
  width: z.number().finite().min(220).max(1200),
  height: z.number().finite().min(160).max(1600),
}).strict();

/** One book transaction may change notes and the board together. */
export const BookChangeSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("create-note"), title: z.string().min(1).max(200),
    document: z.unknown().optional(), placement }).strict(),
  z.object({ type: z.literal("update-note"), noteId: id, expectedRevision: z.number().int().positive(),
    title: z.string().min(1).max(200), document: z.unknown() }).strict(),
  z.object({ type: z.literal("add-source"), noteId: id, expectedRevision: z.number().int().positive(),
    target: z.object({ kind: z.enum(["card", "annotation"]), id }).strict() }).strict(),
  z.object({ type: z.literal("remove-source"), noteId: id, expectedRevision: z.number().int().positive(),
    referenceId: id }).strict(),
  z.object({ type: z.literal("delete-note"), noteId: id, expectedRevision: z.number().int().positive() }).strict(),
  z.object({ type: z.literal("restore-note"), noteId: id, expectedRevision: z.number().int().positive() }).strict(),
  z.object({ type: z.literal("workspace"), changes: z.array(WorkspaceCommandSchema).min(1).max(14000) }).strict(),
  z.object({ type: z.literal("undo"), targetCommandId: id }).strict(),
]);
export type BookChange = z.infer<typeof BookChangeSchema>;

export const BookCommandSchema = z.object({
  bookId: id,
  commandId: id,
  expectedContentVersion: z.number().int().nonnegative(),
  payloadHash: z.string().regex(/^[a-f0-9]{64}$/),
  changes: z.array(BookChangeSchema).min(1).max(100),
}).strict().superRefine((value, context) => {
  if (value.changes.some((change) => change.type === "undo") && value.changes.length !== 1)
    context.addIssue({ code: "custom", message: "撤销必须单独提交" });
});
export type BookCommand = z.infer<typeof BookCommandSchema>;

export type BookCommandReceipt = {
  bookId: string;
  commandId: string;
  payloadHash: string;
  previousVersion: number;
  contentVersion: number;
  changes: BookChange[];
  workspaceChanges: WorkspaceCommand[];
  noteChanges: { before?: Note; after: Note }[];
  annotationChanges: { before: Annotation; after: Annotation }[];
  inverse: { workspace: WorkspaceCommand[]; notes: { id: string; before?: Note }[] };
};

/** Stable JSON identity; commandId is excluded so retries compare intent. */
export function bookCommandPayload(value: Pick<BookCommand, "bookId" | "expectedContentVersion" | "changes">): string {
  return JSON.stringify({ bookId: value.bookId, expectedContentVersion: value.expectedContentVersion,
    changes: value.changes }, (_key, item) => item && typeof item === "object" && !Array.isArray(item)
      ? Object.fromEntries(Object.keys(item).sort().map((key) => [key, item[key]])) : item);
}
