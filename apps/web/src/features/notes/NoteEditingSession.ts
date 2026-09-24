import type { Annotation, Note, RichNode } from "../../../../../packages/protocol/src";
import { notesClient } from "../../client/notes";

type Draft = Pick<Note, "title" | "document">;
type Snapshot = {
  notes: Note[];
  annotations: Annotation[];
  selected?: string;
  selectedAnnotation?: string;
  status: string;
  dirty: boolean;
  canUndo: boolean;
};
export const canonicalDocument = (value: unknown): string => JSON.stringify(value, (_key, item) =>
  item && typeof item === "object" && !Array.isArray(item)
    ? Object.fromEntries(Object.keys(item).sort().map((key) => [key, item[key]])) : item);

/** One book's note truth: committed versions plus shared drafts, never editor-local copies. */
export class NoteEditingSession {
  private readonly client;
  private records: Note[] = [];
  private annotations: Annotation[] = [];
  private drafts = new Map<string, Draft>();
  private listeners = new Set<() => void>();
  private timer?: ReturnType<typeof setTimeout>;
  private pending?: Promise<boolean>;
  private undo: (() => Promise<unknown>)[] = [];
  private historyPending?: Promise<void>;
  private refreshSequence = 0;
  private committedGeneration = 0;
  private snapshot: Snapshot = { notes: [], annotations: [], status: "已保存", dirty: false, canUndo: false };

  constructor(readonly bookId?: string) { this.client = bookId ? notesClient(bookId) : undefined; }
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  private publish(patch: Partial<Snapshot> = {}) {
    this.snapshot = {
      ...this.snapshot, ...patch,
      notes: this.records.map((note) => ({ ...note, ...this.drafts.get(note.id) })),
      annotations: this.annotations, dirty: this.drafts.size > 0, canUndo: this.undo.length > 0,
    };
    for (const listener of this.listeners) listener();
  }
  setSelected = (id?: string) => { this.publish({ selected: id, selectedAnnotation: undefined }); };
  selectAnnotation = (id: string) => {
    const annotation = this.annotations.find((item) => item.id === id);
    this.publish({ selected: annotation?.noteId, selectedAnnotation: id });
  };
  comment = async (id: string) => {
    if (!this.client || !(await this.flush())) return;
    const note = await this.client.comment(id);
    await this.refresh();
    this.setSelected(note.id);
  };
  pause = () => { clearTimeout(this.timer); };
  refresh = async (adoptDraftBase = false): Promise<void> => {
    if (!this.client) return;
    const sequence = ++this.refreshSequence;
    if (this.pending) await this.pending;
    const generation = this.committedGeneration;
    try {
      const [notes, annotations] = await Promise.all([this.client.list(), this.client.annotations()]);
      // A slow refresh must not replace a newer successful save's revision.
      if (sequence !== this.refreshSequence) return;
      if (generation !== this.committedGeneration) return this.refresh(adoptDraftBase);
      const present = new Set(notes.map((note) => note.id));
      this.records = [
        ...notes.map((note) => !adoptDraftBase && this.drafts.has(note.id)
          ? { ...(this.records.find((original) => original.id === note.id) ?? note),
            annotationSource: note.annotationSource } : note),
        ...this.records.filter((note) => this.drafts.has(note.id) && !present.has(note.id)),
      ];
      this.annotations = annotations;
      this.publish();
    } catch (error) {
      this.publish({ status: `加载失败：${String(error)}` });
      throw error;
    }
  };
  edit = (id: string, title: string, document: RichNode) => {
    if (!this.records.some((note) => note.id === id)) throw new Error("笔记不属于此编辑会话");
    this.drafts.set(id, { title, document: structuredClone(document) });
    this.publish({ status: "保存中…" });
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), 650);
  };
  private accept(saved: Note, sent: Draft) {
    this.records = this.records.map((note) => note.id === saved.id
      ? { ...saved, annotationSource: saved.annotationSource ?? note.annotationSource } : note);
    this.committedGeneration++;
    if (this.drafts.get(saved.id) === sent) this.drafts.delete(saved.id);
    this.publish();
  }
  flush = async (): Promise<boolean> => {
    clearTimeout(this.timer);
    if (this.pending) return this.pending;
    if (!this.client || !this.drafts.size) return true;
    this.pending = this.saveDrafts();
    try { return await this.pending; }
    finally { this.pending = undefined; }
  };
  private async saveDrafts(): Promise<boolean> {
    this.publish({ status: "保存中…" });
    try {
      while (this.drafts.size) {
        const [id, sent] = this.drafts.entries().next().value!;
        const original = this.records.find((note) => note.id === id);
        if (!original) throw new Error("草稿对应的笔记不存在，请保留内容");
        const title = sent.title.trim() || "未命名笔记";
        try {
          const saved = await this.client!.update(id, { ...sent, title, revision: original.revision });
          this.accept(saved, sent);
        } catch (error) {
          // Reconcile the exact request, not the newer draft typed while it was in flight.
          const latest = await this.client!.list().catch(() => []);
          const saved = latest.find((note) => note.id === id);
          if (!saved || saved.title !== title || canonicalDocument(saved.document) !== canonicalDocument(sent.document))
            throw error;
          this.accept(saved, sent);
        }
      }
      this.publish({ status: "已保存" });
      return true;
    } catch (error) {
      this.publish({ status: `保存失败，草稿仍保留：${String(error)}` });
      return false;
    }
  }
  retryWithLatest = async () => { await this.refresh(true); return this.flush(); };
  create = async () => {
    if (!this.client || !(await this.flush())) return;
    const note = await this.client.create();
    await this.refresh();
    this.setSelected(note.id);
    return note;
  };
  recordUndo = (action: () => Promise<unknown>) => {
    this.undo = [...this.undo.slice(-99), action];
    this.publish();
  };
  remove = async (note: Note) => {
    if (!this.client || !(await this.flush())) return;
    if (note.bookId !== this.bookId) throw new Error("笔记不属于此编辑会话");
    await this.client.remove("notes", note.id);
    this.recordUndo(() => this.client!.restore("notes", note.id));
    this.setSelected(undefined);
    await this.refresh();
  };
  color = async (annotation: Annotation, color: Annotation["color"]) => {
    if (!this.client || annotation.bookId !== this.bookId) throw new Error("批注不属于此编辑会话");
    await this.client.color(annotation.id, annotation.revision, color);
    this.recordUndo(async () => {
      const current = (await this.client!.annotations()).find((item) => item.id === annotation.id);
      if (!current) throw new Error("批注不存在");
      return this.client!.color(current.id, current.revision, annotation.color);
    });
    await this.refresh();
  };
  removeAnnotation = async (annotation: Annotation) => {
    if (!this.client || annotation.bookId !== this.bookId) throw new Error("批注不属于此编辑会话");
    if (!(await this.flush())) return;
    await this.client.remove("annotations", annotation.id);
    this.recordUndo(() => this.client!.restore("annotations", annotation.id));
    await this.refresh();
  };
  undoLast = async () => {
    if (this.historyPending) return this.historyPending;
    this.historyPending = (async () => {
      if (!(await this.flush())) return;
      const action = this.undo.at(-1);
      if (!action) return;
      await action();
      const index = this.undo.lastIndexOf(action);
      if (index >= 0) this.undo.splice(index, 1);
      this.publish();
      await this.refresh();
    })();
    try { await this.historyPending; }
    finally { this.historyPending = undefined; }
  };
}
