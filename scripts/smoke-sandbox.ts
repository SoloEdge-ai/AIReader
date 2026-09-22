import { Library } from "../apps/core/src/library";
import { CodexAdapter } from "../apps/core/src/codex";
import { BookTools } from "../apps/core/src/tools";
import { resolve } from "node:path";
const library = new Library(resolve(".local/smoke-library"));
const codex = new CodexAdapter(resolve(".local/codex-control"));
try {
  const tools = new BookTools(library, codex);
  console.log(JSON.stringify(await tools.verify(library.books()[0].id)));
} finally {
  codex.disconnect();
  library.close();
}
