import { resolve } from "node:path";
import { Library } from "../apps/core/src/library";
import { CodexAdapter } from "../apps/core/src/codex";
import { ChatService } from "../apps/core/src/chat";
import { IndexService } from "../apps/core/src/indexer";
const library = new Library(resolve(".local/smoke-library"));
const codex = new CodexAdapter(resolve(".local/codex-control"));
const chat = new ChatService(library, codex);
const indexer = new IndexService(library, codex);
try {
  library.resume();
  const book = library.books()[0];
  await library.waitForBook(book.id);
  const turn = chat.start(
    { bookId: book.id, page: 20, selection: "", scope: "auto" },
    "请简要解释当前页的核心内容，引用原文证据。",
    "real-smoke",
  );
  while (
    chat.list(book.id, "real-smoke").find((t) => t.id === turn.id)?.status ===
    "running"
  )
    await new Promise((r) => setTimeout(r, 250));
  const result = chat
    .list(book.id, "real-smoke")
    .find((t) => t.id === turn.id)!;
  console.log(
    JSON.stringify({
      status: result.status,
      error: result.error,
      citations: result.citations.length,
      estimatedTokens: result.context.estimatedTokens,
      answerPreview: result.answer.slice(0, 150),
    }),
  );
  if (result.status !== "complete" || !result.citations.length)
    throw new Error("Grounded chat failed");
  const job = indexer.start(book.id, 1, false);
  while (
    ["queued", "running"].includes(
      indexer.list(book.id).find((j) => j.id === job.id)!.status,
    )
  )
    await new Promise((r) => setTimeout(r, 250));
  console.log(
    JSON.stringify({
      indexJob: indexer.list(book.id).find((j) => j.id === job.id),
      semanticNodes: indexer.nodes(book.id).length,
    }),
  );
} finally {
  indexer.close();
  chat.close();
  await codex.disconnect();
  library.close();
}
