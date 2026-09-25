import { test, expect } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PDFDocument } from "pdf-lib";
import { createCore } from "../apps/core/src/server";

test("book-scoped commands are atomic, idempotent, versioned and independent of view position", async () => {
  const directory = await mkdtemp(join(tmpdir(), "aireader-workspace-"));
  let core = createCore(directory, "dist/web");
  let origin = "", cookie = "";
  async function connect() {
    await new Promise<void>((done) => core.server.listen(0, "127.0.0.1", done));
    origin = `http://127.0.0.1:${(core.server.address() as { port: number }).port}`;
    const response = await fetch(origin + "/api/session", { method: "POST", headers: { Origin: origin } });
    cookie = response.headers.get("set-cookie")!.split(";")[0];
  }
  function request(path: string, value?: unknown, method = value === undefined ? "GET" : "POST") {
    return fetch(origin + "/api/" + path, {
      method,
      headers: { Origin: origin, Cookie: cookie, "Content-Type": "application/json" },
      ...(value === undefined ? {} : { body: JSON.stringify(value) }),
    });
  }
  async function book(width: number) {
    const pdf = await PDFDocument.create();
    pdf.addPage([width, 700]);
    const response = await fetch(origin + "/api/books", {
      method: "POST", headers: { Origin: origin, Cookie: cookie }, body: Buffer.from(await pdf.save()),
    });
    const result = await response.json();
    await core.library.waitForBook(result.id);
    return result;
  }
  try {
    await connect();
    const first = await book(500), other = await book(400);
    expect(core.library.book(first.id).pages).toBe(1);
    const path = `books/${first.id}/workspace`;
    const initial = await (await request(path)).json();
    expect(initial).toMatchObject({ bookId: first.id, revision: 0, formatVersion: 4, cards: [], objects: [], links: [] });
    const card = {
      id: "card-one", kind: "note", title: "Observation", text: "My interpretation", comment: "",
      x: 720, y: 40, width: 300, height: 240,
    };
    const excerpt = {
      ...card, id: "excerpt-one", kind: "excerpt", text: "Selected text",
      source: { fingerprint: first.fingerprint, anchors: [{ page: 1, rects: [[10, 20, 100, 40]] }] },
    };
    const link = { id: "relation-one", from: card.id, to: excerpt.id, label: "supports" };
    const batch = {
      bookId: first.id, commandId: "create-cards", expectedVersion: 0,
      changes: [
        { type: "upsert-card", card }, { type: "upsert-card", card: excerpt },
        { type: "upsert-link", link },
      ],
    };
    const savedResponse = await request(path + "/commands", batch);
    expect(savedResponse.status, JSON.stringify(await savedResponse.clone().json())).toBe(200);
    const saved = await savedResponse.json();
    expect(saved.revision).toBe(1);
    expect((await (await request(path + "/commands", batch)).json()).revision).toBe(1);
    const reused = await request(path + "/commands", { ...batch,
      changes: [{ type: "upsert-card", card: { ...card, text: "Different payload" } }] });
    expect(reused.status).toBe(409);
    expect(await reused.json()).toMatchObject({ code: "COMMAND_ID_REUSED" });
    const conflict = await request(path + "/commands", { ...batch, commandId: "stale" });
    expect(conflict.status).toBe(409);
    expect((await conflict.json()).error).toContain("版本冲突");
    expect((await request(path, saved)).status).toBe(409);
    expect((await request(`books/${other.id}/workspace/commands`, { ...batch, commandId: "foreign" })).status).toBe(400);
    expect((await request(path + "/commands", {
      ...batch, commandId: "bad-link", expectedVersion: 1,
      changes: [{ type: "upsert-link", link: { ...link, to: "missing" } }],
    })).status).toBe(400);
    expect((await request(path + "/commands", {
      ...batch, commandId: "mutate-original", expectedVersion: 1,
      changes: [{ type: "upsert-card", card: { ...excerpt, text: "changed original" } }],
    })).status).toBe(400);
    expect((await request(path + "/commands", {
      ...batch, commandId: "bad-position", expectedVersion: 1,
      changes: [{ type: "upsert-card", card: { ...card, x: -10 } }],
    })).status).toBe(400);
    expect((await (await request(path)).json()).revision).toBe(1);
    const view = { x: 520, y: 320, zoom: 1.25 };
    expect((await request(path + "/camera", view, "PUT")).status).toBe(200);
    expect(await (await request(path)).json()).toMatchObject({ revision: 1, camera: view });
    core.close();
    core = createCore(directory, "dist/web");
    await connect();
    expect(await (await request(path)).json()).toMatchObject({ revision: 1, camera: view });
    const edited = await request(path + "/commands", {
      bookId: first.id, commandId: "edit-and-remove", expectedVersion: 1,
      changes: [{ type: "upsert-card", card: { ...card, text: "Revised", x: 950 } },
        { type: "delete-card", id: excerpt.id }],
    });
    expect(edited.status).toBe(200);
    expect((await edited.json())).toMatchObject({
      revision: 2, cards: [{ text: "Revised", x: 950 }], links: [], camera: view,
    });
    expect((await (await request(`books/${other.id}/workspace`)).json()).cards).toEqual([]);
  } finally {
    core.close();
    await rm(directory, { recursive: true, force: true });
  }
});
