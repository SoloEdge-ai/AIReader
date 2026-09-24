import type { Annotation } from "../../protocol/src/notes";
import type { BookWorkspace } from "../../protocol/src/workspace";
import { projectStroke } from "./ink";
import { objectRect } from "./objects";
import type { WorkspacePage } from "./surfaces";

type Catalog = Pick<BookWorkspace, "cards" | "objects" | "links">;
type Position = { x: number; y: number };

/** Find a canvas item's current projected position without storing viewport pixels. */
export function locateWorkspaceItem(id: string, workspace: Catalog, pages: WorkspacePage[],
  annotations: Pick<Annotation, "id" | "anchors">[]): Position | undefined {
  const position = (targetId: string): Position | undefined => {
    const card = workspace.cards.find((entry) => entry.id === targetId);
    if (card) return { x: card.x, y: card.y };
    const object = workspace.objects.find((entry) => entry.id === targetId);
    if (object?.kind === "ink") {
      const paths = projectStroke(object, pages).paths;
      return paths.length ? { x: Math.min(...paths.map((path) => path.bounds[0])),
        y: Math.min(...paths.map((path) => path.bounds[1])) } : undefined;
    }
    if (object) {
      const rect = objectRect(object, pages);
      return rect && { x: rect.x, y: rect.y };
    }
    const anchor = annotations.find((entry) => entry.id === targetId)?.anchors[0];
    const page = pages.find((entry) => entry.page === anchor?.page);
    return page && anchor ? page.locate(anchor.rects[0]) : undefined;
  };
  const link = workspace.links.find((entry) => entry.id === id);
  return link ? position(link.from) ?? position(link.to) : position(id);
}
