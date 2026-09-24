import type { WorkspaceCommandBatch } from "../../../../packages/protocol/src/workspace";
import { commandPayload, WorkspaceReceiptSchema } from "../../../../packages/protocol/src/workspace-commands";
import { post } from "../api";

export async function submitWorkspaceCommand(batch: WorkspaceCommandBatch) {
  const payload = { bookId: batch.bookId, expectedContentVersion: batch.expectedVersion, changes: batch.changes };
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(commandPayload(payload)));
  const payloadHash = Array.from(new Uint8Array(bytes), (value) => value.toString(16).padStart(2, "0")).join("");
  const receipt = WorkspaceReceiptSchema.parse(await post(`v2/books/${encodeURIComponent(batch.bookId)}/workspace/commands`, {
    ...payload, commandId: batch.commandId, payloadHash,
  }));
  if (receipt.bookId !== batch.bookId || receipt.commandId !== batch.commandId || receipt.payloadHash !== payloadHash ||
      receipt.previousVersion !== batch.expectedVersion || receipt.contentVersion !== batch.expectedVersion + 1)
    throw new Error("工作区提交回执不匹配；草稿已保留");
  return receipt;
}
