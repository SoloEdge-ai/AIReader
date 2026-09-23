import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, rmdirSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  QuestionMaterialInputSchema,
  type Annotation,
  type Note,
  type QuestionMaterialImage,
  type QuestionMaterialSection,
  type QuestionMaterialSnapshot,
  type RichNode,
} from "../../../packages/protocol/src";
import type { WorkspaceObject } from "../../../packages/protocol/src/workspace";
import { decodeImage } from "./chat-images";
import { Library } from "./library";
import { Notes } from "./notes";
import { WorkspaceAssets } from "./workspace-assets";
import { Workspaces } from "./workspace";

const plainText = (node: RichNode): string => {
  const content = (node.content ?? []).map(plainText).join("");
  return (node.text ?? "") + content +
    (["paragraph", "heading", "blockquote", "listItem", "codeBlock"].includes(node.type) ? "\n" : "");
};
const visualSurfaces = (object: WorkspaceObject) =>
  object.kind === "ink" ? object.segments.map((segment) => segment.surface) :
    object.kind === "shape" ? [object.surface] : [];
const surfaceKey = (id: string, surface: { kind: "board" } | { kind: "pdf"; page: number }) =>
  `${id}:${surface.kind}:${surface.kind === "pdf" ? surface.page : ""}`;

/** Freezes user-selected local material without conferring original-text citation authority. */
export class QuestionMaterials {
  constructor(private readonly library: Library, private readonly workspaces: Workspaces,
    private readonly notes: Notes, private readonly workspaceAssets: WorkspaceAssets) {}

  private directory(bookId: string, materialId: string) {
    return join(this.library.directory, "question-materials", bookId, materialId);
  }
  private imagePath(bookId: string, materialId: string, imageId: string) {
    return join(this.directory(bookId, materialId), `${imageId}.png`);
  }
  get(bookId: string, sessionId: string, materialId: string) {
    this.library.book(bookId);
    const value = this.library.store.get<QuestionMaterialSnapshot>("question-material", materialId);
    if (!value || value.bookId !== bookId || value.sessionId !== sessionId)
      throw new Error("材料不存在或不属于当前书籍会话");
    return value;
  }
  image(bookId: string, sessionId: string, materialId: string, imageId: string) {
    const value = this.get(bookId, sessionId, materialId);
    if (!value.images.some((image) => image.id === imageId)) throw new Error("材料图片不存在");
    return this.imagePath(bookId, materialId, imageId);
  }
  resolveForTurn(bookId: string, sessionId: string, ids: string[]) {
    if (ids.length > 20 || new Set(ids).size !== ids.length) throw new Error("每轮最多 20 项不重复材料");
    const values = ids.map((id) => this.get(bookId, sessionId, id));
    if (values.some((value) => value.committedTurnId))
      throw new Error("材料快照已用于上一轮，请重新添加以生成新快照");
    if (values.reduce((count, value) => count + value.itemCount, 0) > 20)
      throw new Error("每轮最多 20 项材料，请移除部分材料");
    return values;
  }
  commit(bookId: string, sessionId: string, ids: string[], turnId: string) {
    for (const value of this.resolveForTurn(bookId, sessionId, ids))
      this.library.store.put("question-material", value.id, bookId,
        { ...value, committedTurnId: turnId });
  }
  private cleanup() {
    const deadline = Date.now() - 7 * 24 * 60 * 60 * 1000;
    for (const value of this.library.store.list<QuestionMaterialSnapshot>("question-material")) {
      if (value.committedTurnId || Date.parse(value.createdAt) >= deadline) continue;
      for (const image of value.images)
        try { unlinkSync(this.imagePath(value.bookId, value.id, image.id)); } catch { /* orphan-safe */ }
      try { rmdirSync(this.directory(value.bookId, value.id)); } catch { /* orphan-safe */ }
      this.library.store.remove("question-material", value.id);
    }
  }
  async create(bookId: string, raw: unknown): Promise<QuestionMaterialSnapshot> {
    const input = QuestionMaterialInputSchema.parse(raw);
    if (input.bookId !== bookId) throw new Error("材料书籍与请求不匹配");
    this.library.book(bookId);
    if (!this.library.store.list<{ id: string }>("session", bookId)
      .some((session) => session.id === input.sessionId)) throw new Error("会话不存在或不属于本书");
    const key = `${bookId}:${input.requestId}`;
    const digest = createHash("sha256").update(JSON.stringify(input)).digest("hex");
    const repeated = this.library.store.get<{ materialId: string; digest: string }>("question-material-request", key);
    if (repeated) {
      if (repeated.digest !== digest) throw new Error("材料操作标识已被其他内容使用");
      return this.get(bookId, input.sessionId, repeated.materialId);
    }
    const workspace = this.workspaces.get(bookId);
    if (workspace.revision !== input.workspaceRevision)
      throw new Error("画板内容已变化，请重新选择材料");
    const cards = new Map(workspace.cards.map((item) => [item.id, item]));
    const objects = new Map(workspace.objects.map((item) => [item.id, item]));
    const links = new Map(workspace.links.map((item) => [item.id, item]));
    const annotations = new Map(this.library.store.list<Annotation>("annotation", bookId)
      .filter((item) => !item.deletedAt).map((item) => [item.id, item]));
    const notes = new Map(this.library.store.list<Note>("note", bookId)
      .filter((item) => !item.deletedAt).map((item) => [item.id, item]));
    const targetKeys = input.targets.map((target) => `${target.kind}:${target.id}`);
    if (new Set(targetKeys).size !== targetKeys.length) throw new Error("材料对象重复");
    const selected = new Set(input.targets.filter((target) => target.kind !== "relation").map((target) => target.id));
    const includedLinks = workspace.links.filter((link) =>
      input.targets.some((target) => target.kind === "relation" && target.id === link.id) ||
      (selected.has(link.from) && selected.has(link.to)));
    if (input.targets.length + includedLinks.filter((link) =>
      !input.targets.some((target) => target.kind === "relation" && target.id === link.id)).length > 20)
      throw new Error("关联关系使本轮材料超过 20 项，请缩小选择");
    const materialId = randomUUID();
    const sections: QuestionMaterialSection[] = [];
    const images: QuestionMaterialImage[] = [];
    const pixels: { id: string; bytes: Buffer }[] = [];
    const addImage = (name: string, bytes: Buffer, metadata: Omit<QuestionMaterialImage,
      "id" | "name" | "width" | "height" | "bytes">) => {
      const image = decodeImage({ name, dataUrl: `data:image/png;base64,${bytes.toString("base64")}` });
      const id = randomUUID();
      images.push({ id, name, width: image.width, height: image.height,
        bytes: image.buffer.length, ...metadata });
      pixels.push({ id, bytes: image.buffer });
      return id;
    };
    const requiredVisuals = new Set<string>();
    for (const target of input.targets) {
      if (target.kind === "relation") {
        if (!links.has(target.id)) throw new Error("关系不存在或不属于本书");
        continue;
      }
      if (target.kind === "card") {
        const card = cards.get(target.id);
        if (!card) throw new Error("卡片不存在或不属于本书");
        if (card.kind === "excerpt") sections.push({ kind: "book-excerpt", targetId: card.id, title: card.title,
          text: card.text, anchors: card.source?.anchors });
        else if (card.kind === "region" && card.region) {
          const bytes = Buffer.from(await this.workspaceAssets.read(bookId, card.region.assetId));
          const id = addImage(card.title, bytes, { userRendered: false, surface: "pdf",
            page: card.region.page, includesPdfBackground: true });
          sections.push({ kind: "book-region", targetId: card.id, title: card.title,
            text: card.region.includePersonalMarks ? "PDF 区域截图，含个人标注" : "PDF 区域截图",
            anchors: [{ page: card.region.page, rects: [card.region.rect] }], imageIds: [id] });
        } else sections.push({ kind: "user-note", targetId: card.id, title: card.title, text: card.text });
        if (card.comment) sections.push({ kind: "user-note", targetId: card.id,
          title: `${card.title} · 个人评论`, text: card.comment });
      } else if (target.kind === "object") {
        const object = objects.get(target.id);
        if (!object) throw new Error("画布对象不存在或不属于本书");
        if (object.kind === "text") sections.push({ kind: "user-note", targetId: object.id,
          title: "画布文字", text: object.text });
        else {
          sections.push({ kind: "user-mark", targetId: object.id,
            title: object.kind === "ink" ? "个人笔迹" : "个人形状",
            text: object.kind === "shape" ? `形状：${object.shape}；颜色：${object.color}` :
              `画笔：${object.brush}；颜色：${object.color}` });
          for (const surface of visualSurfaces(object)) requiredVisuals.add(surfaceKey(object.id, surface));
        }
      } else if (target.kind === "annotation") {
        const annotation = annotations.get(target.id);
        if (!annotation) throw new Error("批注不存在或不属于本书");
        if (target.revision !== annotation.revision)
          throw new Error("批注已变化，请重新加入材料");
        const imageIds: string[] = [];
        if (annotation.assetId) imageIds.push(addImage("个人区域批注", readFileSync(this.notes.asset(bookId,
          annotation.assetId)), { userRendered: false, surface: "pdf",
          page: annotation.anchors[0].page, includesPdfBackground: true }));
        else for (const anchor of annotation.anchors)
          requiredVisuals.add(surfaceKey(annotation.id, { kind: "pdf", page: anchor.page }));
        sections.push({ kind: "user-mark", targetId: annotation.id, title: "个人批注",
          text: `${annotation.kind}；颜色：${annotation.color}；选中文字：${annotation.quote}`,
          anchors: annotation.anchors, imageIds });
      } else {
        const note = notes.get(target.id);
        if (!note) throw new Error("笔记不存在或不属于本书");
        if (target.revision !== note.revision)
          throw new Error("笔记已变化，请重新加入材料");
        sections.push({ kind: "user-note", targetId: note.id, title: note.title,
          text: plainText(note.document) });
      }
    }
    for (const link of includedLinks) {
      sections.push({ kind: "relation", targetId: link.id, title: link.label || "对象关系",
        text: `关系 ${link.from} ${link.directed ? "→" : "—"} ${link.to}${link.label ? `：${link.label}` : ""}` });
    }
    const covered = new Set<string>();
    for (const preview of input.previews) {
      for (const id of preview.objectIds) {
        const key = surfaceKey(id, preview.surface === "pdf" ?
          { kind: "pdf", page: preview.page! } : { kind: "board" });
        if (!requiredVisuals.has(key)) throw new Error("视觉预览包含未选择的对象或错误页面");
        covered.add(key);
      }
      const bytes = Buffer.from(preview.image.slice(22), "base64");
      const imageId = addImage("所选个人标记预览", bytes, { userRendered: true,
        surface: preview.surface, page: preview.page,
        includesPdfBackground: preview.includesPdfBackground,
        objectIds: preview.objectIds });
      for (const section of sections.filter((section) =>
        section.kind === "user-mark" && section.targetId && preview.objectIds.includes(section.targetId)))
        section.imageIds = [...(section.imageIds ?? []), imageId];
    }
    if ([...requiredVisuals].some((key) => !covered.has(key)))
      throw new Error("个人标记缺少可见预览，请重新选择或缩小范围");
    if (images.length > 4) throw new Error("本轮材料图片最多 4 张，请移除部分选择");
    const textTokens = Math.ceil(Buffer.byteLength(JSON.stringify(sections), "utf8") / 2);
    if (textTokens > 10000) throw new Error("材料文字超出上下文预算，请缩小选择");
    const snapshot: QuestionMaterialSnapshot = {
      id: materialId, bookId, sessionId: input.sessionId, createdAt: new Date().toISOString(),
      title: sections.length === 1 ? sections[0].title : `${input.targets.length} 项选定材料`,
      itemCount: input.targets.length + includedLinks.filter((link) =>
        !input.targets.some((target) => target.kind === "relation" && target.id === link.id)).length,
      targets: [...input.targets, ...includedLinks.filter((link) =>
        !input.targets.some((target) => target.kind === "relation" && target.id === link.id))
        .map((link) => ({ kind: "relation" as const, id: link.id }))],
      sections, images,
    };
    const directory = this.directory(bookId, materialId);
    mkdirSync(directory, { recursive: true });
    try {
      for (const image of pixels) writeFileSync(this.imagePath(bookId, materialId, image.id), image.bytes,
        { flag: "wx" });
      this.library.store.transaction(() => {
        if (this.workspaces.get(bookId).revision !== input.workspaceRevision)
          throw new Error("画板内容已变化，请重新选择材料");
        for (const target of input.targets.filter((target) =>
          target.kind === "annotation" || target.kind === "note")) {
          const current = this.library.store.get<Annotation | Note>(target.kind, target.id);
          if (!current || current.bookId !== bookId || current.deletedAt || current.revision !== target.revision)
            throw new Error("笔记或批注已变化，请重新加入材料");
        }
        this.library.store.put("question-material", materialId, bookId, snapshot);
        this.library.store.put("question-material-request", key, bookId,
          { materialId, digest });
      });
    } catch (cause) {
      for (const image of pixels)
        try { unlinkSync(this.imagePath(bookId, materialId, image.id)); } catch { /* newly created only */ }
      try { rmdirSync(directory); } catch { /* best effort */ }
      throw cause;
    }
    this.cleanup();
    return snapshot;
  }
}
