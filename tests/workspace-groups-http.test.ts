import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PDFDocument } from "pdf-lib";
import { expect, test } from "vitest";
import { createCore } from "../apps/core/src/server";

test("workspace groups are book-scoped, persisted and reversible without becoming relation endpoints", async () => {
  const directory = await mkdtemp(join(tmpdir(), "aireader-workspace-groups-"));
  let core = createCore(directory, "dist/web"), origin = "", cookie = "";
  async function connect() {
    await new Promise<void>((done) => core.server.listen(0, "127.0.0.1", done));
    origin = `http://127.0.0.1:${(core.server.address() as { port: number }).port}`;
    cookie = (await fetch(origin + "/api/session", { method: "POST", headers: { Origin: origin } }))
      .headers.get("set-cookie")!.split(";")[0];
  }
  const request = (path: string, value?: unknown) => fetch(origin + "/api/" + path, {
    method: value === undefined ? "GET" : "POST",
    headers: { Origin: origin, Cookie: cookie, "Content-Type": "application/json" },
    ...(value === undefined ? {} : { body: JSON.stringify(value) }),
  });
  const command = (bookId: string, commandId: string, expectedContentVersion: number, changes: unknown[]) => {
    const payload = { bookId, expectedContentVersion, changes };
    const canonical = JSON.stringify(payload, (_key, item) =>
      item && typeof item === "object" && !Array.isArray(item)
        ? Object.fromEntries(Object.keys(item).sort().map((key) => [key, item[key]]))
        : item);
    return { ...payload, commandId, payloadHash: createHash("sha256").update(canonical).digest("hex") };
  };
  try {
    await connect();
    const pdf = await PDFDocument.create();
    pdf.addPage([500, 700]);
    const imported = await fetch(origin + "/api/books", {
      method: "POST", headers: { Origin: origin, Cookie: cookie }, body: Buffer.from(await pdf.save()),
    });
    const book = await imported.json();
    await core.library.waitForBook(book.id);
    const path = `v2/books/${book.id}/workspace/commands`;
    const first = { id: "first-card", kind: "note", title: "Claim", text: "", comment: "",
      x: 40, y: 80, width: 320, height: 200 };
    const second = { ...first, id: "second-card", title: "Evidence", x: 420 };
    const boardObject = { id: "board-label", kind: "text", surface: { kind: "board" },
      x: 80, y: 260, width: 240, height: 80, text: "Working theory", fontSize: 16,
      color: "#123456", bold: false, align: "left" };
    const group = { presentation: "cluster", id: "theme-one", title: "Memory model", color: "#56789a",
      x: 20, y: 40, width: 760, height: 300,
      memberIds: [first.id, second.id, boardObject.id], collapsed: false };
    const created = await request(path, command(book.id, "create-group", 0, [
      { type: "upsert-card", card: first },
      { type: "upsert-card", card: second },
      { type: "upsert-object", object: boardObject },
      { type: "upsert-link", link: { id: "evidence-link", from: first.id, to: second.id,
        label: "supported by", directed: true } },
      { type: "upsert-group", group },
    ]));
    expect(created.status, JSON.stringify(await created.clone().json())).toBe(200);
    expect(await created.json()).toMatchObject({
      previousVersion: 0,
      contentVersion: 1,
      changes: expect.arrayContaining([{ type: "upsert-group", group }]),
    });
    const collapsed = await request(path, command(book.id, "collapse-group", 1, [
      { type: "upsert-group", group: { ...group, collapsed: true } },
    ]));
    expect(collapsed.status).toBe(200);
    expect((await (await request(`books/${book.id}/workspace`)).json()).links[0]).toMatchObject({
      from: first.id, to: second.id,
    });

    const duplicate = await request(path, command(book.id, "duplicate-membership", 2, [
      { type: "upsert-group", group: { ...group, id: "theme-two", title: "Duplicate",
        memberIds: [first.id] } },
    ]));
    expect(duplicate.status).toBe(400);
    expect((await duplicate.json()).error).toContain("一个主题组");

    const missing = await request(path, command(book.id, "missing-member", 2, [
      { type: "upsert-group", group: { ...group, id: "theme-two", title: "Missing",
        memberIds: ["foreign-card"] } },
    ]));
    expect(missing.status).toBe(400);
    expect((await missing.json()).error).toContain("不属于本书");
    const pdfObject = { id: "pdf-mark", kind: "text", surface: { kind: "pdf",
      fingerprint: book.fingerprint, page: 1 }, x: 20, y: 20, width: 160, height: 80,
      text: "PDF mark", fontSize: 14, color: "#123456", bold: false, align: "left" };
    const pdfMember = await request(path, command(book.id, "pdf-member", 2, [
      { type: "upsert-object", object: pdfObject },
      { type: "upsert-group", group: { ...group, id: "theme-two", title: "PDF",
        memberIds: [pdfObject.id] } },
    ]));
    expect(pdfMember.status).toBe(400);
    expect((await (await request(`books/${book.id}/workspace`)).json()).objects).toEqual([boardObject]);

    const removed = await (await request(path, command(book.id, "remove-member", 2, [
      { type: "delete-card", id: first.id },
    ]))).json();
    expect(removed.changes).toEqual(expect.arrayContaining([
      { type: "delete-card", id: first.id },
      { type: "upsert-group", group: { ...group,
        memberIds: [second.id, boardObject.id], collapsed: true } },
      { type: "delete-link", id: "evidence-link" },
    ]));
    expect(removed.inverse).toEqual(expect.arrayContaining([
      { type: "upsert-card", card: first },
      { type: "upsert-group", group: { ...group, collapsed: true } },
      { type: "upsert-link", link: { id: "evidence-link", from: first.id, to: second.id,
        label: "supported by", directed: true } },
    ]));
    expect((await request(path, command(book.id, "restore-member", 3, removed.inverse))).status).toBe(200);

    const removedObject = await (await request(path, command(book.id, "remove-object", 4, [
      { type: "delete-object", id: boardObject.id },
    ]))).json();
    expect(removedObject.changes).toEqual(expect.arrayContaining([
      { type: "delete-object", id: boardObject.id },
      { type: "upsert-group", group: { ...group,
        memberIds: [first.id, second.id], collapsed: true } },
    ]));
    expect((await request(path, command(book.id, "restore-object", 5, removedObject.inverse))).status).toBe(200);

    const deletedGroup = await (await request(path, command(book.id, "delete-group", 6, [
      { type: "delete-group", id: group.id },
    ]))).json();
    expect(deletedGroup.inverse).toContainEqual({ type: "upsert-group", group: { ...group, collapsed: true } });
    const withoutGroup = await (await request(`books/${book.id}/workspace`)).json();
    expect(withoutGroup.groups).toEqual([]);
    expect(withoutGroup.cards.map((card: { id: string }) => card.id)).toEqual(
      expect.arrayContaining([first.id, second.id]),
    );
    expect(withoutGroup.cards).toHaveLength(2);
    expect(withoutGroup.objects).toEqual([boardObject]);
    expect((await request(path, command(book.id, "restore-group", 7, deletedGroup.inverse))).status).toBe(200);

    core.close();
    core = createCore(directory, "dist/web");
    await connect();
    expect(await (await request(`books/${book.id}/workspace`)).json()).toMatchObject({
      formatVersion: 5,
      layoutVersion: 3,
      groups: [{ ...group, collapsed: true }],
      links: [{ from: first.id, to: second.id }],
    });
  } finally {
    core.close();
    await rm(directory, { recursive: true, force: true });
  }
});
