import { cardContact, nearestContact } from "../../../../../packages/workspace-engine/src/contact";
import type { BookWorkspace, WorkspaceCard, WorkspaceGroup, WorkspaceObject } from "../../../../../packages/protocol/src/workspace";
import { objectRect } from "../../../../../packages/workspace-engine/src/objects";
import { projectStroke } from "../../../../../packages/workspace-engine/src/ink";

type Rect = { x: number; y: number; width: number; height: number };

export function boardMemberBounds(snapshot: BookWorkspace, id: string): Rect | undefined {
  const card = snapshot.cards.find((item) => item.id === id && item.placed !== false);
  if (card) return card;
  const object = snapshot.objects.find((item) => item.id === id);
  if (!object || !isBoardObject(object)) return;
  if (object.kind !== "ink") return objectRect(object, []);
  const paths = projectStroke(object, []).paths;
  if (!paths.length) return;
  const x = Math.min(...paths.map((path) => path.bounds[0]));
  const y = Math.min(...paths.map((path) => path.bounds[1]));
  return { x, y, width: Math.max(...paths.map((path) => path.bounds[2])) - x,
    height: Math.max(...paths.map((path) => path.bounds[3])) - y };
}

export function isBoardObject(object: WorkspaceObject): boolean {
  return object.kind === "ink" ? object.segments.every((segment) => segment.surface.kind === "board") :
    object.surface.kind === "board";
}

export function groupSelection(snapshot: BookWorkspace, selectedIds: string[], id: string,
  title: string, color: string): BookWorkspace {
  const memberIds = [...new Set(selectedIds)].filter((item) => boardMemberBounds(snapshot, item));
  if (!memberIds.length) return snapshot;
  const bounds = memberIds.map((item) => boardMemberBounds(snapshot, item)!);
  const x = Math.max(0, Math.min(...bounds.map((rect) => rect.x)) - 24);
  const y = Math.max(0, Math.min(...bounds.map((rect) => rect.y)) - 48);
  const right = Math.max(...bounds.map((rect) => rect.x + rect.width)) + 24;
  const bottom = Math.max(...bounds.map((rect) => rect.y + rect.height)) + 24;
  const group: WorkspaceGroup = { id, title, color, x, y,
    width: Math.max(220, right - x), height: Math.max(120, bottom - y), memberIds, collapsed: false };
  return { ...snapshot, groups: [...snapshot.groups.map((old) => ({ ...old,
    memberIds: old.memberIds.filter((item) => !memberIds.includes(item)) })), group] };
}

function shiftObject(object: WorkspaceObject, dx: number, dy: number): WorkspaceObject {
  if (!isBoardObject(object)) return object;
  if (object.kind !== "ink") return { ...object, x: object.x + dx, y: object.y + dy };
  return { ...object, segments: object.segments.map((segment) => ({ ...segment,
    points: segment.points.map(([x, y]) => [x + dx, y + dy] as [number, number]) })) };
}

export function moveGroup(snapshot: BookWorkspace, groupId: string, dx: number, dy: number): BookWorkspace {
  const group = snapshot.groups.find((item) => item.id === groupId);
  if (!group) return snapshot;
  const bounds = group.memberIds.map((id) => boardMemberBounds(snapshot, id)).filter((rect): rect is Rect => !!rect);
  dx = Math.max(-Math.min(group.x, ...bounds.map((rect) => rect.x)), dx);
  dy = Math.max(-Math.min(group.y, ...bounds.map((rect) => rect.y)), dy);
  if (!dx && !dy) return snapshot;
  const members = new Set(group.memberIds);
  return { ...snapshot,
    cards: snapshot.cards.map((card) => members.has(card.id) ? { ...card, x: card.x + dx, y: card.y + dy } : card),
    objects: snapshot.objects.map((object) => members.has(object.id) ? shiftObject(object, dx, dy) : object),
    groups: snapshot.groups.map((item) => item.id === groupId ? { ...item,
      x: item.x + dx, y: item.y + dy } : item),
  };
}

function sourcePage(card?: WorkspaceCard): number {
  return card?.region?.page ?? card?.source?.anchors[0]?.page ?? Number.MAX_SAFE_INTEGER;
}

export function arrangeGroup(snapshot: BookWorkspace, groupId: string): BookWorkspace {
  const group = snapshot.groups.find((item) => item.id === groupId);
  if (!group || !group.memberIds.length) return snapshot;
  const members = group.memberIds.map((id, index) => ({ id, index,
    card: snapshot.cards.find((card) => card.id === id), bounds: boardMemberBounds(snapshot, id) }))
    .filter((item): item is typeof item & { bounds: Rect } => !!item.bounds);
  members.sort((a, b) => {
    const category = (card?: WorkspaceCard) => !card ? 2 : card.kind === "note" ? 1 : 0;
    return category(a.card) - category(b.card) || sourcePage(a.card) - sourcePage(b.card) || a.index - b.index;
  });
  const columns = members.length > 1 ? 2 : 1;
  const cellWidth = Math.max(...members.map((item) => item.bounds.width)) + 24;
  const cellHeight = Math.max(...members.map((item) => item.bounds.height)) + 24;
  const offsets = new Map(members.map((item, index) => [item.id, {
    dx: group.x + 24 + (index % columns) * cellWidth - item.bounds.x,
    dy: group.y + 54 + Math.floor(index / columns) * cellHeight - item.bounds.y,
  }]));
  return { ...snapshot,
    cards: snapshot.cards.map((card) => {
      const offset = offsets.get(card.id);
      return offset ? { ...card, x: card.x + offset.dx, y: card.y + offset.dy } : card;
    }),
    objects: snapshot.objects.map((object) => {
      const offset = offsets.get(object.id);
      return offset ? shiftObject(object, offset.dx, offset.dy) : object;
    }),
    groups: snapshot.groups.map((item) => item.id === groupId ? { ...item,
      width: Math.max(220, columns * cellWidth + 24),
      height: Math.max(120, Math.ceil(members.length / columns) * cellHeight + 54) } : item),
  };
}

export function assignCardGroup(snapshot: BookWorkspace, card: WorkspaceCard): BookWorkspace {
  const centerX = card.x + card.width / 2, centerY = card.y + card.height / 2;
  const target = snapshot.groups.find((group) => group.presentation !== "cluster" && !group.collapsed &&
    centerX >= group.x && centerX <= group.x + group.width &&
    centerY >= group.y && centerY <= group.y + group.height);
  return { ...snapshot, groups: snapshot.groups.map((group) => ({ ...group,
    memberIds: group.id === target?.id
      ? [...new Set([...group.memberIds, card.id])]
      : group.memberIds.filter((id) => id !== card.id),
    width: group.id === target?.id ? Math.max(group.width, card.x + card.width + 24 - group.x) : group.width,
    height: group.id === target?.id ? Math.max(group.height, card.y + card.height + 24 - group.y) : group.height,
  })) };
}

export function addCardToGroup(snapshot: BookWorkspace, card: WorkspaceCard,
  groupId: string | undefined): BookWorkspace {
  if (!groupId) return snapshot;
  return { ...snapshot, groups: snapshot.groups.map((group) => group.id === groupId ? { ...group,
    memberIds: [...new Set([...group.memberIds, card.id])],
    width: Math.max(group.width, card.x + card.width + 24 - group.x),
    height: Math.max(group.height, card.y + card.height + 24 - group.y),
  } : group) };
}

/** Rebuild only clusters touched by a completed move, preserving each connected component. */
function splitCluster(snapshot: BookWorkspace, movedId: string, freshId: string): BookWorkspace {
  const owner = snapshot.groups.find((group) => group.presentation === "cluster" && group.memberIds.includes(movedId));
  if (!owner) return snapshot;
  const remaining = new Set(owner.memberIds);
  const cards = new Map(snapshot.cards.map((card) => [card.id, card]));
  const components: string[][] = [];
  while (remaining.size) {
    const component = [remaining.values().next().value!]; remaining.delete(component[0]);
    for (let i = 0; i < component.length; i++) {
      const from = cards.get(component[i]);
      if (!from) continue;
      for (const id of remaining) {
        const to = cards.get(id);
        if (to && cardContact(from, to, 44)) { remaining.delete(id); component.push(id); }
      }
    }
    if (component.length > 1) components.push(component);
  }
  if (components.length === 1 && components[0].length === owner.memberIds.length) return snapshot;
  let next = { ...snapshot, groups: snapshot.groups.filter((group) => group.id !== owner.id) };
  for (const [index, members] of components.entries()) {
    const id = index === 0 ? owner.id : `${freshId}_${index}`;
    next = groupSelection(next, members, id, owner.title, owner.color);
    next = { ...next, groups: next.groups.map((group) => group.id === id ? { ...group, presentation: "cluster" as const } : group) };
  }
  return next;
}

/** Release commits position and membership together through the existing atomic workspace command. */
export function releaseCardContact(snapshot: BookWorkspace, cardId: string, groupId: string): BookWorkspace {
  snapshot = splitCluster(snapshot, cardId, groupId);
  const card = snapshot.cards.find((item) => item.id === cardId);
  if (!card) return snapshot;
  const owner = snapshot.groups.find((group) => group.memberIds.includes(cardId));
  if (owner && owner.presentation !== "cluster") return snapshot;
  const eligible = snapshot.cards.filter((item) => item.placed !== false && !snapshot.groups.some((group) =>
    group.memberIds.includes(item.id) && (group.collapsed || group.presentation !== "cluster")));
  const contact = nearestContact(card, eligible, 8);
  if (!contact) {
    if (!owner || nearestContact(card, eligible.filter((item) => owner.memberIds.includes(item.id)), 44)) return snapshot;
    return { ...snapshot, groups: snapshot.groups.map((group) => group.id === owner.id ? { ...group,
      memberIds: group.memberIds.filter((id) => id !== cardId) } : group) };
  }
  const target = eligible.find((item) => item.id === contact.targetId)!;
  const targetGroup = snapshot.groups.find((group) => group.memberIds.includes(target.id));
  const members = [...new Set([...(owner?.memberIds ?? [cardId]), ...(targetGroup?.memberIds ?? [target.id])])];
  const nextCard = contact.axis === "x" ? { ...card, x: Math.max(0, card.x < target.x ? target.x - card.width - 24 : target.x + target.width + 24) }
    : { ...card, y: Math.max(0, card.y < target.y ? target.y - card.height - 24 : target.y + target.height + 24) };
  const id = targetGroup?.id ?? owner?.id ?? groupId;
  const title = targetGroup?.title ?? owner?.title ?? "关联材料";
  const color = targetGroup?.color ?? owner?.color ?? "#5d83b0";
  const grouped = groupSelection({ ...snapshot, cards: snapshot.cards.map((item) => item.id === cardId ? nextCard : item),
    groups: snapshot.groups.filter((group) => group.id !== owner?.id && group.id !== targetGroup?.id) }, members, id, title, color);
  return { ...grouped, groups: grouped.groups.map((group) => group.id === id ? { ...group, presentation: "cluster" } : group) };
}
