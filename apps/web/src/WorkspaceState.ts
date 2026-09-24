import { useEffect, useRef, useState } from "react";
import type { BookWorkspace, WorkspaceCommand, WorkspaceCommandBatch } from "../../../packages/protocol/src/workspace";
import { api } from "./api";
import { submitWorkspaceCommand } from "./client/workspace";
import { applyWorkspaceChanges as apply, workspaceDifference as difference } from "../../../packages/workspace-engine/src/commands";

type ExternalHistory = { kind: "external"; undo: () => Promise<void>; redo: () => Promise<void> };
type HistoryEntry = WorkspaceCommand[] | ExternalHistory;

/** Book-local command queue; failures preserve the exact idempotency key and unsaved draft. */
export function useWorkspace(bookId: string, externalEndpointIds: string[] = []) {
  const [value, setValue] = useState<BookWorkspace>();
  const [status, setStatus] = useState("正在加载工作区…");
  const [error, setError] = useState("");
  const draft = useRef<BookWorkspace>(undefined);
  const committed = useRef<BookWorkspace>(undefined);
  const generation = useRef(0), saved = useRef(0);
  const viewGeneration = useRef(0), viewSaved = useRef(0);
  const inFlight = useRef<{ batch: WorkspaceCommandBatch; generation: number } | undefined>(undefined);
  const pending = useRef<Promise<boolean>>(undefined);
  const history = useRef<HistoryEntry[]>([]);
  const redoHistory = useRef<HistoryEntry[]>([]);
  const [, setHistoryVersion] = useState(0);
  const historyChanged = () => setHistoryVersion((value) => value + 1);
  const historyQueue = useRef<Promise<void>>(Promise.resolve());
  const live = useRef(true);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const reloadRequest = useRef(0);
  const externalIds = useRef(new Set(externalEndpointIds));
  externalIds.current = new Set(externalEndpointIds);

  async function reload(preserveHistory = false) {
    clearTimeout(timer.current);
    if (pending.current) await pending.current;
    if (generation.current !== saved.current) {
      setError("工作区草稿尚未保存，请先重试或导出草稿，避免覆盖修改");
      return;
    }
    const request = ++reloadRequest.current;
    const startedGeneration = generation.current;
    const startedView = viewGeneration.current;
    const startedCommitted = committed.current;
    try {
      const initial = await api<BookWorkspace>(`books/${bookId}/workspace`);
      if (!live.current || request !== reloadRequest.current) return;
      if (generation.current !== startedGeneration || committed.current !== startedCommitted) {
        clearTimeout(timer.current);
        setError("刷新期间工作区已发生编辑，草稿已保留，请保存或处理冲突后重试刷新");
        return;
      }
      // View changes are independent of content; a delayed snapshot must not move the reader back.
      if (draft.current && (viewGeneration.current !== startedView || viewGeneration.current !== viewSaved.current))
        initial.camera = draft.current.camera;
      draft.current = initial;
      committed.current = initial;
      inFlight.current = undefined;
      if (!preserveHistory) {
        history.current = [];
        redoHistory.current = [];
      }
      historyChanged();
      setValue(initial);
      setError("");
      setStatus(viewGeneration.current === viewSaved.current ? "已保存" : "待保存");
    } catch (e) {
      if (live.current) setError(String(e));
    }
  }
  useEffect(() => {
    live.current = true;
    void api<BookWorkspace>(`books/${bookId}/workspace`)
      .then((initial) => {
        if (!live.current) return;
        draft.current = committed.current = initial;
        setValue(initial);
        setStatus("已保存");
      })
      .catch((e) => { if (live.current) setError(String(e)); });
    const warn = (e: BeforeUnloadEvent) => {
      if (generation.current !== saved.current || viewGeneration.current !== viewSaved.current) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => {
      live.current = false;
      clearTimeout(timer.current);
      window.removeEventListener("beforeunload", warn);
    };
  }, [bookId]);

  async function flush(): Promise<boolean> {
    clearTimeout(timer.current);
    if (pending.current) return pending.current;
    if (!draft.current || !committed.current) return true;
    const save = async () => {
      try {
        while (saved.current !== generation.current) {
          if (!inFlight.current) {
            const changes = difference(committed.current!, draft.current!);
            if (!changes.length) {
              saved.current = generation.current;
              break;
            }
            inFlight.current = {
              generation: generation.current,
              batch: {
                bookId,
                commandId: crypto.randomUUID(),
                expectedVersion: committed.current!.revision,
                changes,
              },
            };
          }
          if (live.current) { setStatus("保存中…"); setError(""); }
          const receipt = await submitWorkspaceCommand(inFlight.current.batch);
          committed.current = { ...apply(committed.current!, receipt.changes), revision: receipt.contentVersion };
          saved.current = inFlight.current.generation;
          inFlight.current = undefined;
        }
        const camera = draft.current?.camera;
        if (viewSaved.current !== viewGeneration.current && camera) {
          const sent = viewGeneration.current;
          await api(`books/${bookId}/workspace/camera`, { method: "PUT", body: JSON.stringify(camera) });
          viewSaved.current = sent;
        }
        if (live.current) setStatus("已保存");
        return true;
      } catch (e) {
        if (live.current) { setError(String(e)); setStatus("保存失败 · 草稿仍保留"); }
        return false;
      }
    };
    pending.current = save();
    try { return await pending.current; }
    finally { pending.current = undefined; }
  }

  function change(update: BookWorkspace | ((current: BookWorkspace) => BookWorkspace), remember = true) {
    const previous = draft.current;
    if (!previous) return;
    let next = typeof update === "function" ? update(previous) : update;
    const previousInternal = new Set([...previous.cards.map((card) => card.id),
      ...previous.objects.map((object) => object.id)]);
    const remaining = new Set([...next.cards.map((card) => card.id),
      ...next.objects.map((object) => object.id), ...externalIds.current,
      ...previous.links.flatMap((link) => [link.from, link.to])
        .filter((id) => !previousInternal.has(id))]);
    const links = next.links.filter((link) => remaining.has(link.from) && remaining.has(link.to));
    if (links.length !== next.links.length) next = { ...next, links };
    const changes = difference(previous, next);
    if (remember && changes.length) {
      history.current = [...history.current.slice(-99), difference(next, previous)];
      redoHistory.current = [];
      historyChanged();
    }
    draft.current = next;
    if (changes.length) generation.current++;
    if (JSON.stringify(previous.camera) !== JSON.stringify(next.camera)) viewGeneration.current++;
    setValue(next);
    setStatus("待保存");
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), 500);
  }
  function enqueueHistory(action: () => Promise<void>) {
    const queued = historyQueue.current.then(action);
    historyQueue.current = queued.catch(() => {});
    return queued;
  }
  function undo() { return enqueueHistory(async () => {
    const inverse = history.current.pop();
    if (!inverse || !draft.current) return;
    if (!Array.isArray(inverse)) {
      if (!(await flush())) { history.current.push(inverse); return; }
      try { await inverse.undo(); redoHistory.current.push(inverse); }
      catch (cause) { history.current.push(inverse); setError(`撤销失败：${String(cause)}`); }
    } else {
      const next = apply(draft.current, inverse);
      redoHistory.current.push(difference(next, draft.current));
      change(next, false);
    }
    historyChanged();
  }); }
  function redo() { return enqueueHistory(async () => {
    const changes = redoHistory.current.pop();
    if (!changes || !draft.current) return;
    if (!Array.isArray(changes)) {
      if (!(await flush())) { redoHistory.current.push(changes); return; }
      try { await changes.redo(); history.current.push(changes); }
      catch (cause) { redoHistory.current.push(changes); setError(`重做失败：${String(cause)}`); }
    } else {
      const next = apply(draft.current, changes);
      history.current.push(difference(next, draft.current));
      change(next, false);
    }
    historyChanged();
  }); }
  function recordExternal(action: ExternalHistory) {
    history.current = [...history.current.slice(-99), action];
    redoHistory.current = [];
    historyChanged();
  }
  function revision() { return committed.current?.revision; }
  function acceptExternal(snapshot: BookWorkspace) {
    if (!draft.current || !committed.current ||
        generation.current !== saved.current || pending.current)
      throw new Error("工作区仍有待保存的修改，请保存后重试");
    const previous = draft.current;
    const inverse = difference(snapshot, previous);
    if (inverse.length) {
      history.current = [...history.current.slice(-99), inverse];
      redoHistory.current = [];
      historyChanged();
    }
    committed.current = snapshot;
    draft.current = snapshot;
    setValue(snapshot);
    setStatus("已保存");
    setError("");
  }
  return { value, status, error, change, undo, redo, recordExternal, flush, reload, revision, acceptExternal,
    canUndo: history.current.length > 0, canRedo: redoHistory.current.length > 0 };
}
