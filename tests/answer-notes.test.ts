import { test, expect } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { PDFDocument } from "pdf-lib";
import { PNG } from "pngjs";
import { unzipSync, strFromU8 } from "fflate";
import { createCore } from "../apps/core/src/server";
import type { ChatTurn, Note } from "../packages/protocol/src";

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "aireader-answer-notes-"));
  let core: ReturnType<typeof createCore>;
  let origin = "",
    cookie = "";
  async function serve() {
    core = createCore(directory, "dist/web", {
      path: process.execPath,
      version: "fixture",
      args: [resolve("tests/fixtures/fake-codex.mjs")],
    });
    await new Promise<void>((done) => core.server.listen(0, "127.0.0.1", done));
    const address = core.server.address();
    if (!address || typeof address === "string") throw new Error("No address");
    origin = `http://127.0.0.1:${address.port}`;
    cookie = (
      await fetch(origin + "/api/session", {
        method: "POST",
        headers: { Origin: origin },
      })
    ).headers
      .get("set-cookie")!
      .split(";")[0];
  }
  const api = (
    path: string,
    body?: unknown,
    method = body === undefined ? "GET" : "POST",
  ) =>
    fetch(origin + "/api/" + path, {
      method,
      headers: {
        Cookie: cookie,
        Origin: origin,
        "Content-Type": "application/json",
      },
      body:
        body instanceof Uint8Array
          ? Buffer.from(body)
          : body === undefined
            ? undefined
            : JSON.stringify(body),
    });
  async function book(text = "Memory cache stores tokens.") {
    const pdf = await PDFDocument.create();
    pdf.addPage().drawText(text);
    const bytes = await pdf.save();
    const book = await (await api("books", bytes)).json();
    await expect
      .poll(async () => (await (await api(`books/${book.id}`)).json()).status, {
        timeout: 30000,
      })
      .toBe("ready");
    return { ...book, bytes };
  }
  async function ask(
    bookId: string,
    question = "Explain memory",
    images: unknown[] = [],
  ) {
    const session = await (await api(`books/${bookId}/sessions`, {})).json();
    const response = await api(`books/${bookId}/turns`, {
      reading: { bookId, page: 1 },
      question,
      images,
      sessionId: session.id,
      model: "fixture-a",
      effort: "medium",
    });
    expect(response.status).toBe(202);
    const turn: ChatTurn = await response.json();
    if (!question.includes("WAIT"))
      await expect
        .poll(
          async () =>
            (await turns(bookId)).find((t) => t.id === turn.id)?.status,
        )
        .toBe("complete");
    return (await turns(bookId)).find((t) => t.id === turn.id)!;
  }
  async function turns(bookId: string): Promise<ChatTurn[]> {
    return (await api(`books/${bookId}/turns`)).json();
  }
  await serve();
  return {
    api,
    book,
    ask,
    restart: async () => {
      core.close();
      await serve();
    },
    close: async () => {
      core.close();
      await rm(directory, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 100,
      });
    },
  };
}

test("save a completed answer as an editable note with verified original-source snapshots", async () => {
  const f = await fixture();
  try {
    const book = await f.book();
    const turn = await f.ask(book.id);
    const response = await f.api(`books/${book.id}/turns/${turn.id}/note`, {});
    expect(response.status).toBe(201);
    const saved: { note: Note; created: boolean } = await response.json();
    expect(saved.created).toBe(true);
    expect(saved.note.title).toBe("Explain memory");
    expect(saved.note.document.type).toBe("doc");
    expect(JSON.stringify(saved.note.document)).toContain(
      "supported statement",
    );
    expect(saved.note.origin).toMatchObject({
      kind: "chat",
      turnId: turn.id,
      question: "Explain memory",
      model: "fixture-a",
      effort: "medium",
      sources: [
        {
          anchor: { bookId: book.id, page: 1, fingerprint: book.fingerprint },
          text: "Memory cache stores tokens.",
        },
      ],
    });
    expect(JSON.stringify(saved.note)).not.toMatch(
      /已核对原文|PRIVATE_TRACE|estimatedTokens|"memory"|"recent"/,
    );
  } finally {
    await f.close();
  }
}, 45000);

test("saving is idempotent across restart without overwriting edits, rejects running or foreign turns, and allows re-save after deletion", async () => {
  const f = await fixture();
  try {
    const book = await f.book();
    const other = await f.book("Other private book");
    const turn = await f.ask(book.id);
    const savePath = `books/${book.id}/turns/${turn.id}/note`;
    expect(
      (await f.api(`books/${other.id}/turns/${turn.id}/note`, {})).status,
    ).toBe(400);
    expect(
      (await f.api(savePath, { answer: "FORGED", sources: [] })).status,
    ).toBe(400);
    const { note }: { note: Note } = await (await f.api(savePath, {})).json();
    const edit = await f.api(`books/${book.id}/notes/${note.id}`, {
      revision: note.revision,
      title: "My revised understanding",
      document: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "My correction" }],
          },
        ],
      },
    });
    expect(edit.status).toBe(200);
    const edited: Note = await edit.json();
    const twice = await f.api(savePath, {});
    expect(twice.status).toBe(200);
    expect(await twice.json()).toEqual({ note: edited, created: false });
    await f.restart();
    expect(await (await f.api(savePath, {})).json()).toEqual({
      note: edited,
      created: false,
    });
    expect(await (await f.api(`books/${book.id}/notes`)).json()).toEqual([
      edited,
    ]);
    const running = await f.ask(book.id, "WAIT memory");
    const pendingPath = `books/${book.id}/turns/${running.id}`;
    expect((await f.api(pendingPath + "/note", {})).status).toBe(400);
    await f.api(pendingPath + "/cancel", {});
    await expect
      .poll(
        async () =>
          (await (await f.api(`books/${book.id}/turns`)).json()).find(
            (t: ChatTurn) => t.id === running.id,
          ).status,
      )
      .toBe("cancelled");
    expect((await f.api(pendingPath + "/note", {})).status).toBe(400);
    await f.api(`books/${book.id}/notes/${note.id}`, undefined, "DELETE");
    expect(
      (await f.api(`books/${book.id}/notes/${note.id}/export`)).status,
    ).toBe(400);
    const renewed = await (await f.api(savePath, {})).json();
    expect(renewed.created).toBe(true);
    expect(renewed.note.id).not.toBe(note.id);
    expect((await (await f.api(`books/${book.id}/notes`)).json()).length).toBe(
      1,
    );
  } finally {
    await f.close();
  }
}, 20000);

test("workspace restore retains answer-note evidence and attachments without restoring an account or chat session", async () => {
  const f = await fixture();
  try {
    const book = await f.book();
    const png = new PNG({ width: 2, height: 3 });
    const turn = await f.ask(book.id, "Explain memory", [
      {
        name: "figure.png",
        dataUrl:
          "data:image/png;base64," + PNG.sync.write(png).toString("base64"),
      },
    ]);
    await f.api(`books/${book.id}/turns/${turn.id}/note`, {});
    const exported = await f.api(`books/${book.id}/workspace/archive`);
    if (!exported.ok) throw new Error(await exported.text());
    const restoredResponse = await f.api(
      "workspace-archives",
      new Uint8Array(await exported.arrayBuffer()),
    );
    if (!restoredResponse.ok) throw new Error(await restoredResponse.text());
    const restored = await restoredResponse.json();
    const notes: Note[] = await (
      await f.api(`books/${restored.id}/notes`)
    ).json();
    expect(notes[0].origin?.sources[0]).toMatchObject({
      text: "Memory cache stores tokens.",
      anchor: { bookId: restored.id, fingerprint: book.fingerprint },
    });
    const imageId = notes[0].origin!.images![0].id;
    expect(
      (await f.api(`books/${restored.id}/chat-images/${imageId}`)).status,
    ).toBe(200);
    expect(
      (await f.api(`books/${book.id}/chat-images/${imageId}`)).status,
    ).toBe(400);
    expect(
      (await f.api(`books/${restored.id}/notes/${notes[0].id}/export`)).status,
    ).toBe(200);
    expect(await (await f.api(`books/${restored.id}/turns`)).json()).toEqual(
      [],
    );
  } finally {
    await f.close();
  }
}, 20000);

test("notes without citations say so and export does not admit unsafe user-edited rich content", async () => {
  const f = await fixture();
  try {
    const book = await f.book();
    const turn = await f.ask(book.id, "NOTES_NO_SOURCE");
    const { note }: { note: Note } = await (
      await f.api(`books/${book.id}/turns/${turn.id}/note`, {})
    ).json();
    expect(note.origin?.sources).toEqual([]);
    const unsafe = [
      {
        type: "doc",
        content: [
          { type: "image", attrs: { src: "file:///C:/Users/auth.json" } },
        ],
      },
      {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              {
                type: "text",
                text: "Click",
                marks: [
                  { type: "link", attrs: { href: "javascript:alert(1)" } },
                ],
              },
            ],
          },
        ],
      },
    ];
    for (const document of unsafe)
      expect(
        (
          await f.api(`books/${book.id}/notes/${note.id}`, {
            revision: note.revision,
            title: "unsafe",
            document,
          })
        ).status,
      ).toBe(400);
    const response = await f.api(`books/${book.id}/notes/${note.id}/export`);
    const files = unzipSync(new Uint8Array(await response.arrayBuffer()));
    expect(Object.keys(files)).toEqual(["note.md"]);
    const md = strFromU8(files["note.md"]);
    expect(md).toContain("此回答没有已核验的书中原文引用");
    expect(md).toContain("General explanation without a book citation.");
    expect(md).not.toContain("Memory cache stores tokens.");
  } finally {
    await f.close();
  }
}, 20000);

test("region-linked notes export their own PDF coordinate provenance and image without unrelated attachments", async () => {
  const f = await fixture();
  try {
    const book = await f.book();
    const png = new PNG({ width: 3, height: 2 });
    png.data.fill(123);
    const dataUrl =
      "data:image/png;base64," + PNG.sync.write(png).toString("base64");
    const annotation = await (
      await f.api(`books/${book.id}/annotations`, {
        kind: "region",
        color: "blue",
        quote: "Figure A",
        anchors: [{ page: 1, rects: [[10, 20, 40, 50]] }],
        image: dataUrl,
      })
    ).json();
    await f.ask(book.id, "Explain memory", [
      { name: "unrelated.png", dataUrl },
    ]);
    const comment = await (await f.api(`books/${book.id}/annotations/${annotation.id}/note`, {})).json();
    const response = await f.api(
      `books/${book.id}/notes/${comment.id}/export`,
    );
    expect(response.status).toBe(200);
    const files = unzipSync(new Uint8Array(await response.arrayBuffer()));
    expect(Object.keys(files).sort()).toEqual(["assets/region.png", "note.md"]);
    const md = strFromU8(files["note.md"]);
    expect(md).toContain("Figure A");
    expect(md).toContain("10,20,40,50");
    expect(md).toContain(book.fingerprint);
    expect(md).not.toContain("Explain memory");
    expect(PNG.sync.read(Buffer.from(files["assets/region.png"])).height).toBe(
      2,
    );
  } finally {
    await f.close();
  }
}, 20000);

test("note export contains edited Markdown, original evidence and only this answer's local image", async () => {
  const f = await fixture();
  try {
    const book = await f.book();
    const png = new PNG({ width: 2, height: 3 });
    png.data.fill(255);
    const imageBytes = PNG.sync.write(png);
    const turn = await f.ask(book.id, "Explain memory", [
      {
        name: "../../secret.png",
        dataUrl: "data:image/png;base64," + imageBytes.toString("base64"),
      },
    ]);
    const { note }: { note: Note } = await (
      await f.api(`books/${book.id}/turns/${turn.id}/note`, {})
    ).json();
    await f.api(`books/${book.id}/notes/${note.id}`, {
      revision: note.revision,
      title: "My edited answer",
      document: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "My own edited understanding" }],
          },
        ],
      },
      origin: { kind: "chat", sources: [{ text: "FORGED_SOURCE" }] },
    });
    const response = await f.api(`books/${book.id}/notes/${note.id}/export`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/zip");
    expect(response.headers.get("content-disposition")).toMatch(
      /^attachment; /,
    );
    const files = unzipSync(new Uint8Array(await response.arrayBuffer()));
    expect(Object.keys(files).sort()).toEqual([
      "assets/question-1.png",
      "note.md",
    ]);
    const md = strFromU8(files["note.md"]);
    expect(md).toContain("# My edited answer");
    expect(md).toContain("My own edited understanding");
    expect(md).toContain("AI");
    expect(md).toContain("来源 1");
    expect(md).toContain("Memory cache stores tokens.");
    expect(md).toContain(book.fingerprint);
    expect(md).toContain("第 1 页");
    expect(md).toContain("assets/question-1.png");
    expect(md).not.toMatch(
      /supported statement|FORGED_SOURCE|已核对原文|estimatedTokens|codex-home|\.\.\/secret/,
    );
    expect(
      PNG.sync.read(Buffer.from(files["assets/question-1.png"])).width,
    ).toBe(2);
    expect(
      Buffer.from(await (await f.api(`books/${book.id}/file`)).arrayBuffer()),
    ).toEqual(Buffer.from(book.bytes));
    const other = await f.book("Another book");
    expect(
      (await f.api(`books/${other.id}/notes/${note.id}/export`)).status,
    ).toBe(400);
    expect(
      (await f.api(`books/${book.id}/notes/..%2F..%2Fauth.json/export`)).status,
    ).toBe(400);
  } finally {
    await f.close();
  }
}, 20000);

test("saved answers preserve editable Markdown while unsafe HTML and links remain inert text", async () => {
  const f = await fixture();
  try {
    const book = await f.book();
    const turn = await f.ask(book.id, "NOTES_MARKDOWN memory");
    const saved: { note: Note } = await (
      await f.api(`books/${book.id}/turns/${turn.id}/note`, {})
    ).json();
    const nodes = saved.note.document.content!;
    expect(nodes[0]).toEqual({
      type: "heading",
      attrs: { level: 1 },
      content: [{ type: "text", text: "Capacity" }],
    });
    expect(nodes.find((n) => n.type === "codeBlock")).toMatchObject({
      attrs: { language: "ts" },
      content: [{ type: "text", text: "const capacity = 42;" }],
    });
    expect(
      nodes.filter((n) => n.type === "bulletList" || n.type === "orderedList"),
    ).toHaveLength(2);
    const serialized = JSON.stringify(saved.note.document);
    expect(serialized).toContain('"type":"bold"');
    expect(serialized).toContain('"type":"link"');
    expect(serialized).toContain("https://example.com");
    expect(serialized).not.toContain('"href":"javascript:');
    expect(serialized).not.toMatch(/"type":"(html|image|table|math)"/);
    expect(serialized).toContain("n^2");
    expect(serialized).toContain("E=mc^2");
    expect(serialized).toContain("Input");
    expect(serialized).toContain("Output");
    expect(serialized).toContain("onerror");
    expect(serialized).toContain("remote");
    expect(serialized).not.toContain(turn.citations[0].passageId);
    expect(serialized).toContain("来源 1");
  } finally {
    await f.close();
  }
}, 20000);
