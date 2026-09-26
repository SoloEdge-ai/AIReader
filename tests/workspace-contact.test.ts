import { expect, test } from "vitest";
import { cardContact, nearestContact, paperBridge } from "../packages/workspace-engine/src/contact";
import { releaseCardContact } from "../apps/web/src/features/workspace/groups";
import { WorkspaceSchema } from "../packages/protocol/src/workspace";
const card = (id: string, x: number, y = 100) => ({ id, kind: "note" as const,
  title: id, text: "", comment: "", x, y, width: 320, height: 200 });
test("contact needs an edge, ignores self and diagonal neighbours, previews before attaching", () => {
  const a = card("a", 100), b = card("b", 438);
  expect(nearestContact(a, [a, b])?.targetId).toBe("b");
  expect(cardContact(a, b, 8)).toBeUndefined();
  expect(cardContact(a, card("b", 438, 302))).toBeUndefined();
  expect(cardContact(a, card("b", 250))).toBeUndefined();
  expect(paperBridge(a, b)).toContain(" C ");
});
test("release attaches and separates a cluster without manufacturing a semantic relation", () => {
  const original = WorkspaceSchema.parse({ bookId: "book1", revision: 0, groups: [], links: [], cards: [card("a", 100), card("b", 425)] });
  const attached = releaseCardContact(original, "b", "group1");
  expect(attached.groups[0]).toMatchObject({ presentation: "cluster", memberIds: ["b", "a"] });
  expect(attached.links).toEqual([]);
  expect(attached.cards[1].x).toBe(444);
  expect(original.groups).toEqual([]);
  const separated = releaseCardContact({ ...attached, cards: attached.cards.map((item) =>
    item.id === "b" ? { ...item, x: 900 } : item) }, "b", "unused");
  expect(separated.groups[0].memberIds).toEqual(["a"]);
  expect(WorkspaceSchema.parse(separated)).toEqual(separated);
});
