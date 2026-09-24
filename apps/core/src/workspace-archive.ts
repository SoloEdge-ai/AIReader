import { createHash, randomUUID } from "node:crypto";
import { readFile, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { z } from "zod";
import formatVersions from "../../../build/format-versions.json" with { type: "json" };
import {
  AnnotationInputSchema,
  PdfAnchorSchema,
  PdfRegionSourceInputSchema,
  ReaderPreferencesSchema,
  type Annotation,
  type Note,
  type Book,
} from "../../../packages/protocol/src";
import { WorkspaceCardSchema, WorkspaceObjectSchema, WorkspaceSchema } from "../../../packages/protocol/src/workspace";
import { Library } from "./library";
import { richDocument } from "./notes";
import { Workspaces } from "./workspace";
import { ChatImages, decodeImage } from "./chat-images";

export const MAX_WORKSPACE_ARCHIVE_BYTES = 384 * 1024 * 1024;
const id = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[a-zA-Z0-9_-]+$/);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const sha = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
const anchor = PdfAnchorSchema.extend({
  // Retrieval citations use normalized [x, y, width, height], unlike PDF-space annotations.
  rects: z
    .array(
      z.tuple([
        z.number().finite().min(0).max(1000),
        z.number().finite().min(0).max(1000),
        z.number().finite().min(0).max(1000),
        z.number().finite().min(0).max(1000),
      ]),
    )
    .max(20000),
  bookId: id,
  fingerprint: digest,
  passageId: z.string().min(1).max(200),
  indexVersion: z.number().int().nonnegative(),
  label: z.string().max(200),
});
const image = z.object({
  id,
  name: z.string().max(100),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  bytes: z.number().int().positive(),
  source: PdfRegionSourceInputSchema.safeExtend({
    label: z.string().max(200),
  }).optional(),
});
const materialImage = image.extend({
  userRendered: z.boolean(),
  includesPdfBackground: z.boolean().optional(),
  surface: z.enum(["pdf", "board"]).optional(),
  page: z.number().int().positive().optional(),
});
const annotation = AnnotationInputSchema.omit({ image: true })
  .extend({
    id,
    bookId: id,
    fingerprint: digest,
    noteId: id.optional(),
    assetId: id.optional(),
    revision: z.number().int().nonnegative(),
    createdAt: z.string().max(100),
    updatedAt: z.string().max(100),
    deletedAt: z.string().max(100).optional(),
  })
  .strict();
const note = z
  .object({
    id,
    bookId: id,
    annotationId: id.optional(),
    sourceCard: z.object({
      cardId: id,
      kind: z.enum(["excerpt", "region"]),
      title: WorkspaceCardSchema.shape.title,
      text: WorkspaceCardSchema.shape.text,
      source: WorkspaceCardSchema.shape.source,
      region: WorkspaceCardSchema.shape.region,
    }).strict().optional(),
    title: z.string().max(200),
    document: z.unknown().transform(richDocument),
    revision: z.number().int().nonnegative(),
    createdAt: z.string().max(100),
    updatedAt: z.string().max(100),
    deletedAt: z.string().max(100).optional(),
    origin: z
      .object({
        kind: z.literal("chat"),
        turnId: id,
        question: z.string().max(100000),
        createdAt: z.string().max(100),
        model: z.string().max(200).optional(),
        effort: z.string().max(100).optional(),
        sources: z
          .array(z.object({ anchor, text: z.string().max(100000) }))
          .max(500),
        images: z.array(image).max(4).optional(),
        materials: z.array(z.object({
          title: z.string().max(300),
          sections: z.array(z.object({
            kind: z.enum(["book-excerpt", "book-region", "user-note", "user-mark", "relation"]),
            title: z.string().max(300), text: z.string().max(100000),
            anchors: z.array(PdfAnchorSchema).max(500).optional(),
            imageIds: z.array(id).max(4).optional(),
          })).max(20),
          images: z.array(materialImage).max(4),
        })).max(20).optional(),
      })
      .optional(),
  })
  .strict();
const archiveWorkspace = WorkspaceSchema.safeExtend({
  formatVersion: z.literal(4),
  layoutVersion: z.literal(2),
  objects: WorkspaceObjectSchema.array().max(5000),
});
const manifestSchema = z
  .object({
    format: z.literal("AIReader-workspace"),
    version: z.literal(formatVersions.archiveVersion),
    bookId: id,
    title: z.string().min(1).max(300),
    fingerprint: digest,
    pages: z.number().int().positive().max(100000),
    progress: z.number().int().positive(),
    workspace: archiveWorkspace,
    preferences: ReaderPreferencesSchema,
    annotations: z.array(annotation).max(5000),
    notes: z.array(note).max(5000),
    bookmarks: z
      .array(
        z.object({
          id,
          bookId: id,
          page: z.number().int().positive(),
          note: z.string().max(20000),
        }),
      )
      .max(5000),
    assets: z.record(id, digest),
  })
  .strict();

/** Portable book workspace only: no account, executable, database or personal config. */
export class WorkspaceArchives {
  constructor(private library: Library) {}
  async export(bookId: string) {
    const book = this.library.book(bookId);
    if (book.status !== "ready") throw new Error("请等待 PDF 解析完成后再打包");
    const chatImages = new ChatImages(this.library);
    const workspace = new Workspaces(this.library).get(bookId);
    const allNotes = this.library.store.list<Note>("note", bookId);
    const allAnnotations = this.library.store.list<Annotation>(
      "annotation",
      bookId,
    );
    // Retain referenced tombstones so a deleted note does not break a visible annotation.
    const values = allNotes.filter(
      (n) =>
        !n.deletedAt ||
        allAnnotations.some((a) => !a.deletedAt && a.noteId === n.id),
    );
    const annotations = allAnnotations.filter(
      (a) =>
        !a.deletedAt ||
        allNotes.some((n) => !n.deletedAt && n.annotationId === a.id),
    );
    const files: Record<string, Uint8Array> = {
      "document.pdf": await readFile(this.library.file(bookId)),
    };
    const assets: Record<string, string> = {};
    for (const a of annotations)
      if (a.assetId) {
        const bytes = await readFile(
          join(
            this.library.directory,
            "annotations",
            bookId,
            id.parse(a.assetId) + ".png",
          ),
        );
        files[`assets/${a.assetId}.png`] = bytes;
        assets[a.assetId] = sha(bytes);
      }
    for (const n of values)
      for (const img of n.origin?.images ?? []) {
        const bytes = await readFile(chatImages.asset(bookId, img.id));
        files[`assets/${img.id}.png`] = bytes;
        assets[img.id] = sha(bytes);
      }
    for (const card of workspace.cards)
      if (card.region) {
        const assetId = id.parse(card.region.assetId);
        const bytes = await readFile(join(this.library.directory, "workspace-assets", bookId, assetId + ".png"));
        files[`assets/${assetId}.png`] = bytes;
        assets[assetId] = sha(bytes);
      }
    for (const n of values)
      if (n.sourceCard?.region && !assets[n.sourceCard.region.assetId]) {
        const assetId = id.parse(n.sourceCard.region.assetId);
        const bytes = await readFile(join(this.library.directory, "workspace-assets", bookId, assetId + ".png"));
        files[`assets/${assetId}.png`] = bytes;
        assets[assetId] = sha(bytes);
      }
    const manifest = manifestSchema.parse({
      format: "AIReader-workspace",
      version: formatVersions.archiveVersion,
      bookId,
      title: book.title,
      fingerprint: book.fingerprint,
      pages: book.pages,
      progress: book.progress,
      workspace,
      preferences: this.library.store.get("reader", bookId) ?? {},
      annotations,
      notes: values,
      bookmarks: this.library.store.list("bookmark", bookId),
      assets,
    });
    files["workspace.json"] = strToU8(JSON.stringify(manifest));
    if (
      Object.values(files).reduce((total, value) => total + value.length, 0) >
      MAX_WORKSPACE_ARCHIVE_BYTES - 1024 * 1024
    )
      throw new Error("工作区超过 383 MB，暂无法打包");
    return Buffer.from(zipSync(files, { level: 0 }));
  }
  async restore(bytes: Buffer): Promise<Book> {
    let total = 0;
    const names = new Set<string>();
    const files = unzipSync(bytes, {
      filter: (file) => {
        if (
          ![0, 8].includes(file.compression) ||
          !Number.isSafeInteger(file.size) ||
          !Number.isSafeInteger(file.originalSize) ||
          file.size < 0 ||
          file.originalSize < 0 ||
          file.size > bytes.length ||
          (file.compression === 0 && file.size !== file.originalSize)
        )
          throw new Error("工作区压缩数据大小或格式无效");
        if (
          !/^(document\.pdf|workspace\.json|assets\/[a-zA-Z0-9_-]{1,100}\.png)$/.test(
            file.name,
          ) ||
          names.has(file.name) ||
          names.size >= 10002
        )
          throw new Error("工作区包含不支持或重复的文件路径");
        names.add(file.name);
        total += file.originalSize;
        if (
          total > MAX_WORKSPACE_ARCHIVE_BYTES ||
          (file.name === "workspace.json" &&
            file.originalSize > 32 * 1024 * 1024) ||
          (file.name === "document.pdf" &&
            file.originalSize > 256 * 1024 * 1024) ||
          (file.name.startsWith("assets/") &&
            file.originalSize > 8 * 1024 * 1024)
        )
          throw new Error("工作区文件过大");
        return true;
      },
    });
    if (!files["workspace.json"] || !files["document.pdf"])
      throw new Error("工作区缺少 PDF 或数据文件");
    const raw = JSON.parse(strFromU8(files["workspace.json"]));
    if (raw?.version !== formatVersions.archiveVersion)
      throw new Error("工作区归档版本不受支持，请使用更新的 AIReader");
    const data = manifestSchema.parse(raw);
    if (
      sha(files["document.pdf"]) !== data.fingerprint ||
      data.workspace.bookId !== data.bookId ||
      data.progress > data.pages
    )
      throw new Error("工作区的 PDF 或书籍标识不匹配");
    const noteIds = new Set(data.notes.map((n) => n.id)),
      annotationIds = new Set(data.annotations.map((a) => a.id));
    if (
      noteIds.size !== data.notes.length ||
      annotationIds.size !== data.annotations.length
    )
      throw new Error("工作区记录标识重复");
    const validAnchor = (a: z.infer<typeof PdfAnchorSchema>) => {
      if (
        a.page > data.pages ||
        a.rects.some((r) => r[2] <= r[0] || r[3] <= r[1])
      )
        throw new Error("工作区原文位置无效");
    };
    const referencedAssets = new Set<string>();
    for (const a of data.annotations) {
      if (
        a.bookId !== data.bookId ||
        a.fingerprint !== data.fingerprint ||
        (a.noteId && (!noteIds.has(a.noteId) ||
        data.notes.find((n) => n.id === a.noteId)?.annotationId !== a.id)) ||
        (a.kind === "region") !== !!a.assetId
      )
        throw new Error("批注与笔记或原文不匹配");
      a.anchors.forEach(validAnchor);
      if (a.assetId) referencedAssets.add(a.assetId);
    }
    for (const n of data.notes) {
      if (
        n.bookId !== data.bookId ||
        (n.annotationId &&
          !annotationIds.has(n.annotationId))
      )
        throw new Error("笔记所属书籍或批注不匹配");
      if (n.sourceCard) {
        const source = n.sourceCard;
        if ((source.kind === "excerpt") !== Boolean(source.source) ||
            (source.kind === "region") !== Boolean(source.region))
          throw new Error("摘录评论来源类型无效");
        if (source.source) {
          if (source.source.fingerprint !== data.fingerprint)
            throw new Error("摘录评论不属于此文档");
          source.source.anchors.forEach(validAnchor);
        }
        if (source.region) {
          if (source.region.fingerprint !== data.fingerprint ||
              source.region.page > data.pages ||
              source.region.rect[2] <= source.region.rect[0] ||
              source.region.rect[3] <= source.region.rect[1])
            throw new Error("摘录评论图片来源无效");
          referencedAssets.add(source.region.assetId);
        }
      }
      for (const s of n.origin?.sources ?? []) {
        if (
          s.anchor.bookId !== data.bookId ||
          s.anchor.fingerprint !== data.fingerprint
        )
          throw new Error("笔记原文来源不匹配");
        if (s.anchor.page > data.pages) throw new Error("笔记原文页码无效");
      }
      for (const img of n.origin?.images ?? []) {
        if (
          img.source &&
          (img.source.bookId !== data.bookId ||
            img.source.fingerprint !== data.fingerprint ||
            img.source.page > data.pages)
        )
          throw new Error("笔记图片来源不匹配");
        referencedAssets.add(img.id);
      }
      for (const material of n.origin?.materials ?? []) {
        for (const section of material.sections) {
          section.anchors?.forEach(validAnchor);
          for (const imageId of section.imageIds ?? [])
            if (!material.images.some((image) => image.id === imageId) ||
              !n.origin?.images?.some((image) => image.id === imageId))
              throw new Error("笔记材料图片来源不匹配");
        }
        for (const image of material.images)
          if (!n.origin?.images?.some((item) => item.id === image.id))
            throw new Error("笔记材料附件缺失");
      }
    }
    for (const b of data.bookmarks)
      if (b.bookId !== data.bookId || b.page > data.pages)
        throw new Error("书签不属于此文档");
    const cards = new Set(data.workspace.cards.map((card) => card.id));
    const objectIds = new Set(data.workspace.objects.map((object) => object.id));
    if (
      cards.size !== data.workspace.cards.length ||
      objectIds.size !== data.workspace.objects.length ||
      [...objectIds].some((objectId) => cards.has(objectId)) ||
      new Set(data.workspace.links.map((link) => link.id)).size !==
        data.workspace.links.length
    )
      throw new Error("卡片或关系标识重复");
    const placedNotes = new Set<string>();
    for (const card of data.workspace.cards) {
      if (card.noteId) {
        const content = data.notes.find((note) => note.id === card.noteId);
        if (!content || content.deletedAt || placedNotes.has(card.noteId))
          throw new Error("笔记位置引用缺失、已删除或重复的笔记");
        if (card.kind !== "note" && (content.sourceCard?.cardId !== card.id ||
            content.sourceCard.kind !== card.kind || content.sourceCard.text !== card.text ||
            JSON.stringify(content.sourceCard.source) !== JSON.stringify(card.source) ||
            JSON.stringify(content.sourceCard.region) !== JSON.stringify(card.region) || card.comment))
          throw new Error("摘录评论与卡片不匹配");
        placedNotes.add(card.noteId);
      }
      if (card.source) {
        if (card.source.fingerprint !== data.fingerprint)
          throw new Error("摘录不属于此文档");
        card.source.anchors.forEach(validAnchor);
      }
      if (card.region) {
        if (card.region.fingerprint !== data.fingerprint ||
            card.region.page > data.pages || card.region.rect[2] <= card.region.rect[0] ||
            card.region.rect[3] <= card.region.rect[1])
          throw new Error("图片摘录不属于此文档");
        referencedAssets.add(card.region.assetId);
      }
    }
    for (const object of data.workspace.objects) {
      const surfaces = object.kind === "ink" ? object.segments.map((segment) => segment.surface) : [object.surface];
      if (surfaces.some((surface) => surface.kind === "pdf" &&
          (surface.fingerprint !== data.fingerprint || surface.page > data.pages)))
        throw new Error("画布对象不属于此文档");
    }
    for (const link of data.workspace.links)
      if (!(cards.has(link.from) || objectIds.has(link.from) || annotationIds.has(link.from)) ||
          !(cards.has(link.to) || objectIds.has(link.to) || annotationIds.has(link.to)) || link.from === link.to)
        throw new Error("关系指向不存在的卡片");
    if (
      referencedAssets.size !== Object.keys(data.assets).length ||
      names.size !== referencedAssets.size + 2
    )
      throw new Error("工作区附件不完整");
    const decoded = new Map<string, ReturnType<typeof decodeImage>>();
    for (const assetId of referencedAssets) {
      const asset = files[`assets/${assetId}.png`];
      if (!asset || sha(asset) !== data.assets[assetId])
        throw new Error("工作区附件缺失或校验失败");
      decoded.set(
        assetId,
        decodeImage({
          name: "摘录图片",
          dataUrl: `data:image/png;base64,${Buffer.from(asset).toString("base64")}`,
        }),
      );
    }
    let book: Book | undefined;
    try {
      book = await this.library.import(
        Buffer.from(files["document.pdf"]),
        `${data.title}（恢复副本）.pdf`,
        true,
      );
      book = await this.library.waitForBook(book.id);
      if (book.status !== "ready" || book.pages !== data.pages)
        throw new Error("工作区 PDF 无法解析或页数不匹配");
      const bookId = book.id;
      const ids = new Map(
        [...noteIds, ...annotationIds, ...referencedAssets, ...cards,
          ...data.notes.flatMap((note) => note.sourceCard ? [note.sourceCard.cardId] : []), ...objectIds,
          ...data.workspace.links.map((link) => link.id)].map((old) => [
          old,
          randomUUID(),
        ]),
      );
      const mapped = (old: string) => ids.get(old)!;
      const restoredNotes: Note[] = data.notes.map((n) => ({
        ...n,
        id: mapped(n.id),
        bookId,
        revision: 1,
        annotationId: n.annotationId ? mapped(n.annotationId) : undefined,
        sourceCard: n.sourceCard ? {
          ...n.sourceCard,
          cardId: mapped(n.sourceCard.cardId),
          region: n.sourceCard.region ? { ...n.sourceCard.region,
            assetId: mapped(n.sourceCard.region.assetId) } : undefined,
        } : undefined,
        origin: n.origin
          ? {
              ...n.origin,
              sources: n.origin.sources.map((s) => ({
                ...s,
                anchor: { ...s.anchor, bookId },
              })),
              images: n.origin.images?.map((img) => {
                const normalized = decoded.get(img.id)!;
                return {
                  ...img,
                  id: mapped(img.id),
                  width: normalized.width,
                  height: normalized.height,
                  bytes: normalized.buffer.length,
                  source: img.source ? { ...img.source, bookId } : undefined,
                };
              }),
              materials: n.origin.materials?.map((material) => ({
                ...material,
                images: material.images.map((image) => ({ ...image, id: mapped(image.id) })),
                sections: material.sections.map((section) => ({ ...section,
                  imageIds: section.imageIds?.map(mapped),
                })),
              })),
            }
          : undefined,
      }));
      const restoredAnnotations: Annotation[] = data.annotations.map((a) => ({
        ...a,
        id: mapped(a.id),
        bookId,
        noteId: a.noteId ? mapped(a.noteId) : undefined,
        assetId: a.assetId ? mapped(a.assetId) : undefined,
        revision: 1,
      }));
      for (const kind of ["annotations", "chat-images", "workspace-assets"])
        await mkdir(join(this.library.directory, kind, bookId), {
          recursive: true,
        });
      for (const a of data.annotations)
        if (a.assetId)
          await writeFile(
            join(
              this.library.directory,
              "annotations",
              bookId,
              mapped(a.assetId) + ".png",
            ),
            decoded.get(a.assetId)!.buffer,
            { flag: "wx" },
          );
      const writtenImages = new Set<string>();
      for (const n of data.notes)
        for (const img of n.origin?.images ?? [])
          if (!writtenImages.has(img.id)) {
            await writeFile(
              join(
                this.library.directory,
                "chat-images",
                bookId,
                mapped(img.id) + ".png",
              ),
              decoded.get(img.id)!.buffer,
              { flag: "wx" },
            );
            writtenImages.add(img.id);
          }
      const workspaceAssets = new Set([
        ...data.workspace.cards.flatMap((card) => card.region ? [card.region.assetId] : []),
        ...data.notes.flatMap((note) => note.sourceCard?.region ? [note.sourceCard.region.assetId] : []),
      ]);
      for (const assetId of workspaceAssets)
        await writeFile(join(this.library.directory, "workspace-assets", bookId,
          mapped(assetId) + ".png"), decoded.get(assetId)!.buffer, { flag: "wx" });
      this.library.store.transaction(() => {
        for (const n of restoredNotes)
          this.library.store.put("note", n.id, bookId, n);
        for (const a of restoredAnnotations)
          this.library.store.put("annotation", a.id, bookId, a);
        for (const originalId of workspaceAssets) {
            const image = decoded.get(originalId)!;
            const assetId = mapped(originalId);
            this.library.store.put("workspace-asset", assetId, bookId, {
              id: assetId, bookId, width: image.width, height: image.height,
              bytes: image.buffer.length, sha256: sha(image.buffer),
            });
        }
        for (const mark of data.bookmarks) {
          const id = randomUUID();
          this.library.store.put("bookmark", id, bookId, {
            ...mark,
            id,
            bookId,
          });
        }
        new Workspaces(this.library).save(bookId, {
          ...data.workspace,
          bookId,
          revision: 0,
          cards: data.workspace.cards.map((card) => ({
            ...card, id: mapped(card.id),
            noteId: card.noteId ? mapped(card.noteId) : undefined,
            region: card.region ? { ...card.region, assetId: mapped(card.region.assetId) } : undefined,
          })),
          objects: data.workspace.objects.map((object) => ({ ...object, id: mapped(object.id) })),
          links: data.workspace.links.map((link) => ({
            ...link, id: mapped(link.id), from: mapped(link.from), to: mapped(link.to),
          })),
        });
        this.library.store.put("reader", bookId, bookId, data.preferences);
        book!.progress = data.progress;
        this.library.store.put("book", bookId, bookId, book);
      });
      return book;
    } catch (error) {
      // Roll back only the freshly generated copy, never an existing user book.
      if (book) {
        const copyId = book.id;
        this.library.store.transaction(() => {
          this.library.store.workspaces.remove(copyId);
          this.library.store.db
            .prepare("DELETE FROM records WHERE book_id=?")
            .run(copyId);
          this.library.store.db
            .prepare("DELETE FROM passages WHERE book_id=?")
            .run(copyId);
          this.library.store.db
            .prepare("DELETE FROM search WHERE book_id=?")
            .run(copyId);
        });
        await rm(join(this.library.directory, "books", copyId + ".pdf"), {
          force: true,
        });
        for (const kind of ["annotations", "chat-images", "workspace-assets"])
          await rm(join(this.library.directory, kind, copyId), {
            recursive: true,
            force: true,
          });
      }
      throw error;
    }
  }
}
