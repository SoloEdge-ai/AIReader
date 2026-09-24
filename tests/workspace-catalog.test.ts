import { expect, test } from "vitest";
import { locateWorkspaceItem } from "../packages/workspace-engine/src/catalog";
import type { WorkspacePage } from "../packages/workspace-engine/src/surfaces";
import type { BookWorkspace } from "../packages/protocol/src/workspace";

const fingerprint = "a".repeat(64);
const page: WorkspacePage = {
  page: 1, x: 100, y: 200, width: 300, height: 400,
  locate: () => ({ x: 140, y: 260 }),
  toWorld: ([x, y]) => [x + 100, y + 200],
  toPdf: ([x, y]) => [x - 100, y - 200],
};
const workspace: Pick<BookWorkspace, "cards" | "objects" | "links"> = {
  cards: [{ id: "card", kind: "note", title: "", text: "", comment: "",
    x: 500, y: 600, width: 250, height: 170 }],
  objects: [
    { id: "shape", kind: "shape", shape: "rectangle", surface: { kind: "pdf", fingerprint, page: 1 },
      x: 30, y: 40, width: 60, height: 50, color: "#345d84", strokeWidth: 2 },
    { id: "stroke", kind: "ink", brush: "pen", color: "#345d84", width: 2, opacity: 1,
      segments: [{ surface: { kind: "pdf", fingerprint, page: 1 }, points: [[15, 20], [50, 60]] }] },
  ],
  links: [{ id: "relation", from: "missing-annotation", to: "shape", label: "", directed: false }],
};

test("material navigation resolves card, PDF object, ink and relation locations in world coordinates", () => {
  expect(locateWorkspaceItem("card", workspace, [page], [])).toEqual({ x: 500, y: 600 });
  expect(locateWorkspaceItem("shape", workspace, [page], [])).toEqual({ x: 130, y: 240 });
  expect(locateWorkspaceItem("stroke", workspace, [page], [])).toEqual({ x: 115, y: 220 });
  expect(locateWorkspaceItem("relation", workspace, [page], [])).toEqual({ x: 130, y: 240 });
  expect(locateWorkspaceItem("unknown", workspace, [page], [])).toBeUndefined();
});
