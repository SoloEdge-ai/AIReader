import {
  WORKSPACE_DOCUMENT_X,
  type WorkspaceCard,
} from "../../../packages/protocol/src/workspace";

/** Reserve the continuous document column, including gaps between pages. */
export function dockBesideDocument<
  T extends Pick<WorkspaceCard, "x" | "y" | "width" | "height">,
>(card: T, documentWidth: number): T {
  const left = WORKSPACE_DOCUMENT_X - 24;
  const right = WORKSPACE_DOCUMENT_X + documentWidth + 24;
  if (card.x + card.width <= left || card.x >= right) return card;
  const onLeft = card.x + card.width / 2 < (left + right) / 2;
  return { ...card, x: onLeft ? Math.max(0, left - card.width) : right };
}
