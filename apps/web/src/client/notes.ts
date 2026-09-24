import type { Annotation, Note, RichNode } from "../../../../packages/protocol/src";
import { api, post } from "../api";

/** Book identity is captured once, not supplied by each editor action. */
export function notesClient(bookId: string) {
  const book = `books/${encodeURIComponent(bookId)}`;
  const entity = (kind: "notes" | "annotations", id: string) => `${book}/${kind}/${encodeURIComponent(id)}`;
  return {
    list: () => api<Note[]>(`${book}/notes`),
    annotations: () => api<Annotation[]>(`${book}/annotations`),
    create: () => post<Note>(`${book}/notes`, {}),
    update: (id: string, input: { revision: number; title: string; document: RichNode }) =>
      post<Note>(entity("notes", id), input),
    color: (id: string, revision: number, color: Annotation["color"]) =>
      post<Annotation>(entity("annotations", id), { revision, color }),
    remove: (kind: "notes" | "annotations", id: string) => api(entity(kind, id), { method: "DELETE" }),
    restore: (kind: "notes" | "annotations", id: string) => post(entity(kind, id) + "/restore", {}),
  };
}
