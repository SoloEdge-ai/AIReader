import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
import type { ChatTurn, SourceAnchor } from "../../../packages/protocol/src";
import { Icon } from "./Icon";
import { effortLabel } from "./ModelControl";

export function ChatMessage({
  turn,
  onCitation,
}: {
  turn: ChatTurn;
  onCitation: (page: number, anchor: SourceAnchor) => void;
}) {
  const [copyStatus, setCopyStatus] = useState("");
  const sources = [
    ...new Map(turn.citations.map((c) => [c.passageId, c])).values(),
  ];
  const markdown = turn.answer.replace(/\[\[([^\]]+)\]\]/g, (_, id: string) => {
    const anchor = sources.find((c) => c.passageId === id);
    return anchor
      ? `[原文](#source-${encodeURIComponent(id)})`
      : turn.status === "running"
        ? "〔引用校验中〕"
        : "〔未验证引用〕";
  });
  async function copy() {
    try {
      await navigator.clipboard.writeText(
        turn.answer.replace(/\[\[([^\]]+)\]\]/g, (_, id: string) => {
          const anchor = sources.find((c) => c.passageId === id);
          return anchor ? `〔第 ${anchor.label} 页〕` : "〔未验证引用〕";
        }),
      );
      setCopyStatus("已复制");
    } catch {
      setCopyStatus("复制失败，请选中文字后复制。");
    }
  }
  return (
    <article className="turn">
      <div className="question">{turn.question}</div>
      <div className="assistant-label">
        <Icon name="book" />
        <span>AIReader</span>
      </div>
      <div className="answer markdown">
        <ReactMarkdown
          skipHtml
          remarkPlugins={[remarkGfm, remarkMath]}
          rehypePlugins={[[rehypeKatex, { throwOnError: false, trust: false }]]}
          components={{
            img: () => null,
            a: ({ href, children }) => {
              if (href?.startsWith("#source-")) {
                const anchor = sources.find(
                  (c) => "#source-" + encodeURIComponent(c.passageId) === href,
                );
                return anchor ? (
                  <button
                    className="citation"
                    aria-label={`返回第 ${anchor.label} 页原文`}
                    onClick={() => onCitation(anchor.page, anchor)}
                  >
                    {anchor.label}
                  </button>
                ) : (
                  <span>{children}</span>
                );
              }
              return (
                <a href={href} target="_blank" rel="noopener noreferrer">
                  {children}
                </a>
              );
            },
          }}
        >
          {markdown ||
            (turn.status === "running"
              ? "正在查找相关原文…"
              : "尚无回答内容。")}
        </ReactMarkdown>
      </div>
      {turn.status === "running" && (
        <p className="turn-status" role="status">
          正在回答…
        </p>
      )}
      {turn.status === "cancelled" && <p className="turn-status">已停止回答</p>}
      {turn.error && turn.status !== "cancelled" && (
        <p className="error" role="alert">
          {turn.error}
        </p>
      )}
      {!!sources.length && (
        <details className="answer-sources">
          <summary>
            <Icon name="book" />
            {sources.length} 处原文
            <Icon name="chevron" />
          </summary>
          <div className="source-excerpts">
            {sources.map((source) => (
              <button
                className="evidence"
                key={source.passageId}
                onClick={() => onCitation(source.page, source)}
              >
                <span>
                  第 {source.label} 页<Icon name="outward" />
                </span>
                <span>
                  {turn.context.evidence
                    .find((p) => p.id === source.passageId)
                    ?.text.slice(0, 200) ?? "返回原文查看"}
                </span>
              </button>
            ))}
          </div>
        </details>
      )}
      <div className="answer-actions">
        <button
          aria-label="复制回答"
          title="复制回答"
          disabled={!turn.answer || turn.status === "running"}
          onClick={() => void copy()}
        >
          <Icon name={copyStatus === "已复制" ? "check" : "copy"} />
        </button>
        <details className="answer-details">
          <summary>
            回答详情
            <Icon name="down" />
          </summary>
          <div className="answer-metadata">
            <p>
              {turn.model ?? "模型未记录"} ·{" "}
              {turn.effort ? effortLabel(turn.effort) : "强度未记录"}
            </p>
            <p>
              本轮阅读位置：第 {turn.context.reading.page} 页 · 约{" "}
              {turn.context.estimatedTokens.toLocaleString()} tokens
            </p>
            <p>{turn.context.coverage}</p>
            <details>
              <summary>本轮上下文</summary>
              <p>
                问题范围：
                {
                  {
                    auto: "当前阅读位置",
                    selection: "选中原文",
                    chapter: "当前章节",
                    book: "整本书",
                  }[turn.context.reading.scope]
                }
              </p>
              {turn.context.reading.selection && (
                <p>选区：{turn.context.reading.selection}</p>
              )}
              {turn.context.memory && <p>记忆：{turn.context.memory}</p>}
              {turn.context.recent && <p>近期对话：{turn.context.recent}</p>}
              {turn.context.evidence.map((p) => (
                <button
                  className="evidence"
                  key={p.id}
                  onClick={() => onCitation(p.page, p.anchor)}
                >
                  第 {p.anchor.label} 页 · {p.text}
                </button>
              ))}
            </details>
            {turn.usage !== undefined && (
              <p>运行时用量：{JSON.stringify(turn.usage)}</p>
            )}
          </div>
        </details>
      </div>
      {copyStatus && (
        <p className="copy-status" role="status">
          {copyStatus}
        </p>
      )}
    </article>
  );
}
