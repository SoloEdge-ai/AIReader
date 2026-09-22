import { useEffect, useState } from "react";
import type {
  Book,
  IndexJob,
  SemanticNode,
} from "../../../packages/protocol/src";
import { api, post } from "./api";
export function IndexPanel({ book, page }: { book: Book; page: number }) {
  const [state, setState] = useState<{
    jobs: IndexJob[];
    nodes: SemanticNode[];
  }>({ jobs: [], nodes: [] });
  const [full, setFull] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    const update = () =>
      void api<typeof state>("books/" + book.id + "/index")
        .then((s) => {
          if (active) setState(s);
        })
        .catch(() => {});
    update();
    const timer = setInterval(update, 2500);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [book.id]);
  const run = (full: boolean) =>
    void post("books/" + book.id + "/index", { page, full }).catch((e) =>
      setError(String(e)),
    );
  return (
    <details className="index-panel">
      <summary>
        语义索引 · {state.nodes.length} / {book.chapters.length} 节
      </summary>
      <p>按需处理当前章节。索引摘要用于导航，回答仍回查原文。</p>
      <button disabled={book.status !== "ready"} onClick={() => run(false)}>
        索引当前章节
      </button>
      <button
        disabled={book.status !== "ready"}
        onClick={() => setFull((v) => !v)}
      >
        全书深度索引
      </button>
      {full && (
        <div className="index-consent">
          <p>会分批将全书可提取的原文发送至当前 Codex 服务，并消耗账户用量。</p>
          <button
            onClick={() => {
              run(true);
              setFull(false);
            }}
          >
            开始完整索引
          </button>
        </div>
      )}
      {state.jobs.slice(-3).map((job) => (
        <div key={job.id}>
          <p>
            {job.full ? "全书" : "章节"} · {job.status} · 已完成{" "}
            {job.completed.length} 节
          </p>
          {job.error && <p className="error">{job.error}</p>}
          {(["queued", "running"].includes(job.status)
            ? ["pause", "cancel"]
            : job.status !== "complete"
              ? ["resume"]
              : []
          ).map((action) => (
            <button
              key={action}
              onClick={() =>
                void post("books/" + book.id + "/index/" + job.id, {
                  action,
                }).catch((e) => setError(String(e)))
              }
            >
              {{ pause: "暂停", cancel: "取消", resume: "继续 / 重试" }[action]}
            </button>
          ))}
        </div>
      ))}
      {error && <p className="error">{error}</p>}
    </details>
  );
}
