import { expect, test } from "vitest";
import { strFromU8, unzipSync } from "fflate";
import { NoteSourceReferenceSchema, type Book, type Note } from "../packages/protocol/src";
import { answerDocument } from "../apps/core/src/note-markdown";
import { exportNoteArchive } from "../apps/core/src/note-export";
import { richDocument } from "../apps/core/src/notes";

test("rich notes validate bounded Tiptap table and math nodes", () => {
  const document = richDocument({
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          { type: "text", text: "Runtime " },
          { type: "inlineMath", attrs: { latex: "O(n\\log n)" } },
          { type: "sourceReference", attrs: { referenceId: "source-1" } },
        ],
      },
      {
        type: "table",
        content: [
          {
            type: "tableRow",
            content: [
              {
                type: "tableHeader",
                attrs: { colspan: 1, rowspan: 1, colwidth: null },
                content: [{ type: "paragraph", content: [{ type: "text", text: "Case" }] }],
              },
              {
                type: "tableHeader",
                content: [{ type: "paragraph", content: [{ type: "text", text: "Cost" }] }],
              },
            ],
          },
          {
            type: "tableRow",
            content: [
              { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "Average" }] }] },
              { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "inlineMath", attrs: { latex: "n" } }] }] },
            ],
          },
        ],
      },
      { type: "blockMath", attrs: { latex: "\\sum_{i=1}^{n} i" } },
    ],
  });

  expect(document.content?.[0].content?.[1]).toEqual({
    type: "inlineMath",
    attrs: { latex: "O(n\\log n)" },
  });
  expect(document.content?.[0].content?.[2]).toEqual({
    type: "sourceReference",
    attrs: { referenceId: "source-1" },
  });
  expect(() => NoteSourceReferenceSchema.parse({
    id: "source-1", kind: "annotation", targetId: "annotation-1", title: "标记", text: "快照",
  })).toThrow("标记来源必须保留 PDF 锚点");
  expect(NoteSourceReferenceSchema.parse({
    id: "source-1", kind: "annotation", targetId: "annotation-1", title: "区域标记", text: "快照",
    source: { fingerprint: "fingerprint", anchors: [{ page: 3, rects: [[-4, -2, 30, 40]] }] },
    region: { fingerprint: "fingerprint", page: 3, rect: [-4, -2, 30, 40],
      assetId: "asset-1", includePersonalMarks: false },
    regionAssetKind: "annotation",
  }).region?.rect).toEqual([-4, -2, 30, 40]);
  expect(document.content?.[1].content?.[0].content?.[0].attrs).toEqual({
    colspan: 1,
    rowspan: 1,
    colwidth: null,
    align: null,
  });
  expect(() => richDocument({
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "blockMath", attrs: { latex: "x" } }] }],
  })).toThrow("无效的笔记层级");
  expect(() => richDocument({
    type: "doc",
    content: [{ type: "inlineMath", attrs: { latex: "x" } }],
  })).toThrow("无效的笔记层级");
  expect(() => richDocument({
    type: "doc",
    content: [{ type: "blockMath", attrs: { latex: "x".repeat(20_001) } }],
  })).toThrow();
});

test("AI Markdown becomes editable tables and math and exports as Markdown source", () => {
  const document = answerDocument(
    "| Input | Output |\n| :--- | ---: |\n| $n$ | $n^2$ |\n| a \\| b | done |\n\n$$\nE=mc^2\n$$",
    [],
  );
  expect(document.content?.[0].type).toBe("table");
  expect(document.content?.[0].content?.[0].content?.[0].type).toBe("tableHeader");
  expect(document.content?.[0].content?.[0].content?.[0].attrs?.align).toBe("left");
  expect(document.content?.[0].content?.[0].content?.[1].attrs?.align).toBe("right");
  expect(JSON.stringify(document)).toContain('"type":"inlineMath"');
  expect(document.content?.[1]).toEqual({
    type: "blockMath",
    attrs: { latex: "E=mc^2" },
  });

  const note = {
    id: "note-1",
    bookId: "book-1",
    title: "Complexity",
    document: {
      ...document,
      content: [...(document.content ?? []), { type: "paragraph", content: [{
        type: "sourceReference", attrs: { referenceId: "source-1" },
      }] }],
    },
    sourceReferences: [{
      id: "source-1",
      kind: "annotation",
      targetId: "annotation-1",
      title: "Runtime definition",
      text: "a | b",
      source: { fingerprint: "fingerprint", anchors: [{ page: 3, rects: [[1, 2, 3, 4]] }] },
    }],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    revision: 1,
  } satisfies Note;
  const book = {
    id: "book-1",
    title: "Generated algorithms",
    fingerprint: "fingerprint",
  } as Book;
  const files = unzipSync(new Uint8Array(exportNoteArchive(book, note, [])));
  const markdown = strFromU8(files["note.md"]);
  expect(markdown).toContain("| Input | Output |");
  expect(markdown).toContain("| :--- | ---: |");
  expect(markdown).toContain("| $n$ | $n^2$ |");
  expect(markdown).toContain("| a \\| b | done |");
  expect(markdown).toContain("$$\nE=mc^2\n$$");
  expect(markdown).toContain("[^source-source-1]");
  expect(markdown).toContain("Runtime definition（原文标记；物理页：3");

  const structuredTable = richDocument({ type: "doc", content: [{ type: "table", content: [
    { type: "tableRow", content: [{ type: "tableCell", attrs: { colspan: 2, rowspan: 1 },
      content: [{ type: "paragraph", content: [{ type: "text", text: "Headerless merged cell" }] }] }] },
    { type: "tableRow", content: [
      { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "A" }] }] },
      { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "B" }] }] },
    ] },
  ] }] });
  const structuredFiles = unzipSync(new Uint8Array(exportNoteArchive(book, {
    ...note, id: "note-2", document: structuredTable, sourceReferences: [],
  }, [])));
  const structuredMarkdown = strFromU8(structuredFiles["note.md"]);
  expect(structuredMarkdown).toContain("<table>");
  expect(structuredMarkdown).toContain('<td colspan="2">Headerless merged cell</td>');
});
