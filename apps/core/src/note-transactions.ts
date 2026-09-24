import type { Annotation, Note } from "../../../packages/protocol/src/notes";
import type { CoreEvent } from "../../../packages/protocol/src/events";
import type { Storage } from "./storage";

type NoteEvent = Extract<CoreEvent, { type: "note" | "annotation" }>;

/** Synchronous Note lifecycle writes: publish snapshots only after the owning transaction commits. */
export class NoteTransactions {
  private events?: NoteEvent[];

  constructor(private readonly storage: Storage, private readonly publish: (event: CoreEvent) => void) {}

  run(action: () => void) {
    if (this.events) throw new Error("笔记事务不能嵌套");
    const events: NoteEvent[] = [];
    this.events = events;
    try {
      this.storage.transaction(action);
    } finally {
      // Rollback discards the queue; publication below is reached only after COMMIT succeeds.
      this.events = undefined;
    }
    for (const event of events) this.publish(event);
  }

  save(value: Annotation | Note) {
    const event: NoteEvent = "document" in value
      ? { type: "note", bookId: value.bookId, taskId: value.id, data: structuredClone(value) }
      : { type: "annotation", bookId: value.bookId, taskId: value.id, data: structuredClone(value) };
    this.storage.put(event.type, value.id, value.bookId, value);
    if (this.events) this.events.push(event);
    else this.publish(event);
  }
}
