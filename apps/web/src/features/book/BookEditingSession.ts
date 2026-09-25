import { NoteEditingSession } from "../notes/NoteEditingSession";
import { WorkspaceEditingSession } from "../workspace/WorkspaceEditingSession";

/** Owns the editing lifecycle for one book, including the content-before-placement save barrier. */
export class BookEditingSession {
  readonly notes: NoteEditingSession;
  readonly workspace?: WorkspaceEditingSession;

  constructor(readonly bookId?: string) {
    this.notes = new NoteEditingSession(bookId);
    this.workspace = bookId ? new WorkspaceEditingSession(bookId) : undefined;
  }

  activate(): void {
    this.workspace?.activate();
    void this.notes.refresh().catch(() => {});
    void this.workspace?.load();
  }

  dispose(): void {
    this.notes.pause();
    this.workspace?.dispose();
  }

  isDirty(): boolean {
    return this.notes.getSnapshot().dirty || Boolean(this.workspace?.isDirty());
  }

  flush = async (): Promise<boolean> => {
    if (!(await this.notes.flush())) return false;
    return this.workspace?.flush() ?? true;
  };
}
