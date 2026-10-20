import { _electron as electron, expect } from "@playwright/test";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, resolve, sep } from "node:path";
import { PDFDocument } from "pdf-lib";
import { createCore } from "../apps/core/src/server";
import { bookCommandPayload } from "../packages/protocol/src/book-commands";

const directory = await mkdtemp(resolve(tmpdir(), "aireader-compact-cards-"));
let bookId = "";
async function prepareBook() {
  const seed = createCore(directory, "dist/web");
  try {
    const pdf = await PDFDocument.create();
    pdf
      .addPage([500, 700])
      .drawText("Compact card persistence fixture.", { x: 30, y: 650 });
    const book = await seed.library.import(
      Buffer.from(await pdf.save()),
      "Compact cards.pdf",
    );
    await seed.library.waitForBook(book.id);
    bookId = book.id;
    // Seed pre-existing v6 rows independently of today's card validators. The bug
    // occurs while reading these rows, before any new save can repair them.
    const db = seed.library.store.db;
    seed.library.store.transaction(() => {
      db.prepare("INSERT INTO workspace_books VALUES(?,?,?,?)").run(
        book.id,
        1,
        5,
        3,
      );
      for (const [ordinal, height] of [120, 128].entries()) {
        const card = {
          id: `compact-${height}`,
          kind: "excerpt",
          title: "Compact excerpt",
          text: `Existing card at height ${height}`,
          comment: "",
          x: 740,
          y: 20 + ordinal * 160,
          width: 320,
          height,
          source: {
            fingerprint: book.fingerprint,
            anchors: [{ page: 1, rects: [[30, 640, 200, 665]] }],
          },
        };
        db.prepare("INSERT INTO workspace_entities VALUES(?,?,?,?,?)").run(
          book.id,
          "card",
          card.id,
          ordinal,
          JSON.stringify(card),
        );
      }
    });
  } finally {
    seed.close();
  }
}

const executable = process.argv[2];
const appEnv = Object.fromEntries(
  Object.entries(process.env).filter(
    (entry): entry is [string, string] =>
      entry[1] !== undefined && entry[0] !== "ELECTRON_RUN_AS_NODE",
  ),
);
const launch = () =>
  electron.launch({
    ...(executable
      ? { executablePath: resolve(executable), args: [] }
      : { args: ["."] }),
    env: { ...appEnv, AIREADER_DATA: directory },
  });
try {
  await prepareBook();
  for (let pass = 0; pass < 2; pass++) {
    const app = await launch();
    try {
      const page = await app.firstWindow();
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.locator(".book-card").first().click();
      const workspace = () =>
        page.evaluate(async (id) => {
          const response = await fetch(`/api/books/${id}/workspace`);
          return { status: response.status, body: await response.json() };
        }, bookId);
      const loaded = await workspace();
      if (loaded.status !== 200)
        console.error("Persisted compact workspace load failed:", loaded);
      expect(loaded.status, JSON.stringify(loaded.body)).toBe(200);
      expect(
        loaded.body.cards.map((card: { height: number }) => card.height),
      ).toEqual(pass === 0 ? [120, 128] : [120, 128, 120]);
      await expect(
        page.locator('[data-workspace-ready="true"]').first(),
      ).toBeAttached();
      await expect(page.locator(".workspace-card")).toHaveCount(
        pass === 0 ? 2 : 3,
      );
      if (pass === 0) {
        const payload = {
          bookId,
          expectedContentVersion: 1,
          changes: [
            {
              type: "create-note" as const,
              title: "Compact note",
              placement: {
                id: "compact-note",
                x: 1080,
                y: 20,
                width: 320,
                height: 120,
              },
            },
          ],
        };
        const command = {
          ...payload,
          commandId: "compact-note-create",
          payloadHash: createHash("sha256")
            .update(bookCommandPayload(payload))
            .digest("hex"),
        };
        const saved = await page.evaluate(
          async ({ id, command }) => {
            const response = await fetch(`/api/v2/books/${id}/commands`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(command),
            });
            return { status: response.status, body: await response.json() };
          },
          { id: bookId, command },
        );
        expect(saved.status, JSON.stringify(saved.body)).toBe(200);
        expect(
          (await workspace()).body.cards.map(
            (card: { height: number }) => card.height,
          ),
        ).toEqual([120, 128, 120]);
      }
      expect(errors).toEqual([]);
      if (pass === 1) {
        await mkdir(".local/screenshots", { recursive: true });
        await page.screenshot({
          path: ".local/screenshots/compact-cards-reopened.png",
        });
      }
      await page.getByRole("button", { name: "返回书库" }).click();
      await page.getByRole("heading", { name: "书库", exact: true }).waitFor();
    } finally {
      await app.close();
    }
  }
  console.log(
    "Packaged compact cards: existing 120/128px cards load and render; 120px note saves; all survive restart.",
  );
} finally {
  const target = resolve(directory),
    temp = resolve(tmpdir());
  if (
    !target.startsWith(temp + sep) ||
    !basename(target).startsWith("aireader-compact-cards-")
  )
    throw new Error("Refusing to remove an unexpected temporary directory");
  await rm(target, {
    recursive: true,
    force: true,
    maxRetries: 20,
    retryDelay: 200,
  });
}
