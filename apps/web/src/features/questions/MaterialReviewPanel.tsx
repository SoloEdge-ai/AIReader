import { useEffect, useRef, useState } from "react";
import type { MaterialReview, MaterialReviewPlan, Note, QuestionMaterialInput, QuestionMaterialSnapshot } from "../../../../../packages/protocol/src";
import { base, post } from "../../api";
import { ResearchWindow } from "./ResearchWindow";

const labels = { added: "新增", updated: "内容更新", unchanged: "未变化", missing: "原对象缺失", removed: "本轮移除" };
function FrozenContent({ snapshots, targetId }: { snapshots: QuestionMaterialSnapshot[]; targetId: string }) {
  return <>{snapshots.flatMap((snapshot) => snapshot.sections.filter((section) => section.targetId === targetId).map((section, index) =>
    <div key={`${snapshot.id}:${index}`}>
      <small>{section.provenance ? section.provenance.edited ? "AI 内容 · 已编辑" : "AI 内容" :
        section.kind === "book-excerpt" ? "原文摘录" : section.kind === "book-region" ? "PDF 区域" : section.kind === "relation" ? "用户声明的关系" : "个人材料"}</small>
      <p>{section.text || "（无正文）"}</p>
      {section.imageIds?.map((id) => <img key={id} alt="冻结材料预览"
        src={`${base}/api/books/${snapshot.bookId}/question-materials/${snapshot.id}/images/${id}?session=${encodeURIComponent(snapshot.sessionId)}`} />)}
    </div>))}</>;
}
export function MaterialReviewPanel({ question, selectedIds, onCapture, onApply, onClose }: {
  question: Note; selectedIds: string[];
  onCapture: (targets: QuestionMaterialInput["targets"], revision: number) => Promise<QuestionMaterialInput["previews"]>;
  onApply: (values: QuestionMaterialSnapshot[], mode: "append" | "replace") => Promise<void>;
  onClose: () => void;
}) {
  const [plan, setPlan] = useState<MaterialReviewPlan>(), [review, setReview] = useState<MaterialReview>();
  const [selected, setSelected] = useState<string[]>([]), [extras, setExtras] = useState<string[]>([]);
  const [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const pending = useRef<{ key: string; input: unknown } | undefined>(undefined);
  const path = `books/${question.bookId}/questions/${question.id}`;
  async function load(additionalIds: string[] = extras) {
    setBusy(true); setError(""); setReview(undefined); pending.current = undefined;
    try {
      const value = await post<MaterialReviewPlan>(`${path}/material-plan`, { additionalIds });
      setPlan(value); setExtras(additionalIds);
      setSelected(value.targets.filter((entry) => entry.available && entry.target.kind !== "relation").map((entry) => entry.target.id));
    } catch (error) { setError(String(error)); } finally { setBusy(false); }
  }
  useEffect(() => { void load([]); }, [question.id, question.bookId]);
  const targets = plan?.targets.filter((entry) => entry.available && (entry.target.kind === "relation"
    ? entry.relation && selected.includes(entry.relation.from) && selected.includes(entry.relation.to) : selected.includes(entry.target.id)))
    .map((entry) => entry.target) ?? [];
  async function generate() {
    if (!plan || busy) return;
    setBusy(true); setError("");
    try {
      const key = JSON.stringify({ plan: [plan.questionRevision, plan.workspaceRevision, plan.baselineTurnId], targets });
      if (pending.current?.key !== key) pending.current = { key, input: {
        requestId: crypto.randomUUID(), questionRevision: plan.questionRevision, baselineTurnId: plan.baselineTurnId,
        workspaceRevision: plan.workspaceRevision, targets, previews: await onCapture(targets, plan.workspaceRevision),
      } };
      setReview(await post<MaterialReview>(`${path}/material-review`, pending.current.input));
    } catch (error) { setError(String(error)); } finally { setBusy(false); }
  }
  async function apply(mode: "append" | "replace", previous = false) {
    if (!plan || busy || !previous && !review) return;
    setBusy(true); setError("");
    try {
      const values = previous ? await post<QuestionMaterialSnapshot[]>(`books/${question.bookId}/question-materials/reuse-turn`, {
        turnId: plan.baselineTurnId, sessionId: plan.sessionId, requestId: crypto.randomUUID(),
      }) : [review!.latest];
      await onApply(values, mode); onClose();
    } catch (error) { setError(String(error)); } finally { setBusy(false); }
  }
  return <ResearchWindow title="材料更新差异清单" onClose={onClose}>
    <h3>{question.title}</h3><p>比较上轮实际使用的材料。内容变化不会改写旧结论，也不会自动发送问题。</p>
    {error && <p className="error" role="alert">{error}</p>}
    {!plan && !error && <p role="status">正在读取材料基线…</p>}
    {plan && <>
      {!plan.baseline.length && <p>本问题没有可恢复的轮次材料基线。归档不包含聊天；可明确纳入当前画布材料开始新一轮。</p>}
      <div className="question-review-actions">
        <button disabled={busy} onClick={() => void load()}>重新读取材料</button>
        <button disabled={busy || !selectedIds.length} onClick={() => void load([...new Set([...extras, ...selectedIds])])}>纳入当前画布选择 · {selectedIds.length}</button>
      </div>
      <div className="material-review-targets">{plan.targets.map((entry) => <label key={entry.target.id}>
        <input type="checkbox" disabled={busy || !entry.available || entry.target.kind === "relation"}
          checked={targets.some((target) => target.id === entry.target.id)} onChange={(event) => {
            setSelected((old) => event.target.checked ? [...old, entry.target.id] : old.filter((id) => id !== entry.target.id));
            setReview(undefined); pending.current = undefined;
          }} />
        <span>{entry.title}<small>{!entry.available ? "原对象缺失，可沿用上轮冻结版本" : entry.target.kind === "relation" ? "随两个端点一起加入" : entry.added ? "明确新增选择" : "上轮材料"}</small></span>
      </label>)}</div>
      <button disabled={busy || !targets.length || targets.length > 20} onClick={() => void generate()}>
        {busy ? "准备中…" : `冻结最新材料并生成差异 · ${targets.length}/20`}</button>
      {targets.length > 20 && <p className="error">请减少选择；关联关系也计入 20 项上限。</p>}
      {review && <section aria-label="冻结材料差异">
        <p>以下“最新版本”已冻结；确认后直接加入这些内容。若原对象又有改动，可重新读取并生成。</p>
        <div className="material-review-counts">{Object.entries(labels).map(([status, label]) => <span key={status}>
          {label} · {review.entries.filter((entry) => entry.status === status).length}</span>)}</div>
        {review.entries.map((entry) => <details key={entry.targetId} data-material-status={entry.status}>
          <summary>{labels[entry.status]} · {entry.title}</summary>
          <div className="material-version-columns"><section><strong>上轮冻结版本</strong>
            {entry.before.length ? <FrozenContent snapshots={review.plan.baseline} targetId={entry.targetId} /> : <p>上轮未使用</p>}</section>
            <section><strong>本轮最新版本</strong>{entry.after.length ? <FrozenContent snapshots={[review.latest]} targetId={entry.targetId} /> : <p>本轮不包含</p>}</section></div>
        </details>)}
        <div className="question-review-actions"><button disabled={busy} onClick={() => void apply("replace")}>替换为这批最新材料</button>
          <button disabled={busy} onClick={() => void apply("append")}>追加这批最新材料</button></div>
      </section>}
      {!!plan.baseline.length && <div className="question-review-actions">
        <button disabled={busy} onClick={() => void apply("replace", true)}>沿用上轮全部冻结材料</button>
        <button disabled={busy} onClick={() => void apply("append", true)}>追加上轮冻结材料</button>
      </div>}
      <p className="muted">替换会移除本轮已有材料、图片与原文选区，问题文字保留；追加保留已有材料并检查总量。确认后仍需在问答浮窗手动发送。</p>
    </>}
    {!plan && error && <button disabled={busy} onClick={() => void load([])}>重试读取材料</button>}
  </ResearchWindow>;
}
