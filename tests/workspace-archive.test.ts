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
        { type: "upsert-link", link: { id: "link", from: card.id, to: "second-card", label: "supports" } },
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
    const regionWorkspace = await (await request(`books/${book.id}/workspace`)).json();
    const regionResponse = await request(`books/${book.id}/workspace/region-excerpts`, {
      bookId: book.id, commandId: "region-archive", expectedVersion: regionWorkspace.revision,
      fingerprint: book.fingerprint, page: 1, rect: [30, 40, 180, 220],
      image: `data:image/png;base64,${image.toString("base64")}`,
      includePersonalMarks: true, title: "Diagram", x: 1500, y: 200,
    });
    expect(regionResponse.status).toBe(201);
    const region = await regionResponse.json();
    const download = await request(`books/${book.id}/workspace/archive`);
    expect(download.status).toBe(200);
    const archive = new Uint8Array(await download.arrayBuffer());
    expect(JSON.parse(strFromU8(unzipSync(archive)["workspace.json"])).version).toBe(2);
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
    const legacyFiles = unzipSync(archive);
    const legacyManifest = JSON.parse(strFromU8(legacyFiles["workspace.json"]));
    const oldRegionAsset = legacyManifest.workspace.cards[2].region.assetId;
    legacyManifest.version = 1;
    legacyManifest.workspace.cards.pop();
    delete legacyManifest.workspace.objects;
    delete legacyManifest.workspace.formatVersion;
    delete legacyManifest.assets[oldRegionAsset];
    delete legacyFiles[`assets/${oldRegionAsset}.png`];
    legacyFiles["workspace.json"] = strToU8(JSON.stringify(legacyManifest));
    const legacyResponse = await request("workspace-archives", zipSync(legacyFiles));
    expect(legacyResponse.status).toBe(201);
    const legacy = await legacyResponse.json();
    const legacyWorkspace = await (await request(`books/${legacy.id}/workspace`)).json();
    expect(legacyWorkspace.cards).toHaveLength(2);
    expect(legacyWorkspace.formatVersion).toBe(4);
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
    manifest.version = 3;
    files["workspace.json"] = strToU8(JSON.stringify(manifest));
    const newer = await request("workspace-archives", zipSync(files));
    expect(newer.status).toBe(400);
    expect((await newer.json()).error).toContain("归档版本");
    manifest.version = 2;
    manifest.fingerprint = "0".repeat(64);
    files["workspace.json"] = strToU8(JSON.stringify(manifest));
    expect((await request("workspace-archives", zipSync(files))).status).toBe(
      400,
    );
    expect(await (await request("books")).json()).toHaveLength(3);
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
