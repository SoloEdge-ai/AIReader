import { test, expect } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PDFDocument } from "pdf-lib";
import { createCore } from "../apps/core/src/server";

test("ink commands preserve one stroke across surfaces and reject forged or oversized records", async () => {
  const directory = await mkdtemp(join(tmpdir(), "aireader-ink-http-"));
  const core = createCore(directory, "dist/web");
  try {
    await new Promise<void>((done) => core.server.listen(0, "127.0.0.1", done));
    const origin = `http://127.0.0.1:${(core.server.address() as { port: number }).port}`;
    const cookie = (await fetch(origin + "/api/session", { method: "POST", headers: { Origin: origin } }))
      .headers.get("set-cookie")!.split(";")[0];
    async function request(path: string, data?: unknown) {
      return fetch(origin + "/api/" + path, { method: data === undefined ? "GET" : "POST",
        headers: { Origin: origin, Cookie: cookie, "Content-Type": "application/json" },
        body: data === undefined ? undefined : JSON.stringify(data) });
    }
    async function book(width: number) {
      const pdf = await PDFDocument.create();
      pdf.addPage([width, 400]);
      const response = await fetch(origin + "/api/books", { method: "POST",
        headers: { Origin: origin, Cookie: cookie }, body: Buffer.from(await pdf.save()) });
      const value = await response.json();
      await core.library.waitForBook(value.id);
      return value;
    }
    const first = await book(400), second = await book(420);
    const path = `books/${first.id}/workspace/commands`;
    const stroke = { id: "stroke-1", kind: "ink", brush: "pen", color: "#345d84", width: 2, opacity: 1,
      segments: [
        { surface: { kind: "pdf", fingerprint: first.fingerprint, page: 1 }, points: [[30, 40], [60, 80]] },
        { surface: { kind: "board" }, points: [[1200, 300], [1200, 320]] },
      ] };
    const command = { bookId: first.id, commandId: "add-ink", expectedVersion: 0,
      changes: [{ type: "upsert-object", object: stroke }] };
    expect((await request(path, command)).status).toBe(200);
    expect((await (await request(path, command)).json()).objects).toEqual([stroke]);
    expect((await request(path, { ...command, commandId: "wrong-source", expectedVersion: 1,
      changes: [{ type: "upsert-object", object: { ...stroke, id: "foreign",
        segments: [{ ...stroke.segments[0], surface: { kind: "pdf", fingerprint: second.fingerprint, page: 1 } }] } }] })).status).toBe(400);
    expect((await request(path, { ...command, commandId: "wrong-page", expectedVersion: 1,
      changes: [{ type: "upsert-object", object: { ...stroke, id: "missing-page",
        segments: [{ ...stroke.segments[0], surface: { kind: "pdf", fingerprint: first.fingerprint, page: 2 } }] } }] })).status).toBe(400);
    expect((await request(path, { ...command, commandId: "too-many-single", expectedVersion: 1,
      changes: [{ type: "upsert-object", object: { ...stroke, id: "too-long", segments: [{
        surface: { kind: "board" }, points: Array.from({ length: 10001 }, (_, index) => [index, 20]),
      }] } }] })).status).toBe(400);
    const removed = await request(path, { bookId: first.id, commandId: "erase-ink", expectedVersion: 1,
      changes: [{ type: "delete-object", id: stroke.id }] });
    expect((await removed.json()).objects).toEqual([]);
    const restored = await request(path, { bookId: first.id, commandId: "restore-ink", expectedVersion: 2,
      changes: [{ type: "upsert-object", object: stroke }] });
    expect((await restored.json()).objects).toEqual([stroke]);
    const dense = Array.from({ length: 9999 }, (_, index) => [index % 100, Math.floor(index / 100)]);
    const oversized = await request(path, { bookId: first.id, commandId: "over-book-limit", expectedVersion: 3,
      changes: Array.from({ length: 26 }, (_, index) => ({ type: "upsert-object", object: {
        ...stroke, id: `dense-${index}`, segments: [{ surface: { kind: "board" }, points: dense }],
      } })) });
    expect(oversized.status).toBe(400);
    expect((await oversized.json()).error).toContain("250000");
    expect((await (await request(`books/${first.id}/workspace`)).json()).revision).toBe(3);
  } finally {
    core.close();
    await rm(directory, { recursive: true, force: true });
  }
});
