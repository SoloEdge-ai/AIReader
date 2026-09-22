import { test, expect } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PDFDocument } from "pdf-lib";
import { createCore } from "../apps/core/src/server";
test("book annotations and rich notes persist, reject stale or unsafe edits, and support delete/restore", async () => {
  const directory = await mkdtemp(join(tmpdir(), "aireader-notes-"));
  let core = createCore(directory, "dist/web");
  async function connect() {
    await new Promise<void>((r) => core.server.listen(0, "127.0.0.1", r));
    const origin = `http://127.0.0.1:${(core.server.address() as { port: number }).port}`;
    const session = await fetch(origin + "/api/session", {
      method: "POST",
      headers: { Origin: origin },
    });
    return {
      origin,
      headers: {
        Origin: origin,
        Cookie: session.headers.get("set-cookie")!.split(";")[0],
        "Content-Type": "application/json",
      },
    };
  }
  let connection = await connect();
  const request = async (
    path: string,
    value?: unknown,
    method = value === undefined ? "GET" : "POST",
  ) =>
    fetch(connection.origin + "/api/" + path, {
      method,
      headers: connection.headers,
      ...(value === undefined ? {} : { body: JSON.stringify(value) }),
    });
  try {
    const pdf = await PDFDocument.create();
    pdf.addPage();
    pdf.addPage();
    const bytes = await pdf.save();
    const response = await fetch(connection.origin + "/api/books", {
      method: "POST",
      headers: connection.headers,
      body: Buffer.from(bytes),
    });
    const book = await response.json();
    await core.library.waitForBook(book.id);
    const annotationResponse = await request(`books/${book.id}/annotations`, {
      kind: "highlight",
      color: "yellow",
      quote: "A cross-page excerpt",
      anchors: [
        { page: 1, rects: [[40, 50, 120, 70]] },
        { page: 2, rects: [[40, 650, 120, 680]] },
      ],
    });
    expect(annotationResponse.status).toBe(201);
    const annotation = await annotationResponse.json();
    const notes = await (await request(`books/${book.id}/notes`)).json();
    const note = notes.find((n: any) => n.id === annotation.noteId);
    expect(note).toBeDefined();
    const updated = await request(`books/${book.id}/notes/${note.id}`, {
      revision: note.revision,
      title: "Capacity notes",
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
    expect(updated.status).toBe(200);
    expect(
      (
        await request(`books/${book.id}/notes/${note.id}`, {
          revision: note.revision,
          title: "stale",
          document: note.document,
        })
      ).status,
    ).toBe(400);
    const current = await updated.json();
    expect((await request(`books/${book.id}/notes/${note.id}`,{revision:current.revision,title:"invalid nesting",document:{type:"doc",content:[{type:"paragraph",content:[{type:"doc"}]}]}})).status).toBe(400);
    expect(
      (
        await request(`books/${book.id}/notes/${note.id}`, {
          revision: current.revision,
          title: "unsafe",
          document: {
            type: "doc",
            content: [
              {
                type: "paragraph",
                content: [
                  {
                    type: "text",
                    text: "link",
                    marks: [
                      { type: "link", attrs: { href: "javascript:alert(1)" } },
                    ],
                  },
                ],
              },
            ],
          },
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await request(`books/${book.id}/annotations`, {
          kind: "highlight",
          color: "yellow",
          anchors: [{ page: 3, rects: [[1, 1, 2, 2]] }],
        })
      ).status,
    ).toBe(400);
    await request(
      `books/${book.id}/annotations/${annotation.id}`,
      undefined,
      "DELETE",
    );
    expect(
      await (await request(`books/${book.id}/annotations`)).json(),
    ).toEqual([]);
    await request(`books/${book.id}/annotations/${annotation.id}/restore`, {});
    expect(
      (await (await request(`books/${book.id}/annotations`)).json()).length,
    ).toBe(1);
    core.close();
    core = createCore(directory, "dist/web");
    connection = await connect();
    const restored = await (await request(`books/${book.id}/notes`)).json();
    expect(restored[0].title).toBe("Capacity notes");
    expect(restored[0].document.content[0].content[0].text).toBe(
      "My observation",
    );
    expect(
      Buffer.from(
        await (
          await fetch(connection.origin + `/api/books/${book.id}/file`, {
            headers: connection.headers,
          })
        ).arrayBuffer(),
      ),
    ).toEqual(Buffer.from(bytes));
  } finally {
    core.close();
    await rm(directory, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    });
  }
});
