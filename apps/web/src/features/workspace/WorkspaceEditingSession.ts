import type { BookWorkspace, WorkspaceCommand, WorkspaceCommandBatch } from "../../../../../packages/protocol/src/workspace";
import { applyWorkspaceChanges as apply, workspaceDifference as difference } from "../../../../../packages/workspace-engine/src/commands";
import { api } from "../../api";
import { submitWorkspaceCommand } from "../../client/workspace";

type ExternalHistory = { kind: "external"; undo: () => Promise<void>; redo: () => Promise<void> };
type HistoryEntry = WorkspaceCommand[] | ExternalHistory;
type Snapshot = {
  value?: BookWorkspace;
  status: string;
  error: string;
  canUndo: boolean;
  canRedo: boolean;
};

/** One book's workspace draft, idempotent command queue and in-memory history. */
export class WorkspaceEditingSession {
  private snapshot: Snapshot = {
    status: "正在加载工作区…", error: "", canUndo: false, canRedo: false,
  };
  private listeners = new Set<() => void>();
  private draft?: BookWorkspace;
  private committed?: BookWorkspace;
  private generation = 0;
  private saved = 0;
  private viewGeneration = 0;
  private viewSaved = 0;
  private inFlight?: { batch: WorkspaceCommandBatch; generation: number };
  private pending?: Promise<boolean>;
  private history: HistoryEntry[] = [];
  private redoHistory: HistoryEntry[] = [];
  private historyQueue: Promise<void> = Promise.resolve();
  private timer?: ReturnType<typeof setTimeout>;
  private loadRequest = 0;
  private reloadRequest = 0;
  private externalIds = new Set<string>();
  private live = true;

  constructor(readonly bookId: string) {}

  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  private publish(patch: Partial<Snapshot> = {}) {
    if (!this.live) return;
    this.snapshot = {
      ...this.snapshot, ...patch,
      canUndo: this.history.length > 0,
      canRedo: this.redoHistory.length > 0,
    };
    for (const listener of this.listeners) listener();
  }
  setExternalEndpointIds = (ids: string[]) => { this.externalIds = new Set(ids); };
  isDirty = () => this.generation !== this.saved || this.viewGeneration !== this.viewSaved;
  activate = () => { this.live = true; };
  dispose = () => { this.live = false; this.loadRequest++; clearTimeout(this.timer); };

  load = async () => {
    const request = ++this.loadRequest;
    try {
      const initial = await api<BookWorkspace>(`books/${this.bookId}/workspace`);
      if (!this.live || request !== this.loadRequest) return;
      this.draft = this.committed = initial;
      this.publish({ value: initial, status: "已保存" });
    } catch (error) {
      if (request === this.loadRequest) this.publish({ error: String(error) });
    }
  };

  reload = async (preserveHistory = false) => {
    clearTimeout(this.timer);
    if (this.pending) await this.pending;
    if (this.generation !== this.saved) {
      this.publish({ error: "工作区草稿尚未保存，请先重试或导出草稿，避免覆盖修改" });
      return;
    }
    const request = ++this.reloadRequest;
    const startedGeneration = this.generation;
    const startedView = this.viewGeneration;
    const startedCommitted = this.committed;
    try {
      const initial = await api<BookWorkspace>(`books/${this.bookId}/workspace`);
      if (!this.live || request !== this.reloadRequest) return;
      if (this.generation !== startedGeneration || this.committed !== startedCommitted) {
        clearTimeout(this.timer);
        this.publish({ error: "刷新期间工作区已发生编辑，草稿已保留，请保存或处理冲突后重试刷新" });
        return;
      }
      // A delayed content snapshot must not rewind the independent camera.
      if (this.draft && (this.viewGeneration !== startedView || this.viewGeneration !== this.viewSaved))
        initial.camera = this.draft.camera;
      this.draft = this.committed = initial;
      this.inFlight = undefined;
      if (!preserveHistory) { this.history = []; this.redoHistory = []; }
      this.publish({ value: initial, error: "",
        status: this.viewGeneration === this.viewSaved ? "已保存" : "待保存" });
    } catch (error) {
      if (request === this.reloadRequest) this.publish({ error: String(error) });
    }
  };

  flush = async (): Promise<boolean> => {
    clearTimeout(this.timer);
    if (this.pending) return this.pending;
    if (!this.draft || !this.committed) return true;
    const save = async () => {
      try {
        while (this.saved !== this.generation) {
          if (!this.inFlight) {
            const changes = difference(this.committed!, this.draft!);
            if (!changes.length) { this.saved = this.generation; break; }
            this.inFlight = {
              generation: this.generation,
              batch: { bookId: this.bookId, commandId: crypto.randomUUID(),
                expectedVersion: this.committed!.revision, changes },
            };
          }
          this.publish({ status: "保存中…", error: "" });
          const receipt = await submitWorkspaceCommand(this.inFlight.batch);
          this.committed = { ...apply(this.committed!, receipt.changes), revision: receipt.contentVersion };
          this.saved = this.inFlight.generation;
          this.inFlight = undefined;
        }
        const camera = this.draft?.camera;
        if (this.viewSaved !== this.viewGeneration && camera) {
          const sent = this.viewGeneration;
          await api(`books/${this.bookId}/workspace/camera`, {
            method: "PUT", body: JSON.stringify(camera),
          });
          this.viewSaved = sent;
        }
        this.publish({ status: "已保存" });
        return true;
      } catch (error) {
        this.publish({ error: String(error), status: "保存失败 · 草稿仍保留" });
        return false;
      }
    };
    this.pending = save();
    try { return await this.pending; }
    finally { this.pending = undefined; }
  };

  change = (update: BookWorkspace | ((current: BookWorkspace) => BookWorkspace), remember = true) => {
    const previous = this.draft;
    if (!previous) return;
    let next = typeof update === "function" ? update(previous) : update;
    const previousInternal = new Set([...previous.cards.map((card) => card.id),
      ...previous.objects.map((object) => object.id)]);
    const remaining = new Set([...next.cards.map((card) => card.id),
      ...next.objects.map((object) => object.id), ...this.externalIds,
      ...previous.links.flatMap((link) => [link.from, link.to])
        .filter((id) => !previousInternal.has(id))]);
    const links = next.links.filter((link) => remaining.has(link.from) && remaining.has(link.to));
    if (links.length !== next.links.length) next = { ...next, links };
    const changes = difference(previous, next);
    if (remember && changes.length) {
      this.history = [...this.history.slice(-99), difference(next, previous)];
      this.redoHistory = [];
    }
    this.draft = next;
    if (changes.length) this.generation++;
    if (JSON.stringify(previous.camera) !== JSON.stringify(next.camera)) this.viewGeneration++;
    this.publish({ value: next, status: "待保存" });
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), 500);
  };

  private enqueueHistory(action: () => Promise<void>) {
    const queued = this.historyQueue.then(action);
    this.historyQueue = queued.catch(() => {});
    return queued;
  }
  undo = () => this.enqueueHistory(async () => {
    const inverse = this.history.pop();
    if (!inverse || !this.draft) return;
    if (!Array.isArray(inverse)) {
      if (!(await this.flush())) { this.history.push(inverse); return; }
      try { await inverse.undo(); this.redoHistory.push(inverse); }
      catch (error) { this.history.push(inverse); this.publish({ error: `撤销失败：${String(error)}` }); }
    } else {
      const next = apply(this.draft, inverse);
      this.redoHistory.push(difference(next, this.draft));
      this.change(next, false);
    }
    this.publish();
  });
  redo = () => this.enqueueHistory(async () => {
    const changes = this.redoHistory.pop();
    if (!changes || !this.draft) return;
    if (!Array.isArray(changes)) {
      if (!(await this.flush())) { this.redoHistory.push(changes); return; }
      try { await changes.redo(); this.history.push(changes); }
      catch (error) { this.redoHistory.push(changes); this.publish({ error: `重做失败：${String(error)}` }); }
    } else {
      const next = apply(this.draft, changes);
      this.history.push(difference(next, this.draft));
      this.change(next, false);
    }
    this.publish();
  });
  recordExternal = (action: ExternalHistory) => {
    this.history = [...this.history.slice(-99), action];
    this.redoHistory = [];
    this.publish();
  };
  revision = () => this.committed?.revision;
  acceptExternal = (snapshot: BookWorkspace) => {
    if (!this.draft || !this.committed || this.generation !== this.saved || this.pending)
      throw new Error("工作区仍有待保存的修改，请保存后重试");
    const inverse = difference(snapshot, this.draft);
    if (inverse.length) {
      this.history = [...this.history.slice(-99), inverse];
      this.redoHistory = [];
    }
    this.committed = this.draft = snapshot;
    this.publish({ value: snapshot, status: "已保存", error: "" });
  };
}
