import { strToU8, zipSync } from "fflate";
import type {
  Annotation,
  Book,
  Note,
  RichNode,
} from "../../../packages/protocol/src";

function escapeText(value: string) {
  return value.replace(/([\\`*_{}\[\]<>#!|])/g, "\\$1");
}
function inline(node: RichNode): string {
  if (node.type === "hardBreak") return "  \n";
  let value = escapeText(node.text ?? "");
  for (const mark of node.marks ?? []) {
    if (mark.type === "code") {
      const longest = Math.max(
        0,
        ...((node.text ?? "").match(/`+/g) ?? []).map((run) => run.length),
      );
      const fence = "`".repeat(longest + 1);
      value = `${fence} ${node.text ?? ""} ${fence}`;
    } else if (mark.type === "bold") value = `**${value}**`;
    else if (mark.type === "italic") value = `*${value}*`;
    else if (mark.type === "strike") value = `~~${value}~~`;
    else if (mark.type === "link") {
      // Notes are validated again on export; encoded destinations cannot close a link.
      const href = String(mark.attrs?.href ?? "").replace(/[\s<>\\]/g, (c) =>
        encodeURIComponent(c),
      );
      value = `[${value}](<${href}>)`;
    }
  }
  return value;
}
function block(node: RichNode): string {
  const content = node.content ?? [];
  switch (node.type) {
    case "doc":
      return content.map(block).join("\n\n");
    case "heading":
      return `${"#".repeat(Number(node.attrs?.level ?? 2))} ${content.map(inline).join("")}`;
    case "paragraph":
      return content.map(inline).join("");
    case "horizontalRule":
      return "---";
    case "blockquote":
      return content
        .map(block)
        .join("\n\n")
        .split("\n")
        .map((line) => `> ${line}`)
        .join("\n");
    case "bulletList":
    case "orderedList":
      return content
        .map((item, index) => {
          const marker =
            node.type === "bulletList"
              ? "- "
              : `${Number(node.attrs?.start ?? 1) + index}. `;
          return block(item)
            .split("\n")
            .map(
              (line, row) =>
                `${row ? " ".repeat(marker.length) : marker}${line}`,
            )
            .join("\n");
        })
        .join("\n");
    case "listItem":
      return content.map(block).join("\n\n");
    case "codeBlock": {
      const code = content.map((n) => n.text ?? "").join("");
      const fence = "`".repeat(
        Math.max(3, ...(code.match(/`+/g) ?? []).map((run) => run.length + 1)),
      );
      return `${fence}${node.attrs?.language ?? ""}\n${code}\n${fence}`;
    }
    default:
      return "";
  }
}

export function exportNoteArchive(
  book: Book,
  note: Note,
  assets: { name: string; bytes: Uint8Array }[],
  annotation?: Annotation,
) {
  const lines = [
    `# ${escapeText(note.title)}`,
    `书籍：${escapeText(book.title)}`,
    `文档指纹：\`${book.fingerprint}\``,
    `保存时间：${escapeText(note.updatedAt)}`,
  ];
  if (note.origin) {
    lines.push(
      "> 此笔记由 AI 回答创建，正文可能已由用户编辑；AI 解释和个人补充不是书中原文。下方“书中原文”保留保存时的已核验引用快照。",
      `原问题：${escapeText(note.origin.question)}`,
      `原回答时间：${escapeText(note.origin.createdAt)}；模型：${escapeText(note.origin.model ?? "未记录")}；思考强度：${escapeText(note.origin.effort ?? "未记录")}`,
    );
  }
  lines.push("## 笔记正文", block(note.document));
  if (note.origin) {
    lines.push("## 书中原文");
    if (!note.origin.sources.length)
      lines.push(
        "此回答没有已核验的书中原文引用；正文仅为 AI 解释或个人补充。",
      );
    note.origin.sources.forEach((source, index) =>
      lines.push(
        `### 来源 ${index + 1} · 第 ${escapeText(source.anchor.label)} 页`,
        `物理页：${source.anchor.page}；文档指纹：\`${source.anchor.fingerprint}\`；PDF 坐标：\`${JSON.stringify(source.anchor.rects)}\``,
        escapeText(source.text)
          .split("\n")
          .map((line) => `> ${line}`)
          .join("\n"),
      ),
    );
  }
  if (annotation) {
    lines.push(
      "## 关联批注",
      `物理页：${annotation.anchors.map((a) => a.page).join("、")}；文档指纹：\`${annotation.fingerprint}\``,
    );
    if (annotation.quote)
      lines.push(
        escapeText(annotation.quote)
          .split("\n")
          .map((line) => `> ${line}`)
          .join("\n"),
      );
    lines.push(`PDF 坐标：\`${JSON.stringify(annotation.anchors)}\``);
  }
  if (assets.length) {
    lines.push(
      "## 关联图片",
      note.origin
        ? "以下为原问题附图，不自动视为已核验的书中原文。"
        : "以下为关联的页内区域摘录。",
    );
    assets.forEach((asset, index) => {
      lines.push(`![关联图片 ${index + 1}](${asset.name})`);
      const source = note.origin?.images?.[index]?.source;
      if (source)
        lines.push(
          `图表框选位置：第 ${escapeText(source.label)} 页（物理页 ${source.page}）；文档指纹：\`${source.fingerprint}\`；PDF 坐标：\`${JSON.stringify(source.rect)}\`。位置说明不证明图像内容来自原始 PDF；图片不是已核验的文本引用。`,
        );
    });
  }
  const files: Record<string, Uint8Array> = {
    "note.md": strToU8(lines.join("\n\n") + "\n"),
  };
  for (const asset of assets) files[asset.name] = asset.bytes;
  // PNGs are already compressed. Store them without doing costly synchronous deflation.
  return Buffer.from(zipSync(files, { level: 0 }));
}
