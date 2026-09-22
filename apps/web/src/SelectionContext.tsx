import { useState } from "react";
import type { ReadingSelection } from "../../../packages/protocol/src";
import { Icon } from "./Icon";

function pages(selection: ReadingSelection) {
  return [...new Set(selection.anchors.map((anchor) => anchor.page))].join(
    "、",
  );
}

export function SelectionContext({
  attached,
  candidate,
  disabled,
  onAttach,
  onRemove,
  onPick,
}: {
  attached?: ReadingSelection;
  candidate?: ReadingSelection;
  disabled: boolean;
  onAttach: (selection: ReadingSelection) => void;
  onRemove: () => void;
  onPick: () => void;
}) {
  const [picking, setPicking] = useState(false);
  return (
    <>
      {attached && (
        <section className="question-attachment" aria-label="本轮引用">
          <div className="attachment-heading">
            <span>
              <Icon name="book" />
              本轮引用 · 第 {pages(attached)} 页
            </span>
            <button
              aria-label="移除引用"
              title="移除引用"
              disabled={disabled}
              onClick={() => {
                setPicking(false);
                onRemove();
              }}
            >
              <Icon name="close" />
            </button>
          </div>
          <p className="attachment-preview">{attached.text}</p>
          <div className="attachment-actions">
            <details>
              <summary>查看全文 · {attached.text.length} 字</summary>
              <p>{attached.text}</p>
            </details>
            <button
              aria-label="重新选择引用"
              disabled={disabled}
              onClick={() => {
                setPicking(true);
                onPick();
              }}
            >
              重新选择
            </button>
          </div>
        </section>
      )}
      {picking && (
        <p className="selection-hint" role="status">
          请在正文选取文字，再点击{attached ? "“替换引用”" : "“添加到问题”"}。
          <button onClick={() => setPicking(false)}>取消重选</button>
        </p>
      )}
      {candidate && (
        <section className="selection-candidate" aria-label="正文临时选区">
          <div>
            <span>正文选区 · 尚未添加 · 第 {pages(candidate)} 页</span>
            <p>{candidate.text.slice(0, 100)}</p>
          </div>
          <button
            disabled={disabled}
            onClick={() => {
              setPicking(false);
              onAttach(candidate);
            }}
          >
            {attached ? "替换引用" : "添加到问题"}
          </button>
        </section>
      )}
    </>
  );
}
