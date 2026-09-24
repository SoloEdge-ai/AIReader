import { z } from "zod";
import { WorkspaceCommandBatchSchema, WorkspaceCommandSchema } from "./workspace";

export const WorkspaceCommandV2Schema = WorkspaceCommandBatchSchema.omit({ expectedVersion: true }).extend({
  // Difference between two maximal workspaces: 2 * (500 cards + 5000 objects + 1000 links).
  changes: z.array(WorkspaceCommandSchema).min(1).max(13000),
  expectedContentVersion: z.number().int().nonnegative(),
  payloadHash: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
export type WorkspaceCommandV2 = z.infer<typeof WorkspaceCommandV2Schema>;
export const WorkspaceReceiptSchema = z.object({
  bookId: WorkspaceCommandV2Schema.shape.bookId,
  commandId: WorkspaceCommandV2Schema.shape.commandId,
  payloadHash: WorkspaceCommandV2Schema.shape.payloadHash,
  previousVersion: z.number().int().nonnegative(),
  contentVersion: z.number().int().positive(),
  changes: z.array(WorkspaceCommandSchema).max(13000),
  inverse: z.array(WorkspaceCommandSchema).max(13000),
}).strict();
export type WorkspaceReceipt = z.infer<typeof WorkspaceReceiptSchema>;

/** UTF-8 JSON with sorted object keys; array/command order remains significant. */
export function commandPayload(value: Pick<WorkspaceCommandV2, "bookId" | "expectedContentVersion" | "changes">): string {
  return JSON.stringify({ bookId: value.bookId, expectedContentVersion: value.expectedContentVersion, changes: value.changes },
    (_key, item) => item && typeof item === "object" && !Array.isArray(item)
      ? Object.fromEntries(Object.keys(item).sort().map((key) => [key, item[key]])) : item);
}
