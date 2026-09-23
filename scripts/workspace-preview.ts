// Isolated manual UI validation. Never uses the installed application's library.
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { createCore } from "../apps/core/src/server";
const directory = await mkdtemp(join(tmpdir(), "aireader-workspace-preview-"));
const core = createCore(directory, "dist/web");
const document = await PDFDocument.create();
const font = await document.embedFont(StandardFonts.Helvetica);
for (let index = 0; index < 5; index++) {
  const page = document.addPage([600, 780]);
  page.drawText(`Workspace validation / page ${index + 1}`, {
    x: 50,
    y: 710,
    size: 24,
    font,
  });
  page.drawText(
    "An excerpt keeps its source. A note records your interpretation.",
    { x: 50, y: 650, size: 14, font },
  );
  page.drawText("Place, compare and connect ideas beside the document.", {
    x: 50,
    y: 610,
    size: 14,
    font,
  });
}
const book = await core.library.import(
  Buffer.from(await document.save()),
  "Workspace validation.pdf",
);
await core.library.waitForBook(book.id);
core.server.listen(43129, "127.0.0.1", () =>
  console.log(
    JSON.stringify({
      directory,
      url: "http://127.0.0.1:43129",
      bookId: book.id,
    }),
  ),
);
process.on("SIGTERM", () => {
  core.close();
  process.exit(0);
});
