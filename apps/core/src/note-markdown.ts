import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import type { Note, RichNode } from "../../../packages/protocol/src";

interface MarkdownNode {
  type: string;
  value?: string;
  children?: MarkdownNode[];
  url?: string;
  alt?: string | null;
  identifier?: string;
  depth?: number;
  ordered?: boolean | null;
  checked?: boolean | null;
  start?: number | null;
  lang?: string | null;
  position?: { start: { offset?: number }; end: { offset?: number } };
}

const parser = unified().use(remarkParse).use(remarkGfm).use(remarkMath);
const text = (value: string): RichNode[] =>
  value ? [{ type: "text", text: value }] : [];
const paragraph = (value: string): RichNode => ({
  type: "paragraph",
  content: text(value),
});
function safeLink(href: string) {
  try {
    return ["http:", "https:", "mailto:"].includes(new URL(href).protocol);
  } catch {
    return false;
  }
}

/** Converts without rendering HTML or retrieving remote images. Unsupported rich
 * constructs retain their Markdown source as editable text/code blocks. */
export function answerDocument(
  answer: string,
  sources: NonNullable<Note["origin"]>["sources"],
): RichNode {
  const source = answer.replace(/\[\[([^\]]+)\]\]/g, (_whole, id: string) => {
    const index = sources.findIndex((s) => s.anchor.passageId === id);
    return index < 0
      ? "〔未验证引用〕"
      : `〔来源 ${index + 1} · 第 ${sources[index].anchor.label} 页〕`;
  });
  const root: MarkdownNode = parser.parse(source);
  const definitions = new Map(
    (root.children ?? [])
      .filter((n) => n.type === "definition")
      .map((n) => [n.identifier, n.url ?? ""]),
  );
  const raw = (node: MarkdownNode) =>
    source.slice(
      node.position?.start.offset ?? 0,
      node.position?.end.offset ?? 0,
    );
  function inline(node: MarkdownNode): RichNode[] {
    const children = () => (node.children ?? []).flatMap(inline);
    const marked = (type: string, attrs?: Record<string, unknown>) =>
      children().map((n) =>
        n.type === "text"
          ? {
              ...n,
              marks: [
                ...(n.marks ?? []),
                { type, ...(attrs ? { attrs } : {}) },
              ],
            }
          : n,
      );
    switch (node.type) {
      case "text":
      case "html":
        return text(node.value ?? "");
      case "break":
        return [{ type: "hardBreak" }];
      case "strong":
        return marked("bold");
      case "emphasis":
        return marked("italic");
      case "delete":
        return marked("strike");
      case "inlineCode":
        return text(node.value ?? "").map((n) => ({
          ...n,
          marks: [{ type: "code" }],
        }));
      case "inlineMath":
        return text(`$${node.value ?? ""}$`).map((n) => ({
          ...n,
          marks: [{ type: "code" }],
        }));
      case "link":
      case "linkReference": {
        const url = node.url ?? definitions.get(node.identifier) ?? "";
        return safeLink(url)
          ? marked("link", { href: url })
          : [...children(), ...text(url ? ` (${url})` : "")];
      }
      case "image":
      case "imageReference": {
        const url = node.url ?? definitions.get(node.identifier) ?? "";
        return text(`[图片：${node.alt ?? ""}]${url ? ` (${url})` : ""}`);
      }
      default:
        return text(raw(node));
    }
  }
  function block(node: MarkdownNode): RichNode[] {
    const children = () => (node.children ?? []).flatMap(block);
    switch (node.type) {
      case "definition":
        return [];
      case "paragraph":
        return [
          { type: "paragraph", content: (node.children ?? []).flatMap(inline) },
        ];
      case "heading":
        return [
          {
            type: "heading",
            attrs: { level: Math.min(node.depth ?? 2, 3) },
            content: (node.children ?? []).flatMap(inline),
          },
        ];
      case "blockquote":
        return [
          {
            type: "blockquote",
            content: children().length ? children() : [paragraph("")],
          },
        ];
      case "list":
        return [
          {
            type: node.ordered ? "orderedList" : "bulletList",
            ...(node.ordered
              ? {
                  attrs: {
                    start: Math.min(Math.max(node.start ?? 1, 1), 100000),
                  },
                }
              : {}),
            content: children(),
          },
        ];
      case "listItem": {
        const content = children();
        if (content[0]?.type !== "paragraph") content.unshift(paragraph(""));
        if (node.checked !== null && node.checked !== undefined)
          content[0].content = [
            ...text(node.checked ? "[x] " : "[ ] "),
            ...(content[0].content ?? []),
          ];
        return [{ type: "listItem", content }];
      }
      case "code":
        return [
          {
            type: "codeBlock",
            attrs: {
              language:
                node.lang && /^[\w+-]{1,40}$/.test(node.lang)
                  ? node.lang
                  : null,
            },
            content: text(node.value ?? ""),
          },
        ];
      case "thematicBreak":
        return [{ type: "horizontalRule" }];
      case "table":
      case "math":
        return [
          {
            type: "codeBlock",
            attrs: { language: null },
            content: text(raw(node)),
          },
        ];
      default:
        return [paragraph(raw(node) || node.value || "")];
    }
  }
  const content = (root.children ?? []).flatMap(block);
  return { type: "doc", content: content.length ? content : [paragraph("")] };
}
