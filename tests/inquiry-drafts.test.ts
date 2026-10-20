import { expect, test } from "vitest";
import { QuestionDraftStore } from "../apps/web/src/QuestionDrafts";
import { omitMaterialTargets, type QuestionMaterialSnapshot } from "../packages/protocol/src/question-materials";

const snapshot: QuestionMaterialSnapshot = { id: "snapshot", bookId: "book", sessionId: "session", createdAt: "",
  title: "3 materials", itemCount: 3, targets: [{ kind: "card", id: "a" }, { kind: "card", id: "b" }, { kind: "relation", id: "r" }],
  sections: [{ kind: "user-note", targetId: "a", title: "A", text: "Frozen A" },
    { kind: "user-note", targetId: "b", title: "B", text: "Frozen B", imageIds: ["img"] },
    { kind: "relation", targetId: "r", title: "Compare", text: "A vs B", relation: { from: "a", to: "b" } }],
  images: [{ id: "img", name: "B", width: 1, height: 1, bytes: 10, userRendered: true }] };

test("inquiry prepares a separate prompt without overwriting an existing draft or another book", () => {
  const store = new QuestionDraftStore();
  store.update("book:session", { question: "My question" });
  store.update("other:session", { question: "Other book" });
  store.prepareInquiry("book:session", { action: "compare", targetIds: ["a", "b"] }, "Compare A and B");
  expect(store.get("book:session")).toMatchObject({ question: "My question", pendingPrompt: "Compare A and B",
    scope: "materials", pendingMaterialIds: ["a", "b"] });
  expect(store.get("other:session").question).toBe("Other book");
  const original = store.get("book:session");
  store.update("book:session", { question: "New input" });
  store.clearIfUnchanged("book:session", original);
  expect(store.get("book:session").question).toBe("New input");
});

test("removing an item keeps its neighbour's exact frozen content and drops dangling relations/pixels", () => {
  const filtered = omitMaterialTargets(snapshot, ["b"]);
  expect(filtered.targets).toEqual([{ kind: "card", id: "a" }]);
  expect(filtered.sections).toEqual([snapshot.sections[0]]);
  expect(filtered.images).toEqual([]);
  expect(snapshot.itemCount).toBe(3);
  const store = new QuestionDraftStore();
  store.addMaterial("book:session", snapshot);
  store.removeMaterialTarget("book:session", snapshot.id, "b");
  expect(store.get("book:session").materials[0].sections[0]).toBe(snapshot.sections[0]);
  expect(store.get("book:session").materialExclusions).toEqual([{ materialId: "snapshot", targetIds: ["b"] }]);
});

test("review confirmation is explicit, atomic and preserves the newest question and other books", () => {
  const store = new QuestionDraftStore();
  store.update("book:session", { question: "Newest typed draft", materials: [snapshot], pendingPrompt: "Suggested follow-up",
    pendingMaterialIds: ["old"], materialExclusions: [{ materialId: snapshot.id, targetIds: ["b"] }] });
  store.update("other:session", { question: "Other draft", materials: [snapshot] });
  const newest = { ...snapshot, id: "reviewed" };
  store.applyReviewedMaterials("book:session", [newest], "replace");
  expect(store.get("book:session")).toMatchObject({ question: "Newest typed draft", pendingPrompt: "Suggested follow-up",
    scope: "materials", materials: [newest], images: [], attachment: undefined, pendingMaterialIds: [], materialExclusions: [] });
  expect(store.get("other:session").materials).toEqual([snapshot]);
  const before = store.get("book:session");
  expect(() => store.applyReviewedMaterials("book:session", [{ ...snapshot, itemCount: 20 }], "append")).toThrow("超过");
  expect(store.get("book:session")).toBe(before);
  store.update("book:session", { preparing: 1 });
  expect(() => store.applyReviewedMaterials("book:session", [snapshot], "replace")).toThrow("准备");
  store.update("book:session", { preparing: 0 });
  store.applyReviewedMaterials("book:session", [newest], "append");
  expect(store.get("book:session").materials).toHaveLength(1);
});
