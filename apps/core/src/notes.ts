import { randomUUID } from "node:crypto";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import {
  AnnotationInputSchema,
  type Annotation,
  type Note,
  type RichNode,
  type ChatTurn,
} from "../../../packages/protocol/src";
import { Library } from "./library";
import { answerDocument } from "./note-markdown";
import { exportNoteArchive } from "./note-export";
import { ChatImages } from "./chat-images";
import { changeNotePlacement } from "./note-placements";
import { NoteTransactions } from "./note-transactions";
import type { BookWorkspace } from "../../../packages/protocol/src/workspace";
import { Workspaces } from "./workspace";
import type { WorkspaceAssets } from "./workspace-assets";
export function richDocument(input: unknown): RichNode {
  if (JSON.stringify(input)?.length > 100000) throw new Error("笔记内容过长");
  let count = 0;
  function parse(value: any, depth: number): RichNode {
    if (!value || typeof value !== "object" || depth > 20 || ++count > 10000)
      throw new Error("无效的笔记结构");
    if (
      ![
        "doc",
        "paragraph",
        "text",
        "hardBreak",
        "heading",
        "bulletList",
        "orderedList",
        "listItem",
        "blockquote",
        "codeBlock",
        "horizontalRule",
        "table",
        "tableRow",
        "tableHeader",
        "tableCell",
        "inlineMath",
        "blockMath",
        "sourceReference",
      ].includes(value.type)
    )
      throw new Error("不支持的笔记内容");
    const result: RichNode = { type: value.type };
    if (value.type === "text") {
      result.text = z.string().max(100000).parse(value.text);
      if (value.marks) {
        result.marks = z
          .array(
            z.object({
              type: z.enum([
                "bold",
                "italic",
                "strike",
                "underline",
                "code",
                "link",
              ]),
              attrs: z.record(z.string(), z.unknown()).optional(),
            }),
          )
          .max(8)
          .parse(value.marks)
          .map((mark) => {
            if (mark.type !== "link") return { type: mark.type };
            const href = z.string().max(3000).parse(mark.attrs?.href);
            const url = new URL(href);
            if (!["https:", "http:", "mailto:"].includes(url.protocol))
              throw new Error("不安全的笔记链接");
            return {
              type: "link",
              attrs: { href, target: "_blank", rel: "noopener noreferrer" },
            };
          });
      }
    }
    if (value.type === "heading")
      result.attrs = {
        level: z
          .number()
          .int()
          .min(1)
          .max(3)
          .parse(value.attrs?.level ?? 2),
      };
    if (value.type === "orderedList")
      result.attrs = {
        start: z
          .number()
          .int()
          .min(1)
          .max(100000)
          .parse(value.attrs?.start ?? 1),
      };
    if (value.type === "codeBlock")
      result.attrs = {
        language: value.attrs?.language
          ? z
              .string()
              .max(40)
              .regex(/^[\w+-]+$/)
              .parse(value.attrs.language)
          : null,
      };
    if (value.type === "inlineMath" || value.type === "blockMath")
      result.attrs = {
        latex: z.string().min(1).max(20000).parse(value.attrs?.latex),
      };
    if (value.type === "sourceReference")
      result.attrs = {
        referenceId: z.string().min(1).max(100).regex(/^[a-zA-Z0-9_-]+$/)
          .parse(value.attrs?.referenceId),
      };
    if (value.type === "tableCell" || value.type === "tableHeader") {
      const colspan = z.number().int().min(1).max(50).parse(value.attrs?.colspan ?? 1);
      const colwidth = z
        .array(z.number().int().min(1).max(10000))
        .max(50)
        .nullable()
        .parse(value.attrs?.colwidth ?? null);
      if (colwidth && colwidth.length !== colspan)
        throw new Error("表格列宽与合并列不匹配");
      result.attrs = {
        colspan,
        rowspan: z.number().int().min(1).max(100).parse(value.attrs?.rowspan ?? 1),
        colwidth,
        align: z.enum(["left", "center", "right", "justify"]).nullable()
          .parse(value.attrs?.align ?? null),
      };
    }
    if (value.content !== undefined) {
      if (
        !Array.isArray(value.content) ||
        ["text", "hardBreak", "horizontalRule", "inlineMath", "blockMath", "sourceReference"]
          .includes(value.type)
      )
        throw new Error("无效的笔记层级");
      result.content = value.content.map((v: unknown) => parse(v, depth + 1));
    }
    const children = result.content ?? [];
    const blocks = [
      "paragraph",
      "heading",
      "bulletList",
      "orderedList",
      "blockquote",
      "codeBlock",
      "horizontalRule",
      "table",
      "blockMath",
    ];
    const cellBlocks = blocks.filter((type) => type !== "table");
    const allowed: Record<string, string[]> = {
      doc: blocks,
      blockquote: blocks,
      listItem: blocks,
      paragraph: ["text", "hardBreak", "inlineMath", "sourceReference"],
      heading: ["text", "hardBreak", "inlineMath", "sourceReference"],
      codeBlock: ["text"],
      bulletList: ["listItem"],
      orderedList: ["listItem"],
      table: ["tableRow"],
      tableRow: ["tableHeader", "tableCell"],
      tableHeader: cellBlocks,
      tableCell: cellBlocks,
    };
    if (children.some((child) => !allowed[value.type]?.includes(child.type)))
      throw new Error("无效的笔记层级");
    if (
      [
        "doc",
        "blockquote",
        "listItem",
        "bulletList",
        "orderedList",
        "table",
        "tableRow",
        "tableHeader",
        "tableCell",
      ].includes(value.type) &&
      !children.length
    )
      throw new Error("笔记结构缺少内容");
    if (value.type === "listItem" && children[0]?.type !== "paragraph")
      throw new Error("列表项必须以段落开始");
    if (value.type === "table" && children.length > 100)
      throw new Error("表格行数过多");
    if (value.type === "tableRow" && children.length > 50)
      throw new Error("表格列数过多");
    return result;
  }
  const result = parse(input, 0);
  if (result.type !== "doc") throw new Error("笔记必须包含文档根节点");
  return result;
}

export function noteDocument(input: unknown, sourceReferences: Note["sourceReferences"]): RichNode {
  const document = richDocument(input);
  const validReferences = new Set(sourceReferences.map((reference) => reference.id));
  const pending = [document];
  while (pending.length) {
    const node = pending.pop()!;
    if (node.type === "sourceReference" &&
        !validReferences.has(String(node.attrs?.referenceId ?? "")))
      throw new Error("笔记正文引用了不存在的来源");
    pending.push(...(node.content ?? []));
  }
  return document;
}

export class Notes {
  private readonly changes: NoteTransactions;
  constructor(readonly library: Library, private readonly workspaceAssets: WorkspaceAssets) {
    this.changes = new NoteTransactions(library.store, (event) => library.emit(event));
  }
  annotations(bookId: string) {
    this.library.book(bookId);
    return this.library.store
      .list<Annotation>("annotation", bookId)
      .filter((a) => !a.deletedAt);
  }
  list(bookId: string) {
    this.library.book(bookId);
    return this.library.store
      .list<Note>("note", bookId)
      .filter((n) => !n.deletedAt)
      .map((n) => ({ ...n, annotationSource: n.annotationId
        ? this.get<Annotation>("annotation", bookId, n.annotationId) : undefined }));
  }
  private get<T extends { bookId: string }>(
    kind: string,
    bookId: string,
    id: string,
  ): T {
    this.library.book(bookId);
    const value = this.library.store.get<T>(kind, id);
    if (!value || value.bookId !== bookId)
      throw new Error("记录不存在或不属于此书籍");
    return value;
  }
  createNote(bookId: string, title = "新笔记", annotationId?: string,
    sourceCard?: Note["sourceCard"], document?: RichNode) {
    this.library.book(bookId);
    const now = new Date().toISOString();
    const note: Note = {
      id: randomUUID(),
      bookId,
      annotationId,
      sourceCard,
      sourceReferences: [],
      title,
      document: richDocument(document ?? { type: "doc", content: [{ type: "paragraph" }] }),
      revision: 1,
      createdAt: now,
      updatedAt: now,
    };
    this.changes.save(note);
    return note;
  }
  promoteCard(bookId: string, cardId: string): { note: Note; created: boolean } {
    let note!: Note, created = false;
    this.changes.run(() => {
      const workspace = new Workspaces(this.library);
      const snapshot = workspace.get(bookId);
      const card = snapshot.cards.find((item) => item.id === cardId);
      if (!card) throw new Error("卡片不存在或不属于此书籍");
      if (card.noteId) {
        note = this.get<Note>("note", bookId, card.noteId);
        if (note.deletedAt || (card.kind !== "note" && note.sourceCard?.cardId !== card.id))
          throw new Error("卡片笔记与来源不匹配");
        return;
      }
      const paragraphs = (card.kind === "note" ? [card.text, card.comment].filter(Boolean)
        : [card.comment]).flatMap((value) => value.split(/\r?\n/));
      let document: RichNode = { type: "doc", content: (paragraphs.length ? paragraphs : [""]).map((line) => ({
        type: "paragraph", content: line ? [{ type: "text", text: line }] : [],
      })) };
      // Legacy cards allow many short lines. Keep the original text if rich block overhead
      // would exceed Note's bounded document format; never clear the card before validation.
      if (JSON.stringify(document).length > 90000)
        document = { type: "doc", content: [{ type: "paragraph", content: [{
          type: "text", text: paragraphs.join("\n"),
        }] }] };
      note = this.createNote(bookId, card.title || (card.kind === "note" ? "新笔记" : "摘录评论"), undefined,
        card.kind === "note" ? undefined : { cardId: card.id, kind: card.kind, title: card.title,
          text: card.text, source: card.source, region: card.region },
        document);
      workspace.save(bookId, { ...snapshot, cards: snapshot.cards.map((item) => item.id === card.id
        ? { ...item, noteId: note.id, title: card.kind === "note" ? "" : item.title,
          text: card.kind === "note" ? "" : item.text, comment: "" } : item) }, true);
      created = true;
    });
    if (created) this.library.emit({ type: "workspace", bookId, taskId: cardId });
    return { note, created };
  }
  comment(bookId: string, annotationId: string) {
    let result: Note;
    this.changes.run(() => {
      const annotation = this.get<Annotation>("annotation", bookId, annotationId);
      if (annotation.deletedAt) throw new Error("批注已删除，不能添加评论");
      if (annotation.noteId) {
        const existing = this.get<Note>("note", bookId, annotation.noteId);
        if (!existing.deletedAt) { result = existing; return; }
      }
      const note = this.createNote(bookId,
        annotation.quote.slice(0, 50) || `第 ${annotation.anchors[0].page} 页批注`, annotationId);
      annotation.noteId = note.id;
      annotation.revision++;
      annotation.updatedAt = new Date().toISOString();
      this.changes.save(annotation);
      result = note;
    });
    return result!;
  }
  fromAnswer(bookId: string, turnId: string) {
    const book = this.library.book(bookId);
    const turn = this.get<ChatTurn>("turn", bookId, turnId);
    if (turn.status !== "complete" || !turn.answer.trim())
      throw new Error("只能保存已完成且有内容的回答");
    const existing = this.list(bookId).find((n) => n.origin?.turnId === turnId);
    if (existing) return { note: existing, created: false };
    const sources = turn.citations.flatMap((anchor) => {
      const passage = turn.context.evidence.find(
        (p) => p.id === anchor.passageId,
      );
      if (
        !passage ||
        anchor.bookId !== bookId ||
        anchor.fingerprint !== book.fingerprint ||
        passage.anchor.bookId !== bookId ||
        passage.anchor.fingerprint !== book.fingerprint
      )
        return [];
      return [{ anchor: structuredClone(anchor), text: passage.text }];
    });
    const now = new Date().toISOString();
    const copiedImages: ReturnType<ChatImages["create"]> = [];
    let materials: NonNullable<NonNullable<Note["origin"]>["materials"]>;
    try { materials = (turn.context.materials ?? []).map((material) => {
      const mapped = new Map<string, string>();
      const images = material.images.map((image) => {
        const bytes = readFileSync(join(this.library.directory, "question-materials", bookId,
          material.id, image.id + ".png"));
        const copy = new ChatImages(this.library).create(bookId, [{ name: image.name,
          dataUrl: `data:image/png;base64,${bytes.toString("base64")}` }])[0];
        copiedImages.push(copy);
        mapped.set(image.id, copy.id);
        return { ...copy, userRendered: image.userRendered,
          includesPdfBackground: image.includesPdfBackground,
          surface: image.surface, page: image.page };
      });
      return { title: material.title, images,
        sections: material.sections.map(({ targetId: _targetId, ...section }) => ({
          ...section, imageIds: section.imageIds?.map((id) => mapped.get(id) ?? id),
          anchors: section.anchors?.map((anchor) => ({ ...anchor })),
        })) };
    }); }
    catch (error) { new ChatImages(this.library).discard(bookId, copiedImages); throw error; }
    const note: Note = {
      id: randomUUID(),
      bookId,
      title: turn.question.trim().slice(0, 200) || "回答笔记",
      createdAt: now,
      updatedAt: now,
      revision: 1,
      document: richDocument(answerDocument(turn.answer, sources)),
      sourceReferences: [],
      origin: {
        kind: "chat",
        turnId,
        question: turn.question,
        createdAt: turn.createdAt,
        model: turn.model,
        effort: turn.effort,
        sources,
        images: structuredClone([...(turn.images ?? []), ...copiedImages]),
        materials,
      },
    };
    try { this.changes.save(note); }
    catch (error) { new ChatImages(this.library).discard(bookId, copiedImages); throw error; }
    return { note, created: true };
  }
  async export(bookId: string, noteId: string) {
    const book = this.library.book(bookId);
    const note = this.get<Note>("note", bookId, noteId);
    if (note.deletedAt) throw new Error("笔记已删除");
    const assets: { name: string; bytes: Uint8Array }[] = [];
    const chatImages = new ChatImages(this.library);
    for (const [index, image] of (note.origin?.images ?? []).entries())
      assets.push({
        name: `assets/question-${index + 1}.png`,
        bytes: await readFile(chatImages.asset(bookId, image.id)),
      });
    let annotation: Annotation | undefined;
    if (note.annotationId) {
      annotation = this.get<Annotation>(
        "annotation",
        bookId,
        note.annotationId,
      );
      if (annotation.assetId)
        assets.push({
          name: "assets/region.png",
          bytes: await readFile(this.asset(bookId, annotation.assetId)),
        });
    }
    if (note.sourceCard?.region)
      assets.push({ name: "assets/excerpt-region.png",
        bytes: await this.workspaceAssets.read(bookId, note.sourceCard.region.assetId) });
    for (const reference of note.sourceReferences)
      if (reference.region)
        assets.push({ name: `assets/source-${reference.id}.png`,
          bytes: reference.regionAssetKind === "annotation"
            ? await readFile(this.asset(bookId, reference.region.assetId))
            : await this.workspaceAssets.read(bookId, reference.region.assetId) });
    return {
      buffer: exportNoteArchive(
        book,
        { ...note, document: richDocument(note.document) },
        assets,
        annotation,
      ),
      filename: `AIReader-Note-${note.id}.zip`,
    };
  }
  async createAnnotation(bookId: string, input: unknown) {
    const book = this.library.book(bookId),
      value = AnnotationInputSchema.parse(input);
    for (const anchor of value.anchors) {
      if (anchor.page > book.pages) throw new Error("批注页码超出文档范围");
      for (const r of anchor.rects)
        if (r[2] <= r[0] || r[3] <= r[1]) throw new Error("无效的批注区域");
    }
    const id = randomUUID();
    let assetId: string | undefined;
    if (value.kind === "region") {
      if (!value.image?.match(/^data:image\/png;base64,[A-Za-z0-9+/=]+$/))
        throw new Error("区域摘录需要 PNG 图片");
      const image = Buffer.from(value.image.split(",")[1], "base64");
      if (
        image.length < 33 ||
        image.length > 8 * 1024 * 1024 ||
        image.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a" ||
        image.toString("ascii", 12, 16) !== "IHDR" ||
        image.readUInt32BE(16) === 0 ||
        image.readUInt32BE(20) === 0 ||
        image.readUInt32BE(16) > 8192 ||
        image.readUInt32BE(20) > 8192
      )
        throw new Error("图片无效或超出大小限制");
      assetId = randomUUID();
      const directory = join(this.library.directory, "annotations", bookId);
      await mkdir(directory, { recursive: true });
      await writeFile(join(directory, assetId + ".png"), image, { flag: "wx" });
    } else if (value.image) throw new Error("只有区域摘录可以附图片");
    const { image, ...data } = value;
    const now = new Date().toISOString();
    let annotation: Annotation;
    this.changes.run(() => {
      annotation = {
        ...data,
        id,
        bookId,
        fingerprint: book.fingerprint,
        assetId,
        createdAt: now,
        updatedAt: now,
        revision: 1,
      };
      this.changes.save(annotation);
    });
    return annotation!;
  }
  updateNote(bookId: string, id: string, input: unknown) {
    const note = this.get<Note>("note", bookId, id);
    const value = z
      .object({
        revision: z.number().int(),
        title: z.string().trim().min(1).max(200),
        document: z.unknown(),
      })
      .parse(input);
    if (note.deletedAt || note.revision !== value.revision)
      throw new Error("笔记已更新，请保留草稿并重新加载后重试");
    note.document = noteDocument(value.document, note.sourceReferences);
    note.title = value.title;
    note.revision++;
    note.updatedAt = new Date().toISOString();
    this.changes.save(note);
    return note;
  }
  updateAnnotation(bookId: string, id: string, input: unknown) {
    const annotation = this.get<Annotation>("annotation", bookId, id);
    const value = z
      .object({
        revision: z.number().int(),
        color: z.enum(["yellow", "green", "blue", "pink"]),
      })
      .parse(input);
    if (annotation.deletedAt || annotation.revision !== value.revision)
      throw new Error("批注已更新，请重试");
    annotation.color = value.color;
    annotation.revision++;
    annotation.updatedAt = new Date().toISOString();
    this.changes.save(annotation);
    return annotation;
  }
  remove(
    bookId: string,
    id: string,
    kind: "annotation" | "note",
    restore = false,
  ) {
    const value = this.get<Annotation | Note>(kind, bookId, id);
    const wasDeleted = Boolean(value.deletedAt);
    const timestamp = new Date().toISOString();
    let workspaceChanged = false;
    this.changes.run(() => {
      if (kind === "annotation") {
        const workspace = this.library.store.workspaces.get(bookId);
        const key = `annotation:${id}`;
        if (workspace && !restore) {
          const removed = workspace.links.filter((link) => link.from === id || link.to === id);
          if (removed.length) {
            this.library.store.put("annotation-removed-links", key, bookId, removed);
            this.library.store.workspaces.save({ ...workspace,
              revision: workspace.revision + 1,
              links: workspace.links.filter((link) => link.from !== id && link.to !== id) });
            workspaceChanged = true;
          }
        } else if (workspace && restore) {
          const removed = this.library.store.get<BookWorkspace["links"]>("annotation-removed-links", key) ?? [];
          if (removed.length) {
            const endpoints = new Set([...workspace.cards.map((card) => card.id),
              ...workspace.objects.map((object) => object.id), id,
              ...this.annotations(bookId).map((annotation) => annotation.id)]);
            if (removed.some((link) => !endpoints.has(link.from) || !endpoints.has(link.to)))
              throw new Error("关联对象已删除，无法恢复批注关系；请先恢复关联对象");
            this.library.store.workspaces.save({ ...workspace,
              revision: workspace.revision + 1,
              links: [...workspace.links, ...removed.filter((link) =>
                !workspace.links.some((current) => current.id === link.id))] });
            workspaceChanged = true;
          }
        }
      }
      value.deletedAt = restore ? undefined : timestamp;
      value.updatedAt = timestamp;
      value.revision++;
      this.changes.save(value);
      if (kind === "note" && wasDeleted === restore)
        workspaceChanged = changeNotePlacement(this.library, bookId, id, restore);
      if (kind === "note" && (value as Note).annotationId) {
        const annotation = this.get<Annotation>("annotation", bookId, (value as Note).annotationId!);
        if ((!restore && annotation.noteId === id) || (restore && !annotation.noteId && !annotation.deletedAt)) {
          annotation.noteId = restore ? id : undefined;
          annotation.revision++;
          annotation.updatedAt = timestamp;
          this.changes.save(annotation);
        }
      }
    });
    if (workspaceChanged) this.library.emit({ type: "workspace", bookId, taskId: id });
    return value;
  }
  asset(bookId: string, assetId: string) {
    this.library.book(bookId);
    const notes = this.list(bookId);
    const annotation = this.library.store.list<Annotation>("annotation", bookId).find(
      (a) => a.assetId === assetId && (!a.deletedAt || notes.some((n) => n.annotationId === a.id)),
    );
    if (!annotation) throw new Error("图片不存在");
    return join(
      this.library.directory,
      "annotations",
      bookId,
      annotation.assetId + ".png",
    );
  }
}
