import { useState } from "react";
import { questionStateLabels, type Note, type QuestionMetadata } from "../../../../../packages/protocol/src";
import { Popover } from "../../ui/Popover";

export function QuestionCardControls({ note, notes, onContinue, onUpdate, onOpenNote }: {
  note: Note; notes: Note[];
  onContinue: () => Promise<void>;
  onUpdate: (status: QuestionMetadata["status"], currentConclusionId?: string | null) => Promise<void>;
  onOpenNote: (note: Note) => void;
}) {
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const question = note.question!;
  const current = notes.find((item) => item.id === question.currentConclusionId);
  const parent = notes.find((item) => item.id === question.parentQuestionId);
  const basis = current ?? notes.find((item) => item.id === question.conclusionNoteIds.at(-1));
  const materialCount = basis?.origin?.materials ? new Set(basis.origin.materials.flatMap((material) =>
    material.sections.filter((section) => section.kind !== "relation").map((section) => section.targetId))).size : question.materialCount;
  async function run(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true); setError("");
    try { await action(); } catch (error) { setError(String(error)); } finally { setBusy(false); }
  }
  return <section className="question-card-controls" aria-label="问题探究">
    <div><small>问题 · {questionStateLabels[question.status]}</small>
      <button disabled={busy} onClick={() => void run(onContinue)}>继续探究</button></div>
    <p className="question-card-conclusion">材料 · {materialCount} 项 · {current ? `当前结论：${current.title}` : question.currentConclusionId ? "当前结论已删除" : "尚未选定当前结论"}</p>
    <Popover label="问题状态与结论" trigger={<span>状态与结论 · {question.conclusionNoteIds.length}</span>}>
      {() => <div className="question-card-settings">
        <label>问题状态<select aria-label="问题状态" disabled={busy} value={question.status}
          onChange={(event) => void run(() => onUpdate(event.target.value as QuestionMetadata["status"]))}>
          {Object.entries(questionStateLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
        </select></label>
        {current && <button onClick={() => onOpenNote(current)}>打开当前结论</button>}
        <label>当前结论<select aria-label="当前结论" disabled={busy} value={question.currentConclusionId ?? ""}
          onChange={(event) => void run(() => onUpdate(question.status, event.target.value || null))}>
          <option value="">暂不选定结论</option>
          {question.conclusionNoteIds.map((id, index) => {
            const conclusion = notes.find((item) => item.id === id);
            return <option key={id} value={id} disabled={!conclusion}>{index + 1}. {conclusion?.title ?? "结论已删除"}</option>;
          })}
        </select></label>
        <p>结论各自保留正文与来源；个人总结不会被替换。</p>
        {question.sourceQuestion && <details><summary>起点问题全文</summary><p>{question.sourceQuestion}</p></details>}
        {!question.sessionId && <p>归档未包含原对话，继续时创建新会话。</p>}
        {question.parentQuestionId && <p>从另一问题分支，原问题与结论保持不变。
          {parent ? <button onClick={() => onOpenNote(parent)}>查看父问题</button> : "父问题已删除或不可用。"}</p>}
      </div>}
    </Popover>
    {error && <p role="alert" className="error">{error}</p>}
  </section>;
}
