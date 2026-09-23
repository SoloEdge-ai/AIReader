import { useEffect, useRef, useState } from "react";
import type { BookWorkspace } from "../../../packages/protocol/src/workspace";
import { api, post } from "./api";

/** One writer queue per mounted book. Failed drafts stay in memory until explicitly retried. */
export function useWorkspace(bookId: string) {
  const [value, setValue] = useState<BookWorkspace>();
  const [status, setStatus] = useState("正在加载工作区…");
  const [error, setError] = useState("");
  const draft = useRef<BookWorkspace>(undefined);
  const revision = useRef(0),
    generation = useRef(0),
    saved = useRef(0);
  const pending = useRef<Promise<boolean>>(undefined);
  const history = useRef<BookWorkspace[]>([]);
  const live = useRef(true);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  async function reload() {
    clearTimeout(timer.current);
    if (pending.current) await pending.current;
    try {
      const initial = await api<BookWorkspace>(`books/${bookId}/workspace`);
      if (!live.current) return;
      draft.current = initial;
      revision.current = initial.revision;
      generation.current = saved.current = 0;
      history.current = [];
      setValue(initial);
      setError("");
      setStatus("已保存");
    } catch (e) {
      if (live.current) setError(String(e));
    }
  }
  useEffect(() => {
    live.current = true;
    void api<BookWorkspace>(`books/${bookId}/workspace`)
      .then((initial) => {
        if (!live.current) return;
        draft.current = initial;
        revision.current = initial.revision;
        setValue(initial);
        setStatus("已保存");
      })
      .catch((e) => {
        if (live.current) setError(String(e));
      });
    const warn = (e: BeforeUnloadEvent) => {
      if (generation.current !== saved.current) {
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
    if (!draft.current) return true;
    const save = async () => {
      try {
        while (saved.current !== generation.current) {
          const sent = generation.current;
          const payload = {
            ...structuredClone(draft.current!),
            revision: revision.current,
          };
          if (live.current) {
            setStatus("保存中…");
            setError("");
          }
          const response = await post<BookWorkspace>(
            `books/${bookId}/workspace`,
            payload,
          );
          revision.current = response.revision;
          saved.current = sent;
        }
        if (live.current) setStatus("已保存");
        return true;
      } catch (e) {
        if (live.current) {
          setError(String(e));
          setStatus("保存失败 · 草稿仍保留");
        }
        return false;
      }
    };
    pending.current = save();
    try {
      return await pending.current;
    } finally {
      pending.current = undefined;
    }
  }
  function change(next: BookWorkspace, remember = true) {
    if (!draft.current) return;
    if (remember)
      history.current = [
        ...history.current.slice(-39),
        structuredClone(draft.current),
      ];
    draft.current = next;
    generation.current++;
    setValue(next);
    setStatus("待保存");
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), 500);
  }
  function undo() {
    const previous = history.current.pop();
    if (previous) change({ ...previous, camera: draft.current?.camera }, false);
  }
  return {
    value,
    status,
    error,
    change,
    undo,
    flush,
    reload,
    canUndo: history.current.length > 0,
  };
}
