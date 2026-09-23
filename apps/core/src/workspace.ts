import {
  WorkspaceSchema,
  WorkspaceCommandBatchSchema,
  WorkspaceCameraSchema,
  WORKSPACE_DOCUMENT_X,
  type BookWorkspace,
  type WorkspaceCamera,
} from "../../../packages/protocol/src/workspace";
import { Library } from "./library";

export class WorkspaceConflict extends Error {}

/** Spatial state is book-scoped and independent of rebuildable search indexes. */
export class Workspaces {
  constructor(private readonly library: Library) {}
  get(bookId: string): BookWorkspace {
    this.library.book(bookId);
    const saved = this.library.store.get<BookWorkspace>("workspace", bookId);
    if (saved && !saved.layoutVersion) {
      return WorkspaceSchema.parse({
        ...saved,
        layoutVersion: 2,
        cards: saved.cards.map((card) => ({
          ...card,
          x: Math.min(1000000, card.x + WORKSPACE_DOCUMENT_X - 40),
        })),
      });
    }
    const value = WorkspaceSchema.parse(
      saved ?? {
        bookId,
        revision: 0,
        layoutVersion: 2,
        cards: [],
        links: [],
      },
    );
    const camera = this.library.store.get<WorkspaceCamera>("workspace-camera", bookId);
    return camera ? { ...value, camera: WorkspaceCameraSchema.parse(camera) } : value;
  }
  camera(bookId: string, input: unknown) {
    this.library.book(bookId);
    const camera = WorkspaceCameraSchema.parse(input);
    this.library.store.put("workspace-camera", bookId, bookId, camera);
    return camera;
  }
  command(bookId: string, input: unknown, prepare?: () => void): BookWorkspace {
    const batch = WorkspaceCommandBatchSchema.parse(input);
    if (batch.bookId !== bookId) throw new Error("工作区命令与书籍不匹配");
    let result: BookWorkspace | undefined;
    this.library.store.transaction(() => {
      const commandKey = `${bookId}:${batch.commandId}`;
      const previous = this.library.store.get<{ version: number }>("workspace-command", commandKey);
      if (previous) {
        result = this.get(bookId);
        return;
      }
      const current = this.get(bookId);
      if (current.revision !== batch.expectedVersion)
        throw new WorkspaceConflict("工作区版本冲突；草稿已保留，请重新加载后重试");
      prepare?.();
      const cards = new Map(current.cards.map((card) => [card.id, card]));
      const objects = new Map(current.objects.map((object) => [object.id, object]));
      const links = new Map(current.links.map((link) => [link.id, link]));
      for (const change of batch.changes) {
        switch (change.type) {
          case "upsert-card": cards.set(change.card.id, change.card); break;
          case "delete-card":
            cards.delete(change.id);
            for (const [id, link] of links)
              if (link.from === change.id || link.to === change.id) links.delete(id);
            break;
          case "upsert-link": links.set(change.link.id, change.link); break;
          case "delete-link": links.delete(change.id); break;
          case "upsert-object": objects.set(change.object.id, change.object); break;
          case "delete-object":
            objects.delete(change.id);
            for (const [id, link] of links)
              if (link.from === change.id || link.to === change.id) links.delete(id);
            break;
        }
      }
      const next = WorkspaceSchema.parse({
        ...current,
        revision: current.revision + 1,
        cards: [...cards.values()],
        objects: [...objects.values()],
        links: [...links.values()],
      });
      this.validate(bookId, next, current, Boolean(prepare));
      this.library.store.put("workspace", bookId, bookId, next);
      this.library.store.put("workspace-command", commandKey, bookId, {
        version: next.revision,
      });
      result = next;
    });
    return result!;
  }
  save(bookId: string, input: unknown): BookWorkspace {
    const value = WorkspaceSchema.parse(input);
    if (value.bookId !== bookId) throw new Error("工作区与书籍不匹配");
    const current = this.get(bookId);
    if (current.revision !== value.revision)
      throw new Error(
        "工作区已在其他窗口更新；草稿已保留，请重新打开后处理冲突",
      );
    this.validate(bookId, value, current, true);
    const saved = { ...value, revision: current.revision + 1 };
    this.library.store.put("workspace", bookId, bookId, saved);
    if (value.camera) this.camera(bookId, value.camera);
    return saved;
  }
  private validate(bookId: string, value: BookWorkspace, current: BookWorkspace, prepareRegionAsset = false) {
    const book = this.library.book(bookId);
    const ids = new Set([...value.cards.map((card) => card.id), ...value.objects.map((object) => object.id)]);
    if (
      ids.size !== value.cards.length + value.objects.length ||
      new Set(value.links.map((link) => link.id)).size !== value.links.length
    )
      throw new Error("卡片或连接标识重复");
    for (const card of value.cards) {
      if (card.source) {
        if (card.source.fingerprint !== book.fingerprint)
          throw new Error("摘录不属于此 PDF");
        for (const anchor of card.source.anchors) {
          if (
            anchor.page > book.pages ||
            anchor.rects.some(
              (rect) => rect[2] <= rect[0] || rect[3] <= rect[1],
            )
          )
            throw new Error("摘录位置无效");
        }
      }
      if (card.region) {
        const previous = current.cards.find((old) => old.id === card.id);
        if (!previous && !prepareRegionAsset)
          throw new Error("图片摘录只能通过受控区域接口创建");
        if (card.region.fingerprint !== book.fingerprint || card.region.page > book.pages ||
            card.region.rect[2] <= card.region.rect[0] || card.region.rect[3] <= card.region.rect[1])
          throw new Error("图片摘录位置无效");
        const asset = this.library.store.get<{ bookId: string }>("workspace-asset", card.region.assetId);
        if (asset?.bookId !== bookId) throw new Error("图片摘录资源不属于本书");
      }
      const previous = current.cards.find((old) => old.id === card.id);
      if (
        previous &&
        (previous.kind !== card.kind ||
          JSON.stringify(previous.source) !== JSON.stringify(card.source) ||
          JSON.stringify(previous.region) !== JSON.stringify(card.region) ||
          (card.kind !== "note" && previous.text !== card.text))
      )
        throw new Error("原文来源不可修改，请重新摘录；个人理解请写在评论中");
    }
    const pointCount = value.objects.reduce((sum, object) =>
      sum + (object.kind === "ink" ? object.segments.reduce((n, segment) => n + segment.points.length, 0) : 0), 0);
    if (pointCount > 250000) throw new Error("本书笔迹超过 250000 个点");
    for (const object of value.objects) {
      const surfaces = object.kind === "ink" ? object.segments.map((segment) => segment.surface) : [object.surface];
      if (surfaces.some((surface) => surface.kind === "pdf" &&
          (surface.fingerprint !== book.fingerprint || surface.page > book.pages)))
        throw new Error("画布对象不属于此 PDF");
      if (object.kind !== "ink" && object.surface.kind === "board" &&
          (object.x < 0 || object.y < 0))
        throw new Error("白板对象位置无效");
    }
    for (const link of value.links)
      if (link.from === link.to || !ids.has(link.from) || !ids.has(link.to))
        throw new Error("连接的对象不存在");
  }
}
