import { Icon } from "./Icon";

/** Provenance stays visible even when metadata is reduced to icons. */
export function MaterialKind({ kind, label }: {
  kind: "source" | "personal" | "ai";
  label?: string;
}) {
  const title = label ?? { source: "原文摘录", personal: "个人笔记", ai: "AI 整理" }[kind];
  return <span className="ui-material-kind" role="img" aria-label={title} title={title}>
    {kind === "ai" ? "AI" : <Icon name={kind === "source" ? "book" : "note"} />}
  </span>;
}
