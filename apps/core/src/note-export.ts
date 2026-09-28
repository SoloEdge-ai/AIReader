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
  if (node.type === "inlineMath") return `$${String(node.attrs?.latex ?? "")}$`;
  if (node.type === "sourceReference")
    return `[^source-${String(node.attrs?.referenceId ?? "")}]`;
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
function tableCell(node: RichNode): string {
  const value = (node.content ?? [])
    .map(block)
    .join("\n\n")
    .replace(/\r?\n/g, "<br>")
    .replace(/(?<!\\)\|/g, "\\|");
  return value || " ";
}
function plainContent(node: RichNode): string {
  if (node.type === "hardBreak") return "\n";
  if (node.type === "inlineMath") return `$${String(node.attrs?.latex ?? "")}$`;
  if (node.type === "blockMath") return `$$${String(node.attrs?.latex ?? "")}$$`;
  if (node.type === "sourceReference")
    return `〔来源 ${String(node.attrs?.referenceId ?? "")}〕`;
  const separator = ["paragraph", "heading", "listItem", "codeBlock"].includes(node.type) ? "\n" : "";
  return (node.text ?? "") + (node.content ?? []).map(plainContent).join("") + separator;
}
function htmlEscape(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
function htmlTable(rows: RichNode[]): string {
  return ["<table>", ...rows.map((row) => `  <tr>${(row.content ?? []).map((cell) => {
    const tag = cell.type === "tableHeader" ? "th" : "td";
    const colspan = Number(cell.attrs?.colspan ?? 1);
    const rowspan = Number(cell.attrs?.rowspan ?? 1);
    const align = String(cell.attrs?.align ?? "");
    const attributes = [colspan > 1 ? ` colspan="${colspan}"` : "",
      rowspan > 1 ? ` rowspan="${rowspan}"` : "",
      align ? ` align="${htmlEscape(align)}"` : ""].join("");
    const content = htmlEscape((cell.content ?? []).map(plainContent).join("\n").trim())
      .replace(/\r?\n/g, "<br>");
    return `<${tag}${attributes}>${content}</${tag}>`;
  }).join("")}</tr>`), "</table>"].join("\n");
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
    case "blockMath":
      return `$$\n${String(node.attrs?.latex ?? "")}\n$$`;
    case "table": {
      const rowNodes = content.filter((row) => row.type === "tableRow");
      const first = rowNodes[0]?.content ?? [];
      const simpleHeader = first.length > 0 && first.every((cell) => cell.type === "tableHeader") &&
        rowNodes.slice(1).every((row) => (row.content ?? []).every((cell) => cell.type === "tableCell"));
      const simpleCells = rowNodes.every((row) => (row.content ?? []).every((cell) =>
        Number(cell.attrs?.colspan ?? 1) === 1 && Number(cell.attrs?.rowspan ?? 1) === 1));
      const columnAlign = first.map((cell) => cell.attrs?.align ?? null);
      const stableAlign = rowNodes.every((row) => (row.content ?? []).every((cell, index) =>
        (cell.attrs?.align ?? null) === (columnAlign[index] ?? null)));
      if (!simpleHeader || !simpleCells || !stableAlign) return htmlTable(rowNodes);
      const rows = rowNodes.map((row) => (row.content ?? []).map(tableCell));
      const columns = Math.max(0, ...rows.map((row) => row.length));
      if (!rows.length || !columns) return "";
      const line = (row: string[]) =>
        `| ${Array.from({ length: columns }, (_, index) => row[index] ?? " ").join(" | ")} |`;
      const separator = Array.from({ length: columns }, (_, index) => {
        const align = columnAlign[index];
        if (align === "left") return ":---";
        if (align === "center") return ":---:";
        if (align === "right") return "---:";
        return "---";
      });
      return [
        line(rows[0]),
        line(separator),
        ...rows.slice(1).map(line),
      ].join("\n");
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
  if (note.sourceReferences.length) {
    lines.push("## 关联来源");
    for (const reference of note.sourceReferences) {
      const pages = reference.source?.anchors.map((anchor) => anchor.page) ??
        (reference.region ? [reference.region.page] : []);
      const location = pages.length ? `；物理页：${pages.join("、")}` : "；工作台材料";
      const provenance = reference.source
        ? `；文档指纹：\`${reference.source.fingerprint}\``
        : reference.region ? `；文档指纹：\`${reference.region.fingerprint}\`` : "";
      const details = escapeText(reference.text).split("\n")
        .map((line) => `    ${line}`).join("\n");
      lines.push(
        `[^source-${reference.id}]: ${escapeText(reference.title)}（${reference.kind === "annotation" ? "原文标记" : "材料卡片"}${location}${provenance}）`,
        details || "    （无文字快照）",
      );
      if (reference.region)
        lines.push(`    ![${escapeText(reference.title)}](assets/source-${reference.id}.png)`);
    }
  }
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
    if (note.origin.materials?.length) {
      lines.push("## 本轮选定材料", "以下内容在加入提问时冻结。个人笔记、标注、绘画与关系并非作者原文；图片内容不构成已核验的文本引用。");
      for (const material of note.origin.materials) {
        lines.push(`### ${escapeText(material.title)}`);
        for (const section of material.sections)
          lines.push(`- ${escapeText(section.title)}（${section.kind}）：${escapeText(section.text)}`);
        for (const image of material.images)
          lines.push(`- 图片预览：${image.includesPdfBackground ? `包含 PDF 物理页 ${image.page} 的背景` : "仅所选个人对象"}；${image.userRendered ? "由用户选择的视觉预览，像素未被 Core 核验为原始 PDF" : "已保存的区域截图"}。`);
      }
    }
  }
  if (annotation) {
    if (annotation.deletedAt) lines.push("> 源标注已删除；以下为保留的原文位置与摘录，不表示标注仍存在。");
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
  if (note.sourceCard) {
    const source = note.sourceCard;
    lines.push("## 关联摘录", "以下是建立评论时冻结的来源；笔记正文是个人内容，不是书中原文。");
    if (source.source) {
      lines.push(`物理页：${source.source.anchors.map((anchor) => anchor.page).join("、")}；文档指纹：\`${source.source.fingerprint}\``,
        `PDF 坐标：\`${JSON.stringify(source.source.anchors)}\``);
      if (source.text) lines.push(escapeText(source.text));
    }
    if (source.region) {
      lines.push(`物理页：${source.region.page}；文档指纹：\`${source.region.fingerprint}\`；PDF 坐标：\`${JSON.stringify(source.region.rect)}\``);
      lines.push(`![摘录图片](assets/excerpt-region.png)`);
      if (source.region.includePersonalMarks) lines.push("图片含个人标注，不代表未经修改的 PDF 原图。");
    }
  }
  if (assets.length) {
    lines.push(
      "## 关联图片",
      note.origin
        ? "以下为原问题附图及本轮选定材料图片，不自动视为已核验的书中原文。"
        : "以下为关联的页内区域摘录。",
    );
    assets.filter((asset) => asset.name !== "assets/excerpt-region.png" &&
      !asset.name.startsWith("assets/source-")).forEach((asset, index) => {
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
