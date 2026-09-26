import { NoteEditingSession } from "../notes/NoteEditingSession";
import { WorkspaceEditingSession } from "../workspace/WorkspaceEditingSession";
import type { BookChange, BookCommandReceipt } from "../../../../../packages/protocol/src/book-commands";
import { submitBookCommand } from "./BookCommandClient";

/** Owns the editing lifecycle for one book, including the content-before-placement save barrier. */
export class BookEditingSession {
  readonly notes: NoteEditingSession;
  readonly workspace?: WorkspaceEditingSession;
  private commandTail: Promise<void> = Promise.resolve();
  private pendingCommands = 0;
  private attempts = new Map<string, { expectedContentVersion: number; changes: BookChange[] }>();

  constructor(readonly bookId?: string) {
    this.workspace = bookId ? new WorkspaceEditingSession(bookId) : undefined;
    this.notes = new NoteEditingSession(bookId, async (change, commandId) => {
      const receipt = await this.submitChanges([change], commandId);
      const note = receipt.noteChanges.find((item) => item.after.id ===
        ("noteId" in change ? change.noteId : undefined))?.after;
      if (!note) throw new Error("书籍命令未返回笔记");
      return note;
    }, this.resolveAttempt, this.cancelAttempt);
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
    return this.pendingCommands > 0 || this.attempts.size > 0 || this.notes.getSnapshot().dirty || Boolean(this.workspace?.isDirty());
  }

  flush = async (): Promise<boolean> => {
    if (!(await this.notes.flush())) return false;
    await this.commandTail;
    if (this.attempts.size) return false;
    return this.workspace?.flush() ?? true;
  };

  /** Serialize Note and board commands against the same book content version. */
  submitChanges = (changes: BookChange[], commandId: string = crypto.randomUUID()): Promise<BookCommandReceipt> => {
    if (!this.bookId || !this.workspace) return Promise.reject(new Error("未打开书籍"));
    const run = this.commandTail.then(async () => {
      const workspace = this.workspace!;
      if (!(await workspace.flush())) throw new Error("工作台草稿尚未保存，请重试");
      const expectedContentVersion = this.attempts.get(commandId)?.expectedContentVersion ?? workspace.revision();
      if (expectedContentVersion === undefined) throw new Error("工作台尚未加载");
      if (!this.attempts.has(commandId)) this.attempts.set(commandId, { expectedContentVersion, changes });
      const release = workspace.holdForBookCommand();
      try {
        const attempt = this.attempts.get(commandId)!;
        const receipt = await submitBookCommand({ bookId: this.bookId!, commandId,
          expectedContentVersion: attempt.expectedContentVersion, changes: attempt.changes });
        workspace.acceptBookReceipt(receipt);
        if (!attempt.changes.some((change) => change.type === "undo")) {
          let target = receipt.commandId;
          const reverse = async () => {
            if (!(await this.notes.flush())) throw new Error("笔记草稿尚未保存，无法撤销");
            const result = await this.submitChanges([{ type: "undo", targetCommandId: target }]);
            target = result.commandId;
            await this.notes.refresh();
          };
          workspace.recordExternal({ kind: "external", undo: reverse, redo: reverse });
        }
        this.attempts.delete(commandId);
        return receipt;
      } finally { release(); }
    });
    this.pendingCommands++;
    void run.finally(() => { this.pendingCommands--; }).catch(() => {});
    this.commandTail = run.then(() => {}, () => {});
    return run;
  };

  private resolveAttempt = async (commandId: string): Promise<void> => {
    const attempt = this.attempts.get(commandId);
    if (!attempt) return;
    await this.commandTail;
    // A newer content version does not prove this particular command committed.
    // Reuse the normal acceptance path so an exact Core receipt also restores undo history.
    await this.submitChanges(attempt.changes, commandId);
    await this.workspace?.reload(true);
    this.attempts.delete(commandId);
  };

  private cancelAttempt = async (commandId: string): Promise<void> => {
    await this.commandTail;
    this.attempts.delete(commandId);
    await this.workspace?.reload(true);
  };
}
