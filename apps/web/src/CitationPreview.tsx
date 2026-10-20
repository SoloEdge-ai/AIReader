import type { ChatTurn, SourceAnchor } from "../../../packages/protocol/src";
import { Icon } from "./ui/Icon";
import { Popover } from "./ui/Popover";

interface CitationSnapshot {
  anchor: SourceAnchor;
  text: string;
}

/** A citation is previewable only against the evidence actually sent this turn. */
export function citationSnapshots(turn: ChatTurn): CitationSnapshot[] {
  const snapshots = new Map<string, CitationSnapshot>();
  for (const anchor of turn.citations) {
    if (
      anchor.bookId !== turn.bookId ||
      !anchor.fingerprint ||
      !Number.isInteger(anchor.page) ||
      anchor.page < 1
    )
      continue;
    const passage = turn.context.evidence.find(
      (candidate) =>
        candidate.id === anchor.passageId &&
        candidate.bookId === turn.bookId &&
        candidate.page === anchor.page &&
        candidate.anchor.bookId === turn.bookId &&
        candidate.anchor.fingerprint === anchor.fingerprint &&
        candidate.anchor.passageId === anchor.passageId &&
        candidate.anchor.page === anchor.page &&
        candidate.anchor.label === anchor.label &&
        candidate.anchor.indexVersion === anchor.indexVersion,
    );
    if (passage?.text.trim())
      snapshots.set(anchor.passageId, { anchor, text: passage.text });
  }
  return [...snapshots.values()];
}

export function CitationPreview({
  source,
  onCitation,
  excerpt = false,
}: {
  source: CitationSnapshot;
  onCitation: (page: number, anchor: SourceAnchor) => void;
  excerpt?: boolean;
}) {
  const { anchor, text } = source;
  return (
    <Popover
      label={`预览第 ${anchor.label} 页原文`}
      dialogLabel="原文预览"
      triggerClass={excerpt ? "evidence" : "citation"}
      className="citation-preview"
      width={420}
      focusOnOpen
      trigger={
        excerpt ? (
          <>
            <span>
              第 {anchor.label} 页<Icon name="outward" />
            </span>
            <span>{text.slice(0, 200)}</span>
          </>
        ) : (
          anchor.label
        )
      }
    >
      {(close) => (
        <>
          <header className="citation-preview-heading">
            <div>
              <strong>第 {anchor.label} 页</strong>
              <span>物理页 {anchor.page}</span>
            </div>
            <button
              aria-label="关闭原文预览"
              title="关闭原文预览"
              onClick={() => close()}
            >
              <Icon name="close" />
            </button>
          </header>
          <blockquote className="citation-preview-text">{text}</blockquote>
          <p className="citation-preview-caption">
            本轮发送给模型的原文快照，未随重新索引改变。
          </p>
          <footer className="citation-preview-actions">
            <button
              onClick={() => {
                close(false);
                onCitation(anchor.page, anchor);
              }}
            >
              <Icon name="outward" />
              前往原文
            </button>
          </footer>
        </>
      )}
    </Popover>
  );
}
