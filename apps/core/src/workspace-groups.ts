import type { BookWorkspace } from "../../../packages/protocol/src/workspace";

type GroupWorkspace = Pick<BookWorkspace, "cards" | "objects" | "groups">;

/** Validates group identity and membership without changing relation endpoints. */
export function validateWorkspaceGroups(workspace: GroupWorkspace) {
  const cardIds = new Set(workspace.cards.map((card) => card.id));
  const objects = new Map(workspace.objects.map((object) => [object.id, object]));
  const contentIds = new Set([...cardIds, ...objects.keys()]);
  const groupIds = new Set(workspace.groups.map((group) => group.id));
  if (groupIds.size !== workspace.groups.length || [...groupIds].some((id) => contentIds.has(id)))
    throw new Error("主题组标识重复或与工作区对象冲突");

  const grouped = new Set<string>();
  for (const group of workspace.groups)
    for (const memberId of group.memberIds) {
      const object = objects.get(memberId);
      const boardOnly = object && (object.kind === "ink"
        ? object.segments.every((segment) => segment.surface.kind === "board")
        : object.surface.kind === "board");
      if (!cardIds.has(memberId) && !boardOnly)
        throw new Error("主题组成员不存在、不属于本书或不完全位于白板");
      if (grouped.has(memberId)) throw new Error("一个对象只能属于一个主题组");
      grouped.add(memberId);
    }
}
