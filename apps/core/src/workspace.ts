import {
  WorkspaceSchema,
  WorkspaceCommandBatchSchema,
  WorkspaceCameraSchema,
  type BookWorkspace,
  type WorkspaceCard,
} from "../../../packages/protocol/src/workspace";
import { Library } from "./library";
import type { Annotation, Note } from "../../../packages/protocol/src";
import { createHash } from "node:crypto";
import { WorkspaceCommandV2Schema, commandPayload, type WorkspaceReceipt } from "../../../packages/protocol/src/workspace-commands";
import { applyWorkspaceChanges, workspaceDifference } from "../../../packages/workspace-engine/src/commands";
import { validateWorkspaceGroups } from "./workspace-groups";

export class WorkspaceConflict extends Error {
  constructor(message: string, readonly code = "CONTENT_VERSION_CONFLICT") { super(message); }
}
export class WorkspacePayloadError extends Error {
  readonly code = "PAYLOAD_HASH_MISMATCH";
}

/** Spatial state is book-scoped and independent of rebuildable search indexes. */
export class Workspaces {
  constructor(private readonly library: Library) {}
  commandReceipt(bookId: string, commandId: string): { version: number; payloadHash?: string } | undefined {
    this.library.book(bookId);
    return this.library.store.workspaces.legacyReceipt(bookId, commandId);
  }
  get(bookId: string): BookWorkspace {
    this.library.book(bookId);
    const saved = this.library.store.workspaces.get(bookId);
    // The repository already validates stored rows when constructing its projection.
    // A second deep parse would clone every point in a maximal ink workspace.
    if (saved) return saved;
    return WorkspaceSchema.parse({
        bookId,
        revision: 0,
        layoutVersion: 3,
        cards: [],
        groups: [],
        links: [],
      });
  }
  camera(bookId: string, input: unknown) {
    this.library.book(bookId);
    const camera = WorkspaceCameraSchema.parse(input);
    this.library.store.workspaces.saveCamera(bookId, camera);
    return camera;
  }
  commandV2(bookId: string, input: unknown): WorkspaceReceipt {
    const batch = WorkspaceCommandV2Schema.parse(input);
    this.library.book(bookId);
    if (batch.bookId !== bookId) throw new Error("工作区命令与书籍不匹配");
    const hash = createHash("sha256").update(commandPayload(batch)).digest("hex");
    if (hash !== batch.payloadHash) throw new WorkspacePayloadError("命令内容与校验摘要不匹配");
    let receipt!: WorkspaceReceipt;
    this.library.store.transaction(() => {
      if (this.library.store.getForBook("book-command", `${bookId}:${batch.commandId}`, bookId))
        throw new WorkspaceConflict("命令 ID 已被其他内容使用", "COMMAND_ID_REUSED");
      const previous = this.library.store.workspaces.receipt(bookId, batch.commandId);
      if (previous) {
        if (previous.payloadHash !== hash) throw new WorkspaceConflict("命令 ID 已被其他内容使用", "COMMAND_ID_REUSED");
        receipt = previous;
        return;
      }
      const current = this.get(bookId);
      if (current.revision !== batch.expectedContentVersion)
        throw new WorkspaceConflict("工作区版本冲突；草稿已保留，请重新加载后重试");
      const next = WorkspaceSchema.parse({ ...applyWorkspaceChanges(current, batch.changes), revision: current.revision + 1 });
      for (const card of current.cards) {
        if (card.region && !next.cards.some((entry) => entry.id === card.id))
          this.library.store.put("workspace-region-origin", `${bookId}:${card.id}`, bookId, {
            kind: card.kind, text: card.text, region: card.region,
          });
      }
      this.validate(bookId, next, current);
      receipt = { bookId, commandId: batch.commandId, payloadHash: hash,
        previousVersion: current.revision, contentVersion: next.revision,
        changes: workspaceDifference(current, next), inverse: workspaceDifference(next, current) };
      // Reserve room for command identity/hash/version when the inverse is submitted.
      if (Buffer.byteLength(JSON.stringify(receipt.inverse), "utf8") > 8 * 1024 * 1024 - 1024)
        throw new Error("本次操作的撤销内容超过 8 MiB，请分批操作；内容未修改");
      this.library.store.workspaces.saveValidated(next);
      this.library.store.workspaces.saveReceipt(receipt);
    });
    return receipt;
  }
  command(bookId: string, input: unknown, prepare?: () => void, receiptHash?: string): BookWorkspace {
    const batch = WorkspaceCommandBatchSchema.parse(input);
    if (batch.bookId !== bookId) throw new Error("工作区命令与书籍不匹配");
    const hash = receiptHash ?? createHash("sha256").update(JSON.stringify(batch)).digest("hex");
    let result: BookWorkspace | undefined;
    this.library.store.transaction(() => {
      if (this.library.store.getForBook("book-command", `${bookId}:${batch.commandId}`, bookId))
        throw new WorkspaceConflict("命令 ID 已被其他内容使用", "COMMAND_ID_REUSED");
      const previous = this.commandReceipt(bookId, batch.commandId);
      if (previous) {
        if (previous.payloadHash && previous.payloadHash !== hash)
          throw new WorkspaceConflict("命令 ID 已被其他内容使用", "COMMAND_ID_REUSED");
        result = this.get(bookId);
        return;
      }
      const current = this.get(bookId);
      if (current.revision !== batch.expectedVersion)
        throw new WorkspaceConflict("工作区版本冲突；草稿已保留，请重新加载后重试");
      prepare?.();
      const next = WorkspaceSchema.parse({
        ...applyWorkspaceChanges(current, batch.changes),
        revision: current.revision + 1,
      });
      this.validate(bookId, next, current, Boolean(prepare));
      this.library.store.workspaces.saveValidated(next);
      this.library.store.workspaces.saveLegacyReceipt(bookId, batch.commandId, {
        version: next.revision, payloadHash: hash,
      });
      result = next;
    });
    return result!;
  }
  save(bookId: string, input: unknown, allowNoteBinding = false): BookWorkspace {
    const value = WorkspaceSchema.parse(input);
    if (value.bookId !== bookId) throw new Error("工作区与书籍不匹配");
    const current = this.get(bookId);
    if (current.revision !== value.revision)
      throw new Error(
        "工作区已在其他窗口更新；草稿已保留，请重新打开后处理冲突",
      );
    this.validate(bookId, value, current, true, allowNoteBinding);
    const saved = { ...value, revision: current.revision + 1 };
    this.library.store.workspaces.saveValidated(saved);
    if (value.camera) this.camera(bookId, value.camera);
    return saved;
  }
  private validate(bookId: string, value: BookWorkspace, current: BookWorkspace,
    prepareRegionAsset = false, allowNoteBinding = false) {
    const book = this.library.book(bookId);
    const ids = new Set([...value.cards.map((card) => card.id), ...value.objects.map((object) => object.id)]);
    if (
      ids.size !== value.cards.length + value.objects.length ||
      new Set(value.links.map((link) => link.id)).size !== value.links.length
    )
      throw new Error("卡片或连接标识重复");
    validateWorkspaceGroups(value);
    const placedNotes = new Set<string>();
    for (const card of value.cards) {
      if (card.noteId) {
        const note = this.library.store.get<Note>("note", card.noteId);
        if (!note || note.bookId !== bookId || note.deletedAt) throw new Error("笔记不存在或不属于此书籍");
        if (card.kind !== "note" && (note.sourceCard?.cardId !== card.id ||
          note.sourceCard.kind !== card.kind || note.sourceCard.text !== card.text ||
          JSON.stringify(note.sourceCard.source) !== JSON.stringify(card.source) ||
          JSON.stringify(note.sourceCard.region) !== JSON.stringify(card.region)))
          throw new Error("摘录评论与原文来源不匹配");
        if (card.kind === "note") {
          if (placedNotes.has(card.noteId)) throw new Error("此笔记已经放到画布，请定位已有卡片");
          placedNotes.add(card.noteId);
        }
      }
      // Deleted region provenance is Core-owned, not supplied by the undo request.
      const previous = current.cards.find((old) => old.id === card.id) ??
        this.library.store.get<Pick<WorkspaceCard, "kind" | "text" | "source" | "region">>("workspace-region-origin", `${bookId}:${card.id}`);
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
        if (!previous && !prepareRegionAsset)
          throw new Error("图片摘录只能通过受控区域接口创建");
        if (card.region.fingerprint !== book.fingerprint || card.region.page > book.pages ||
            card.region.rect[2] <= card.region.rect[0] || card.region.rect[3] <= card.region.rect[1])
          throw new Error("图片摘录位置无效");
        if (!this.library.store.workspaces.asset(bookId, card.region.assetId))
          throw new Error("图片摘录资源不属于本书");
      }
      if (
        previous &&
        (previous.kind !== card.kind ||
          (!allowNoteBinding && "noteId" in previous && previous.noteId !== card.noteId) ||
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
    const annotations = new Set(this.library.store.list<Annotation>("annotation", bookId)
      .filter((annotation) => !annotation.deletedAt).map((annotation) => annotation.id));
    for (const link of value.links)
      if (link.from === link.to ||
          ![link.from, link.to].every((id) => ids.has(id) || annotations.has(id)))
        throw new Error("连接的对象不存在");
  }
}
