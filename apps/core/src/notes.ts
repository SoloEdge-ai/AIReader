import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import {
  AnnotationInputSchema,
  type Annotation,
  type Note,
  type RichNode,
} from "../../../packages/protocol/src";
import { Library } from "./library";
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
    if (value.content !== undefined) {
      if (
        !Array.isArray(value.content) ||
        ["text", "hardBreak", "horizontalRule"].includes(value.type)
      )
        throw new Error("无效的笔记层级");
      result.content = value.content.map((v: unknown) => parse(v, depth + 1));
    }
    const children=result.content??[];
    const blocks=["paragraph","heading","bulletList","orderedList","blockquote","codeBlock","horizontalRule"];
    const allowed:Record<string,string[]>={doc:blocks,blockquote:blocks,listItem:blocks,paragraph:["text","hardBreak"],heading:["text","hardBreak"],codeBlock:["text"],bulletList:["listItem"],orderedList:["listItem"]};
    if(children.some(child=>!allowed[value.type]?.includes(child.type)))throw new Error("无效的笔记层级");
    if(["doc","blockquote","listItem","bulletList","orderedList"].includes(value.type)&&!children.length)throw new Error("笔记结构缺少内容");
    if(value.type==="listItem"&&children[0]?.type!=="paragraph")throw new Error("列表项必须以段落开始");
    return result;
  }
  const result = parse(input, 0);
  if (result.type !== "doc") throw new Error("笔记必须包含文档根节点");
  return result;
}
export class Notes {
  constructor(readonly library: Library) {}
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
      .filter((n) => !n.deletedAt);
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
  private save(value: Annotation | Note, kind: "annotation" | "note") {
    this.library.store.put(kind, value.id, value.bookId, value);
    this.library.emit({
      type: kind,
      bookId: value.bookId,
      taskId: value.id,
      data: value,
    });
  }
  createNote(bookId: string, title = "新笔记", annotationId?: string) {
    this.library.book(bookId);
    const now = new Date().toISOString();
    const note: Note = {
      id: randomUUID(),
      bookId,
      annotationId,
      title,
      document: { type: "doc", content: [{ type: "paragraph" }] },
      revision: 1,
      createdAt: now,
      updatedAt: now,
    };
    this.save(note, "note");
    return note;
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
      image.readUInt32BE(16) === 0 || image.readUInt32BE(20) === 0 ||
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
    this.library.store.transaction(() => {
      const note = this.createNote(
        bookId,
        value.quote.slice(0, 50) || `第 ${value.anchors[0].page} 页批注`,
        id,
      );
      annotation = {
        ...data,
        id,
        bookId,
        fingerprint: book.fingerprint,
        noteId: note.id,
        assetId,
        createdAt: now,
        updatedAt: now,
        revision: 1,
      };
      this.save(annotation, "annotation");
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
    note.document = richDocument(value.document);
    note.title = value.title;
    note.revision++;
    note.updatedAt = new Date().toISOString();
    this.save(note, "note");
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
    this.save(annotation, "annotation");
    return annotation;
  }
  remove(
    bookId: string,
    id: string,
    kind: "annotation" | "note",
    restore = false,
  ) {
    const value = this.get<Annotation | Note>(kind, bookId, id);
    const previous = value.deletedAt;
    const timestamp = new Date().toISOString();
    this.library.store.transaction(() => {
      value.deletedAt = restore ? undefined : timestamp;
      value.updatedAt = timestamp;
      value.revision++;
      this.save(value, kind);
      if (kind === "annotation") {
        const note = this.get<Note>(
          "note",
          bookId,
          (value as Annotation).noteId,
        );
        if (
          (restore && note.deletedAt === previous) ||
          (!restore && !note.deletedAt)
        ) {
          note.deletedAt = restore ? undefined : timestamp;
          note.revision++;
          note.updatedAt = timestamp;
          this.save(note, "note");
        }
      }
    });
    return value;
  }
  asset(bookId: string, assetId: string) {
    const annotation = this.annotations(bookId).find(
      (a) => a.assetId === assetId,
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
