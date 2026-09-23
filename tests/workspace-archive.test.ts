import { test, expect } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PDFDocument } from "pdf-lib";
import { PNG } from "pngjs";
import { unzipSync, zipSync, strFromU8, strToU8 } from "fflate";
import { createCore } from "../apps/core/src/server";

test("workspace package restores PDF, notes, region image, links and camera as an independent copy", async () => {
  const directory = await mkdtemp(join(tmpdir(), "aireader-archive-"));
  let core = createCore(directory, "dist/web");
  let origin = "",
    cookie = "";
  async function connect() {
    await new Promise<void>((done) => core.server.listen(0, "127.0.0.1", done));
    origin = `http://127.0.0.1:${(core.server.address() as { port: number }).port}`;
    cookie = (
      await fetch(origin + "/api/session", {
        method: "POST",
        headers: { Origin: origin },
      })
    ).headers
      .get("set-cookie")!
      .split(";")[0];
  }
  const request = (path: string, data?: unknown) =>
    fetch(origin + "/api/" + path, {
      method: data === undefined ? "GET" : "POST",
      headers: { Origin: origin, Cookie: cookie },
      body:
        data instanceof Uint8Array
          ? Buffer.from(data)
          : data === undefined
            ? undefined
            : JSON.stringify(data),
    });
  try {
    await connect();
    const pdf = await PDFDocument.create();
    pdf.addPage([500, 700]).drawText("Source document");
    const bytes = await pdf.save();
    const book = await (await request("books", bytes)).json();
    await core.library.waitForBook(book.id);
    const card = {
      id: "note-card",
      kind: "note",
      title: "Idea",
      text: "Durable idea",
      comment: "",
      x: 900,
      y: 80,
      width: 250,
      height: 170,
    };
    const workspace = await (
      await request(`books/${book.id}/workspace`)
    ).json();
    await request(`books/${book.id}/workspace`, {
      ...workspace,
      camera: { x: 800, y: 20, zoom: 1.2 },
      cards: [card, { ...card, id: "second-card", x: 1900 }],
      links: [
        { id: "link", from: card.id, to: "second-card", label: "supports" },
      ],
    });
    const image = PNG.sync.write(new PNG({ width: 2, height: 2 }));
    const annotation = await (
      await request(`books/${book.id}/annotations`, {
        kind: "region",
        color: "blue",
        anchors: [{ page: 1, rects: [[10, 20, 100, 120]] }],
        image: `data:image/png;base64,${image.toString("base64")}`,
      })
    ).json();
    await request(`books/${book.id}/notes/${annotation.noteId}`, {
      revision: 1,
      title: "Figure note",
      document: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "My observation" }],
          },
        ],
      },
    });
    const download = await request(`books/${book.id}/workspace/archive`);
    expect(download.status).toBe(200);
    const archive = new Uint8Array(await download.arrayBuffer());
    const restoredResponse = await request("workspace-archives", archive);
    expect(restoredResponse.status).toBe(201);
    const restored = await restoredResponse.json();
    expect(restored.id).not.toBe(book.id);
    expect(restored.fingerprint).toBe(book.fingerprint);
    expect(
      new Uint8Array(
        await (await request(`books/${restored.id}/file`)).arrayBuffer(),
      ),
    ).toEqual(bytes);
    const restoredWorkspace = await (
      await request(`books/${restored.id}/workspace`)
    ).json();
    expect(restoredWorkspace).toMatchObject({
      bookId: restored.id,
      cards: [card, { ...card, id: "second-card", x: 1900 }],
      camera: { x: 800, y: 20, zoom: 1.2 },
      links: [{ from: "note-card", to: "second-card", label: "supports" }],
    });
    const annotations = await (
      await request(`books/${restored.id}/annotations`)
    ).json();
    expect(annotations[0]).toMatchObject({
      bookId: restored.id,
      kind: "region",
      color: "blue",
      anchors: annotation.anchors,
    });
    expect(annotations[0].id).not.toBe(annotation.id);
    expect(
      (
        await request(
          `books/${restored.id}/annotation-assets/${annotations[0].assetId}`,
        )
      ).status,
    ).toBe(200);
    const notes = await (await request(`books/${restored.id}/notes`)).json();
    expect(notes[0]).toMatchObject({
      title: "Figure note",
      annotationId: annotations[0].id,
    });
    expect(notes[0].document.content[0].content[0].text).toBe("My observation");
    expect(
      (await (await request(`books/${book.id}/annotations`)).json())[0].id,
    ).toBe(annotation.id);
    core.close();
    core = createCore(directory, "dist/web");
    await connect();
    expect(
      await (await request(`books/${restored.id}/workspace`)).json(),
    ).toEqual(restoredWorkspace);
    // An archive cannot smuggle paths or substitute another source PDF.
    const files = unzipSync(archive);
    files["../outside.txt"] = strToU8("bad");
    expect((await request("workspace-archives", zipSync(files))).status).toBe(
      400,
    );
    delete files["../outside.txt"];
    const manifest = JSON.parse(strFromU8(files["workspace.json"]));
    manifest.fingerprint = "0".repeat(64);
    files["workspace.json"] = strToU8(JSON.stringify(manifest));
    expect((await request("workspace-archives", zipSync(files))).status).toBe(
      400,
    );
    expect(await (await request("books")).json()).toHaveLength(2);
  } finally {
    core.close();
    await rm(directory, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    });
  }
}, 30000);
