import { bookCommandPayload, type BookCommand, type BookCommandReceipt } from
  "../../../../../packages/protocol/src/book-commands";
import { post } from "../../api";

/** Keep commandId and expectedContentVersion stable when retrying an uncertain response. */
export async function submitBookCommand(
  input: Pick<BookCommand, "bookId" | "commandId" | "expectedContentVersion" | "changes">,
): Promise<BookCommandReceipt> {
  const payload = { bookId: input.bookId, expectedContentVersion: input.expectedContentVersion,
    changes: input.changes };
  const digest = await crypto.subtle.digest("SHA-256",
    new TextEncoder().encode(bookCommandPayload(payload)));
  const payloadHash = Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join("");
  const receipt = await post<BookCommandReceipt>(`v2/books/${encodeURIComponent(input.bookId)}/commands`, {
    ...payload, commandId: input.commandId, payloadHash,
  });
  if (receipt.bookId !== input.bookId || receipt.commandId !== input.commandId ||
      receipt.payloadHash !== payloadHash || receipt.previousVersion !== input.expectedContentVersion ||
      receipt.contentVersion !== input.expectedContentVersion + 1 ||
      !Array.isArray(receipt.workspaceChanges) || !Array.isArray(receipt.noteChanges) ||
      !receipt.inverse || !Array.isArray(receipt.inverse.workspace) || !Array.isArray(receipt.inverse.notes))
    throw new Error("书籍提交回执不匹配；草稿已保留");
  return receipt;
}
