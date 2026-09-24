import { test, expect } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PDFDocument } from "pdf-lib";
import { PNG } from "pngjs";
import { unzipSync, zipSync, strFromU8, strToU8 } from "fflate";
import { createCore } from "../apps/core/src/server";

test("workspace package restores PDF, notes, region image, cross-page ink, links and camera as an independent copy", async () => {
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
  const request = (path: string, data?: unknown, method = data === undefined ? "GET" : "POST") =>
    fetch(origin + "/api/" + path, {
      method,
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
    pdf.addPage([500, 700]).drawText("Second page");
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
    await request(`books/${book.id}/workspace/commands`, {
      bookId: book.id, commandId: "archive-setup", expectedVersion: workspace.revision,
      changes: [
        { type: "upsert-card", card },
        { type: "upsert-card", card: { ...card, id: "second-card", x: 1900 } },
        { type: "upsert-object", object: { id: "cross-page-ink", kind: "ink", brush: "pen",
          color: "#345d84", width: 2, opacity: 1, segments: [
            { surface: { kind: "pdf", fingerprint: book.fingerprint, page: 1 }, points: [[20, 30], [50, 60]] },
            { surface: { kind: "board" }, points: [[1500, 710], [1510, 730]] },
            { surface: { kind: "pdf", fingerprint: book.fingerprint, page: 2 }, points: [[70, 80], [100, 120]] },
          ] } },
        { type: "upsert-link", link: { id: "link", from: card.id, to: "second-card", label: "supports" } },
        { type: "upsert-link", link: { id: "ink-link", from: "cross-page-ink", to: card.id,
          label: "sketched from" } },
      ],
    });
    await request(`books/${book.id}/workspace/camera`, { x: 800, y: 20, zoom: 1.2 }, "PUT");
    const image = PNG.sync.write(new PNG({ width: 2, height: 2 }));
    const annotation = await (
      await request(`books/${book.id}/annotations`, {
        kind: "region",
        color: "blue",
        anchors: [{ page: 1, rects: [[10, 20, 100, 120]] }],
        image: `data:image/png;base64,${image.toString("base64")}`,
      })
    ).json();
    const comment = await (await request(`books/${book.id}/annotations/${annotation.id}/note`, {})).json();
    await request(`books/${book.id}/notes/${comment.id}`, {
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
    const regionWorkspace = await (await request(`books/${book.id}/workspace`)).json();
    const regionResponse = await request(`books/${book.id}/workspace/region-excerpts`, {
      bookId: book.id, commandId: "region-archive", expectedVersion: regionWorkspace.revision,
      fingerprint: book.fingerprint, page: 1, rect: [30, 40, 180, 220],
      image: `data:image/png;base64,${image.toString("base64")}`,
      includePersonalMarks: true, title: "Diagram", x: 1500, y: 200,
    });
    expect(regionResponse.status).toBe(201);
    const region = await regionResponse.json();
    const linkedWorkspace = await (await request(`books/${book.id}/workspace`)).json();
    const linkedResponse = await request(`books/${book.id}/workspace/commands`, {
      bookId: book.id, commandId: "archive-annotation-link", expectedVersion: linkedWorkspace.revision,
      changes: [{ type: "upsert-link", link: { id: "annotation-link", from: annotation.id,
        to: card.id, label: "explains" } }],
    });
    expect(linkedResponse.status).toBe(200);
    const download = await request(`books/${book.id}/workspace/archive`);
    expect(download.status).toBe(200);
    const archive = new Uint8Array(await download.arrayBuffer());
    expect(JSON.parse(strFromU8(unzipSync(archive)["workspace.json"])).version).toBe(3);
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
      camera: { x: 800, y: 20, zoom: 1.2 },
    });
    expect(restoredWorkspace.cards).toHaveLength(3);
    expect(restoredWorkspace.cards[0]).toMatchObject({ ...card, id: expect.any(String) });
    expect(restoredWorkspace.cards[0].id).not.toBe(card.id);
    expect(restoredWorkspace.cards[1].id).not.toBe("second-card");
    expect(restoredWorkspace.links[0]).toMatchObject({
      from: restoredWorkspace.cards[0].id, to: restoredWorkspace.cards[1].id, label: "supports",
    });
    expect(restoredWorkspace.objects).toHaveLength(1);
    expect(restoredWorkspace.objects[0].id).not.toBe("cross-page-ink");
    expect(restoredWorkspace.objects[0].segments).toEqual([
      { surface: { kind: "pdf", fingerprint: book.fingerprint, page: 1 }, points: [[20, 30], [50, 60]] },
      { surface: { kind: "board" }, points: [[1500, 710], [1510, 730]] },
      { surface: { kind: "pdf", fingerprint: book.fingerprint, page: 2 }, points: [[70, 80], [100, 120]] },
    ]);
    expect(restoredWorkspace.links.find((link: { label: string }) => link.label === "sketched from"))
      .toMatchObject({ from: restoredWorkspace.objects[0].id, to: restoredWorkspace.cards[0].id });
    const restoredRegion = restoredWorkspace.cards[2];
    expect(restoredRegion).toMatchObject({ kind: "region", title: "Diagram",
      region: { fingerprint: book.fingerprint, page: 1, rect: [30, 40, 180, 220], includePersonalMarks: true } });
    expect(restoredRegion.id).not.toBe(region.cardId);
    expect(restoredRegion.region.assetId).not.toBe(region.workspace.cards[2].region.assetId);
    const originalRegionAsset = new Uint8Array(await (await request(`books/${book.id}/workspace-assets/${region.workspace.cards[2].region.assetId}`)).arrayBuffer());
    expect(new Uint8Array(await (await request(`books/${restored.id}/workspace-assets/${restoredRegion.region.assetId}`)).arrayBuffer())).toEqual(originalRegionAsset);
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
    expect(restoredWorkspace.links.find((link: { label: string }) => link.label === "explains")).toMatchObject({
      from: annotations[0].id, to: restoredWorkspace.cards[0].id, label: "explains",
    });
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
    for (const oldVersion of [1, 2]) {
      const oldFiles = unzipSync(archive);
      const oldManifest = JSON.parse(strFromU8(oldFiles["workspace.json"]));
      oldManifest.version = oldVersion;
      oldFiles["workspace.json"] = strToU8(JSON.stringify(oldManifest));
      const oldResponse = await request("workspace-archives", zipSync(oldFiles));
      expect(oldResponse.status).toBe(400);
      expect((await oldResponse.json()).error).toContain("归档版本");
    }
    const incompleteFiles = unzipSync(archive);
    const incompleteManifest = JSON.parse(strFromU8(incompleteFiles["workspace.json"]));
    delete incompleteManifest.workspace.objects;
    delete incompleteManifest.workspace.formatVersion;
    incompleteFiles["workspace.json"] = strToU8(JSON.stringify(incompleteManifest));
    expect((await request("workspace-archives", zipSync(incompleteFiles))).status).toBe(400);
    core.close();
    core = createCore(directory, "dist/web");
    await connect();
    expect(
      await (await request(`books/${restored.id}/workspace`)).json(),
    ).toEqual(restoredWorkspace);
    // An archive cannot smuggle paths or substitute another source PDF.
    const files = unzipSync(archive);
    // A stored entry's compressed length controls allocation; do not trust a forged original size.
    const malformed = Buffer.from(archive);
    const central = malformed.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    expect(central).toBeGreaterThan(0);
    malformed.writeUInt32LE(1, central + 24);
    const malformedResponse = await request("workspace-archives", malformed);
    expect(malformedResponse.status).toBe(400);
    expect((await malformedResponse.json()).error).toContain("压缩数据");
    files["../outside.txt"] = strToU8("bad");
    expect((await request("workspace-archives", zipSync(files))).status).toBe(
      400,
    );
    delete files["../outside.txt"];
    const manifest = JSON.parse(strFromU8(files["workspace.json"]));
    manifest.version = 4;
    files["workspace.json"] = strToU8(JSON.stringify(manifest));
    const newer = await request("workspace-archives", zipSync(files));
    expect(newer.status).toBe(400);
    expect((await newer.json()).error).toContain("归档版本");
    manifest.version = 3;
    manifest.fingerprint = "0".repeat(64);
    files["workspace.json"] = strToU8(JSON.stringify(manifest));
    expect((await request("workspace-archives", zipSync(files))).status).toBe(
      400,
    );
    expect(await (await request("books")).json()).toHaveLength(2);
    // Independent annotations and deleted-source comments both survive an archive copy.
    await request(`books/${book.id}/annotations/${annotation.id}`, undefined, "DELETE");
    const standalone = await (await request(`books/${book.id}/annotations`, {
      kind: "highlight", quote: "No comment", anchors: [{ page: 1, rects: [[10, 20, 50, 40]] }],
    })).json();
    expect(standalone.noteId).toBeUndefined();
    const detachedDownload = await request(`books/${book.id}/workspace/archive`);
    const detachedResponse = await request("workspace-archives", new Uint8Array(await detachedDownload.arrayBuffer()));
    expect(detachedResponse.status).toBe(201);
    const detachedBook = await detachedResponse.json();
    const detachedAnnotations = await (await request(`books/${detachedBook.id}/annotations`)).json();
    expect(detachedAnnotations).toHaveLength(1);
    expect(detachedAnnotations[0]).toMatchObject({ quote: "No comment" });
    expect(detachedAnnotations[0].noteId).toBeUndefined();
    const detachedNotes = await (await request(`books/${detachedBook.id}/notes`)).json();
    expect(detachedNotes[0].annotationSource.deletedAt).toBeTruthy();
    expect(detachedNotes[0].annotationId).not.toBe(annotation.id);
    expect((await request(`books/${detachedBook.id}/annotation-assets/${detachedNotes[0].annotationSource.assetId}`)).status).toBe(200);
    expect((await request(`books/${book.id}/annotation-assets/${detachedNotes[0].annotationSource.assetId}`)).status).toBe(400);
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
