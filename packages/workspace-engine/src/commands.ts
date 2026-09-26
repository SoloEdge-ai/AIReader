import type { BookWorkspace, WorkspaceCommand } from "../../protocol/src/workspace";

/** Actual entity delta, including cascaded relationship deletion; no view state. */
export function workspaceDifference(before: BookWorkspace, after: BookWorkspace): WorkspaceCommand[] {
  const changes: WorkspaceCommand[] = [];
  const compare = <T extends { id: string }>(previous: T[], next: T[],
    upsert: (value: T) => WorkspaceCommand, remove: (id: string) => WorkspaceCommand) => {
    if (previous === next) return;
    const old = new Map(previous.map((value) => [value.id, value]));
    const fresh = new Set(next.map((value) => value.id));
    for (const id of old.keys()) if (!fresh.has(id)) changes.push(remove(id));
    for (const value of next) if (JSON.stringify(old.get(value.id)) !== JSON.stringify(value)) changes.push(upsert(value));
  };
  compare(before.cards, after.cards, (card) => ({ type: "upsert-card", card }), (id) => ({ type: "delete-card", id }));
  compare(before.objects, after.objects, (object) => ({ type: "upsert-object", object }), (id) => ({ type: "delete-object", id }));
  compare(before.groups, after.groups, (group) => ({ type: "upsert-group", group }), (id) => ({ type: "delete-group", id }));
  compare(before.links, after.links, (link) => ({ type: "upsert-link", link }), (id) => ({ type: "delete-link", id }));
  return changes;
}

export function applyWorkspaceChanges(current: BookWorkspace, changes: WorkspaceCommand[]): BookWorkspace {
  const cards = new Map(current.cards.map((card) => [card.id, card]));
  const objects = new Map(current.objects.map((object) => [object.id, object]));
  const groups = new Map(current.groups.map((group) => [group.id, group]));
  const links = new Map(current.links.map((link) => [link.id, link]));
  const unlink = (target: string) => {
    for (const [id, link] of links) if (link.from === target || link.to === target) links.delete(id);
  };
  const ungroup = (target: string) => {
    for (const [id, group] of groups)
      if (group.memberIds.includes(target))
        groups.set(id, { ...group, memberIds: group.memberIds.filter((memberId) => memberId !== target) });
  };
  for (const change of changes) {
    switch (change.type) {
      case "upsert-card": cards.set(change.card.id, change.card); break;
      case "delete-card": cards.delete(change.id); unlink(change.id); ungroup(change.id); break;
      case "upsert-object": objects.set(change.object.id, change.object); break;
      case "delete-object": objects.delete(change.id); unlink(change.id); ungroup(change.id); break;
      case "upsert-group": groups.set(change.group.id, change.group); break;
      case "delete-group": groups.delete(change.id); break;
      case "upsert-link": links.set(change.link.id, change.link); break;
      case "delete-link": links.delete(change.id); break;
    }
  }
  return { ...current, cards: [...cards.values()], objects: [...objects.values()],
    groups: [...groups.values()], links: [...links.values()] };
}
