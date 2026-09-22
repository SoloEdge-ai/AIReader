import type {
  ReadingSelection,
  ReadingSnapshot,
} from "../../../packages/protocol/src";

export type QuestionDraft = {
  question: string;
  scope: ReadingSnapshot["scope"];
  attachment?: ReadingSelection;
};

const emptyDraft: QuestionDraft = { question: "", scope: "auto" };

// Lives with App, not the sidebar. A delayed submission must also update a
// reopened view without erasing a newer draft for the same book/session.
export class QuestionDraftStore {
  private drafts = new Map<string, QuestionDraft>();
  private listeners = new Set<() => void>();

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  get(key: string): QuestionDraft {
    return this.drafts.get(key) ?? emptyDraft;
  }

  update(key: string, patch: Partial<QuestionDraft>) {
    this.drafts.set(key, { ...this.get(key), ...patch });
    this.emit();
  }

  clearIfUnchanged(key: string, submitted: QuestionDraft) {
    if (this.get(key) !== submitted) return;
    this.drafts.delete(key);
    this.emit();
  }

  private emit() {
    for (const listener of this.listeners) listener();
  }
}
