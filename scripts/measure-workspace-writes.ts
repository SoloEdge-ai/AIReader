import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir, platform, release, cpus } from "node:os";
import { join } from "node:path";
import { PDFDocument } from "pdf-lib";
import { createCore } from "../apps/core/src/server";
import { commandPayload } from "../packages/protocol/src/workspace-commands";
import type {
  WorkspaceCard,
  WorkspaceCommand,
} from "../packages/protocol/src/workspace";

// Isolated persistence diagnostic, not a user-data tool or renderer performance test.
const directory = await mkdtemp(join(tmpdir(), "aireader-write-measure-"));
const core = createCore(directory, "dist/web");
try {
  await new Promise<void>((done) => core.server.listen(0, "127.0.0.1", done));
  const address = core.server.address();
  if (!address || typeof address === "string")
    throw new Error("Missing test port");
  const origin = `http://127.0.0.1:${address.port}`;
  const session = await fetch(origin + "/api/session", {
    method: "POST",
    headers: { Origin: origin },
  });
  const headers = {
    Origin: origin,
    Cookie: session.headers.get("set-cookie")!.split(";")[0],
    "Content-Type": "application/json",
  };
  const pdf = await PDFDocument.create();
  pdf.addPage();
  const book = await (
    await fetch(origin + "/api/books", {
      method: "POST",
      headers,
      body: Buffer.from(await pdf.save()),
    })
  ).json();
  await core.library.waitForBook(book.id);
  const cards: WorkspaceCard[] = Array.from({ length: 500 }, (_, i) => ({
    id: `card-${i}`,
    kind: "note",
    title: `Card ${i}`,
    text: "Generated benchmark content",
    comment: "",
    x: 20,
    y: i * 200,
    width: 300,
    height: 180,
  }));
  const changes: WorkspaceCommand[] = cards.map((card) => ({
    type: "upsert-card",
    card,
  }));
  for (let i = 0; i < 25; i++)
    changes.push({
      type: "upsert-object",
      object: {
        id: `ink-${i}`,
        kind: "ink",
        brush: "pen",
        color: "#000000",
        width: 2,
        opacity: 1,
        segments: [
          {
            surface: { kind: "board" },
            points: Array.from({ length: 10000 }, (_, p) => [p, i * 10]),
          },
        ],
      },
    });
  for (let i = 0; i < 1000; i++)
    changes.push({
      type: "upsert-link",
      link: {
        id: `link-${i}`,
        from: `card-${i % 500}`,
        to: `card-${(i + 1) % 500}`,
        label: "related",
      },
    });
  const writes = () =>
    Number(
      core.library.store.db.prepare("SELECT total_changes() AS n").get()!.n,
    );
  async function measure(
    commandId: string,
    expectedContentVersion: number,
    changes: WorkspaceCommand[],
  ) {
    const payload = { bookId: book.id, expectedContentVersion, changes };
    const payloadHash = createHash("sha256")
      .update(commandPayload(payload))
      .digest("hex");
    const before = writes(),
      start = performance.now();
    const response = await fetch(
      `${origin}/api/v2/books/${book.id}/workspace/commands`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({ ...payload, commandId, payloadHash }),
      },
    );
    const receipt = await response.json();
    if (!response.ok) throw new Error(JSON.stringify(receipt));
    return {
      milliseconds: Math.round(performance.now() - start),
      sqliteRowsChanged: writes() - before,
    };
  }
  const initial = await measure("initial", 0, changes);
  const editOne = await measure("edit-one", 1, [
    {
      type: "upsert-card",
      card: { ...cards[0], text: "Changed only this card" },
    },
  ]);
  const start = performance.now(),
    before = writes();
  const view = await fetch(`${origin}/api/books/${book.id}/workspace/camera`, {
    method: "PUT",
    headers,
    body: JSON.stringify({ x: 100, y: 200, zoom: 1.25 }),
  });
  if (!view.ok) throw new Error(await view.text());
  console.log(
    JSON.stringify(
      {
        machine: {
          platform: platform(),
          os: release(),
          cpu: cpus()[0]?.model,
          node: process.version,
        },
        fixture: { pages: 1, cards: 500, inkPoints: 250000, links: 1000 },
        initial,
        editOne,
        viewOnly: {
          milliseconds: Math.round(performance.now() - start),
          sqliteRowsChanged: writes() - before,
        },
        scope:
          "Core HTTP + persistence only; not a drawing frame-rate or 516-page acceptance",
      },
      null,
      2,
    ),
  );
} finally {
  core.close();
  await rm(directory, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 100,
  });
}
