import type { WorkspaceCard } from "../../../../../packages/protocol/src/workspace";

export type ComparisonNoteLink = {
  id: string;
  title: string;
  sourceReferences?: readonly { kind: string; targetId: string }[];
};

/** A card's own note and every note that cites the card are the same association set. */
export function relatedComparisonNotes(
  card: Pick<WorkspaceCard, "id" | "noteId">,
  notes: readonly ComparisonNoteLink[],
): ComparisonNoteLink[] {
  return notes.filter((note) => note.id === card.noteId ||
    note.sourceReferences?.some((source) => source.kind === "card" && source.targetId === card.id));
}
