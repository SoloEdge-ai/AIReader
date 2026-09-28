import { expect, it } from "vitest";
import { relatedComparisonNotes } from "../apps/web/src/features/compare-focus/comparison-notes";

it("lists every note associated with one excerpt without duplicating its own note", () => {
  const notes = [
    { id: "one", title: "Definition", sourceReferences: [{ kind: "card", targetId: "excerpt" }] },
    { id: "two", title: "Contrast", sourceReferences: [{ kind: "card", targetId: "excerpt" }] },
    { id: "three", title: "Other", sourceReferences: [{ kind: "card", targetId: "elsewhere" }] },
  ];
  expect(relatedComparisonNotes({ id: "excerpt", noteId: "one" }, notes).map((note) => note.id))
    .toEqual(["one", "two"]);
});
