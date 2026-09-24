import type { Book } from "./library";
import type { ChatTurn } from "./chat";
import type { IndexJob } from "./indexing";
import type { Annotation, Note } from "./notes";
import type { AccountState, AiRuntimeStatus } from "./ai";

/** Book-scoped events cannot omit their book identity. Global account/runtime events have none. */
export type CoreEvent =
  | { type: "book"; bookId: string; data: Book }
  | { type: "turn"; bookId: string; taskId: string; data: ChatTurn }
  | { type: "index"; bookId: string; taskId: string; data: IndexJob }
  | { type: "annotation"; bookId: string; taskId: string; data: Annotation }
  | { type: "note"; bookId: string; taskId: string; data: Note }
  | { type: "workspace"; bookId: string; taskId: string }
  | { type: "account"; data: AccountState }
  | { type: "runtime"; data: AiRuntimeStatus };
