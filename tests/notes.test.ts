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
    expect(annotation.noteId).toBeUndefined();
    expect(await (await request(`books/${book.id}/notes`)).json()).toEqual([]);
    const comment = await request(`books/${book.id}/annotations/${annotation.id}/note`, {});
    expect(comment.status).toBe(200);
    const note = await comment.json();
    expect((await (await request(`books/${book.id}/annotations/${annotation.id}/note`, {})).json()).id).toBe(note.id);
    const updated = await request(`books/${book.id}/notes/${note.id}`, {
      revision: note.revision,
      title: "Capacity notes",
      document: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              { type: "text", text: "Capacity is " },
              { type: "inlineMath", attrs: { latex: "O(n)" } },
            ],
          },
          {
            type: "table",
            content: [
              {
                type: "tableRow",
                content: [
                  { type: "tableHeader", content: [{ type: "paragraph", content: [{ type: "text", text: "Input" }] }] },
                  { type: "tableHeader", content: [{ type: "paragraph", content: [{ type: "text", text: "Output" }] }] },
                ],
              },
              {
                type: "tableRow",
                content: [
                  { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "n" }] }] },
                  { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "inlineMath", attrs: { latex: "n^2" } }] }] },
                ],
              },
            ],
          },
          { type: "blockMath", attrs: { latex: "\\sum_{i=1}^n i" } },
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
    expect(
      (
        await request(`books/${book.id}/notes/${note.id}`, {
          revision: current.revision,
          title: "invalid formula",
          document: {
            type: "doc",
            content: [{ type: "blockMath", attrs: { latex: 42 } }],
          },
        })
      ).status,
    ).toBe(400);
    const otherPdf = await PDFDocument.create();
    otherPdf.addPage([300, 300]);
    const other = await (
      await fetch(connection.origin + "/api/books", {
        method: "POST",
        headers: connection.headers,
        body: Buffer.from(await otherPdf.save()),
      })
    ).json();
    await core.library.waitForBook(other.id);
    expect((await request(`books/${other.id}/annotations/${annotation.id}/note`, {})).status).toBe(400);
    expect(
      (
        await request(`books/${other.id}/notes/${note.id}`, {
          revision: current.revision,
          title: "wrong book",
          document: current.document,
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await request(
          `books/${other.id}/annotations/${annotation.id}`,
          undefined,
          "DELETE",
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await request(
          `books/${other.id}/annotation-assets/..%2F..%2Flibrary.sqlite`,
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await request(`books/${book.id}/notes/${note.id}`, {
          revision: current.revision,
          title: "invalid nesting",
          document: {
            type: "doc",
            content: [{ type: "paragraph", content: [{ type: "doc" }] }],
          },
        })
      ).status,
    ).toBe(400);
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
    expect((await (await request(`books/${book.id}/notes`)).json())[0].document).toEqual(current.document);
    const detached = (await (await request(`books/${book.id}/notes`)).json())[0];
    expect(detached.annotationSource.quote).toBe("A cross-page excerpt");
    expect(detached.annotationSource.deletedAt).toBeTruthy();
    expect((await request(`books/${book.id}/annotations/${annotation.id}/note`, {})).status).toBe(400);
    await request(`books/${book.id}/annotations/${annotation.id}/restore`, {});
    expect(
      (await (await request(`books/${book.id}/annotations`)).json()).length,
    ).toBe(1);
    await request(`books/${book.id}/notes/${note.id}`, undefined, "DELETE");
    const withoutComment = await (await request(`books/${book.id}/annotations`)).json();
    expect(withoutComment).toHaveLength(1);
    expect(withoutComment[0].noteId).toBeUndefined();
    const replacement = await (await request(`books/${book.id}/annotations/${annotation.id}/note`, {})).json();
    expect(replacement.id).not.toBe(note.id);
    await request(`books/${book.id}/notes/${note.id}/restore`, {});
    expect((await (await request(`books/${book.id}/annotations`)).json())[0].noteId).toBe(replacement.id);
    core.close();
    core = createCore(directory, "dist/web");
    connection = await connect();
    const restored = await (await request(`books/${book.id}/notes`)).json();
    const original = restored.find((n: any) => n.id === note.id);
    expect(original.title).toBe("Capacity notes");
    expect(original.document.content[0].content[1]).toEqual({
      type: "inlineMath",
      attrs: { latex: "O(n)" },
    });
    expect(original.document.content[1].type).toBe("table");
    expect(original.document.content[2]).toEqual({
      type: "blockMath",
      attrs: { latex: "\\sum_{i=1}^n i" },
    });
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
