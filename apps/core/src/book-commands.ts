import { createHash, randomUUID } from "node:crypto";
import type { Annotation, Note, NoteSourceReference } from "../../../packages/protocol/src/notes";
import type { BookWorkspace, WorkspaceCard } from "../../../packages/protocol/src/workspace";
import { BookCommandSchema, bookCommandPayload, type BookCommandReceipt } from "../../../packages/protocol/src/book-commands";
import { applyWorkspaceChanges, workspaceDifference } from "../../../packages/workspace-engine/src/commands";
import type { Library } from "./library";
import { noteDocument } from "./notes";
import { Workspaces, WorkspaceConflict, WorkspacePayloadError } from "./workspace";

type RemovedPlacement = {
  cards: WorkspaceCard[];
  links: BookWorkspace["links"];
  groups: { id: string; memberIds: string[] }[];
  associatedCardIds: string[];
};

/** Core's cross-entity transaction boundary. Receipts are durable before any event is published. */
export class BookCommands {
  private readonly workspaces: Workspaces;
  constructor(private readonly library: Library) {
    this.workspaces = new Workspaces(library);
  }

  private note(bookId: string, id: string): Note {
    const note = this.library.store.getForBook<Note>("note", id, bookId);
    if (!note) throw new Error("笔记不存在或不属于此书籍");
    return note;
  }

  private source(bookId: string, workspace: BookWorkspace, target: { kind: "card" | "annotation"; id: string }): NoteSourceReference {
    const book = this.library.book(bookId);
    if (target.kind === "card") {
      const card = workspace.cards.find((item) => item.id === target.id);
      if (!card || card.kind === "note") throw new Error("摘录不存在或不属于此书籍");
      return { id: randomUUID(), kind: "card", targetId: card.id,
        title: card.title || (card.kind === "region" ? `第 ${card.region!.page} 页图表` : "原文摘录"),
        text: card.text, source: card.source ? structuredClone(card.source) : undefined,
        region: card.region ? structuredClone(card.region) : undefined,
        regionAssetKind: card.region ? "workspace" : undefined };
    }
    const annotation = this.library.store.getForBook<Annotation>("annotation", target.id, bookId);
    if (!annotation || annotation.deletedAt || annotation.fingerprint !== book.fingerprint)
      throw new Error("原文标记不存在或不属于此书籍");
    return { id: randomUUID(), kind: "annotation", targetId: annotation.id,
      title: `第 ${annotation.anchors[0].page} 页标记`, text: annotation.quote,
      source: { fingerprint: annotation.fingerprint, anchors: structuredClone(annotation.anchors) },
      region: annotation.assetId ? { fingerprint: annotation.fingerprint,
        page: annotation.anchors[0].page, rect: annotation.anchors[0].rects[0],
        assetId: annotation.assetId, includePersonalMarks: false } : undefined,
      regionAssetKind: annotation.assetId ? "annotation" : undefined };
  }

  private removePlacement(bookId: string, noteId: string, workspace: BookWorkspace): BookWorkspace {
    const cards = workspace.cards.filter((card) => card.noteId === noteId && card.kind === "note");
    const ids = new Set(cards.map((card) => card.id));
    const links = workspace.links.filter((link) => ids.has(link.from) || ids.has(link.to));
    const groups = workspace.groups.filter((group) => group.memberIds.some((id) => ids.has(id)))
      .map((group) => ({ id: group.id, memberIds: group.memberIds.filter((id) => ids.has(id)) }));
    const associatedCardIds = workspace.cards.filter((card) => card.kind !== "note" && card.noteId === noteId)
      .map((card) => card.id);
    const removed: RemovedPlacement = { cards, links, groups, associatedCardIds };
    this.library.store.put("book-note-placement", `${bookId}:${noteId}`, bookId, removed);
    return { ...workspace,
      cards: workspace.cards.filter((card) => !ids.has(card.id))
        .map((card) => card.noteId === noteId ? { ...card, noteId: undefined } : card),
      links: workspace.links.filter((link) => !ids.has(link.from) && !ids.has(link.to)),
      groups: workspace.groups.map((group) => ({ ...group,
        memberIds: group.memberIds.filter((id) => !ids.has(id)) })) };
  }

  private restorePlacement(bookId: string, noteId: string, workspace: BookWorkspace): BookWorkspace {
    const removed = this.library.store.getForBook<RemovedPlacement>("book-note-placement", `${bookId}:${noteId}`, bookId);
    if (!removed) return workspace;
    const restored = new Set(removed.cards.map((card) => card.id));
    if (workspace.cards.some((card) => restored.has(card.id) || card.kind === "note" && card.noteId === noteId) ||
        workspace.links.some((link) => removed.links.some((old) => old.id === link.id)))
      throw new Error("卡片或关系已变化，无法恢复笔记");
    const available = new Set([...workspace.cards.map((card) => card.id),
      ...workspace.objects.map((object) => object.id), ...restored,
      ...this.library.store.list<Annotation>("annotation", bookId).filter((a) => !a.deletedAt).map((a) => a.id)]);
    if (removed.links.some((link) => !available.has(link.from) || !available.has(link.to)) ||
        removed.groups.some((group) => !workspace.groups.some((current) => current.id === group.id)))
      throw new Error("关联对象或主题组已变化，无法恢复笔记");
    const associated = new Set(removed.associatedCardIds);
    const cards = workspace.cards.map((card) => associated.has(card.id) && !card.noteId
      ? { ...card, noteId } : card);
    this.library.store.remove("book-note-placement", `${bookId}:${noteId}`);
    return { ...workspace, cards: [...cards, ...removed.cards],
      links: [...workspace.links, ...removed.links],
      groups: workspace.groups.map((group) => ({ ...group,
        memberIds: [...group.memberIds, ...(removed.groups.find((old) => old.id === group.id)?.memberIds ?? [])] })) };
  }

  execute(bookId: string, input: unknown): BookCommandReceipt {
    const command = BookCommandSchema.parse(input);
    this.library.book(bookId);
    if (command.bookId !== bookId) throw new Error("命令与书籍不匹配");
    const hash = createHash("sha256").update(bookCommandPayload(command)).digest("hex");
    if (hash !== command.payloadHash) throw new WorkspacePayloadError("命令内容与校验摘要不匹配");
    let receipt!: BookCommandReceipt;
    let changedNotes: Note[] = [];
    let changedAnnotations: Annotation[] = [];
    this.library.store.transaction(() => {
      const previous = this.library.store.getForBook<BookCommandReceipt>("book-command", `${bookId}:${command.commandId}`, bookId);
      if (previous) {
        if (previous.payloadHash !== hash) throw new WorkspaceConflict("命令 ID 已被其他内容使用", "COMMAND_ID_REUSED");
        receipt = previous;
        return;
      }
      if (this.library.store.workspaces.receipt(bookId, command.commandId) ||
          this.library.store.workspaces.legacyReceipt(bookId, command.commandId))
        throw new WorkspaceConflict("命令 ID 已被其他内容使用", "COMMAND_ID_REUSED");
      const initial = this.workspaces.get(bookId);
      if (initial.revision !== command.expectedContentVersion)
        throw new WorkspaceConflict("工作区版本冲突；草稿已保留，请重新加载后重试");
      let workspace = initial;
      const before = new Map<string, Note | undefined>();
      const changed = new Map<string, Note>();
      const remember = (note: Note, old?: Note) => {
        if (!before.has(note.id)) before.set(note.id, old && structuredClone(old));
        this.library.store.put("note", note.id, bookId, note);
        changed.set(note.id, note);
      };
      const existing = (id: string, revision: number, deleted = false) => {
        const note = this.note(bookId, id);
        if (note.revision !== revision || Boolean(note.deletedAt) !== deleted)
          throw new WorkspaceConflict("笔记版本冲突；草稿已保留，请重新加载后重试", "NOTE_REVISION_CONFLICT");
        return note;
      };
      const timestamp = () => new Date().toISOString();
      for (const change of command.changes) {
        if (change.type === "create-note") {
          const now = timestamp();
          const title = change.title.trim();
          if (!title) throw new Error("笔记标题不能为空");
          const document = noteDocument(change.document ?? { type: "doc", content: [{ type: "paragraph" }] }, []);
          const note: Note = { id: randomUUID(), bookId, title,
            document,
            sourceReferences: [], revision: 1, createdAt: now, updatedAt: now };
          remember(note);
          const card: WorkspaceCard = { ...change.placement, kind: "note", noteId: note.id,
            title: "", text: "", comment: "" };
          workspace = { ...workspace, cards: [...workspace.cards, card] };
        } else if (change.type === "update-note") {
          const old = existing(change.noteId, change.expectedRevision);
          const title = change.title.trim();
          if (!title) throw new Error("笔记标题不能为空");
          const document = noteDocument(change.document, old.sourceReferences);
          remember({ ...old, title, document,
            revision: old.revision + 1, updatedAt: timestamp() }, old);
        } else if (change.type === "add-source") {
          const old = existing(change.noteId, change.expectedRevision);
          if (old.sourceReferences.length >= 500) throw new Error("每篇笔记最多关联 500 处来源");
          if (old.sourceReferences?.some((reference) => reference.kind === change.target.kind &&
              reference.targetId === change.target.id)) throw new Error("来源已经关联此笔记");
          const reference = this.source(bookId, workspace, change.target);
          remember({ ...old, sourceReferences: [...(old.sourceReferences ?? []), reference],
            revision: old.revision + 1, updatedAt: timestamp() }, old);
        } else if (change.type === "remove-source") {
          const old = existing(change.noteId, change.expectedRevision);
          if (!old.sourceReferences?.some((reference) => reference.id === change.referenceId))
            throw new Error("来源引用不存在");
          const references = old.sourceReferences.filter((reference) => reference.id !== change.referenceId);
          noteDocument(old.document, references);
          remember({ ...old, sourceReferences: references,
            revision: old.revision + 1, updatedAt: timestamp() }, old);
        } else if (change.type === "delete-note") {
          const old = existing(change.noteId, change.expectedRevision);
          remember({ ...old, deletedAt: timestamp(), updatedAt: timestamp(), revision: old.revision + 1 }, old);
          workspace = this.removePlacement(bookId, old.id, workspace);
        } else if (change.type === "restore-note") {
          const old = existing(change.noteId, change.expectedRevision, true);
          remember({ ...old, deletedAt: undefined, updatedAt: timestamp(), revision: old.revision + 1 }, old);
          workspace = this.restorePlacement(bookId, old.id, workspace);
        } else if (change.type === "workspace") {
          workspace = applyWorkspaceChanges(workspace, change.changes);
        } else {
          const target = this.library.store.getForBook<BookCommandReceipt>("book-command", `${bookId}:${change.targetCommandId}`, bookId);
          if (!target || target.contentVersion !== initial.revision)
            throw new WorkspaceConflict("已有后续修改，无法直接撤销此命令");
          workspace = applyWorkspaceChanges(workspace, target.inverse.workspace);
          for (const inverse of target.inverse.notes) {
            const old = this.note(bookId, inverse.id);
            const expected = target.noteChanges.find((delta) => delta.after.id === inverse.id)?.after.revision;
            if (old.revision !== expected)
              throw new WorkspaceConflict("笔记已变化，无法直接撤销此命令", "NOTE_REVISION_CONFLICT");
            const restored = inverse.before ? { ...inverse.before, revision: old.revision + 1,
              updatedAt: timestamp() } : { ...old, deletedAt: timestamp(), revision: old.revision + 1,
              updatedAt: timestamp() };
            remember(restored, old);
          }
        }
      }
      const annotationChanges: BookCommandReceipt["annotationChanges"] = [];
      for (const [id, after] of changed) {
        const prior = before.get(id);
        if (!after.annotationId || Boolean(prior?.deletedAt) === Boolean(after.deletedAt)) continue;
        const annotation = this.library.store.getForBook<Annotation>("annotation", after.annotationId, bookId);
        if (!annotation) throw new Error("关联的原文标记不存在");
        if (after.deletedAt) {
          if (annotation.noteId !== id) continue;
        } else if (annotation.deletedAt) {
          continue;
        } else if (annotation.noteId && annotation.noteId !== id) {
          throw new Error("原文标记已关联其他笔记，无法恢复");
        }
        const updated = { ...annotation, noteId: after.deletedAt ? undefined : id,
          revision: annotation.revision + 1, updatedAt: timestamp() };
        this.library.store.put("annotation", annotation.id, bookId, updated);
        annotationChanges.push({ before: annotation, after: updated });
      }
      const workspaceChanges = workspaceDifference(initial, workspace);
      const inverse = { workspace: workspaceDifference(workspace, initial),
        notes: [...before].map(([id, prior]) => ({ id, before: prior })) };
      receipt = { bookId, commandId: command.commandId, payloadHash: hash,
        previousVersion: initial.revision, contentVersion: initial.revision + 1,
        changes: command.changes, workspaceChanges, annotationChanges,
        noteChanges: [...changed].map(([id, after]) => ({ before: before.get(id), after })), inverse };
      if (Buffer.byteLength(JSON.stringify(receipt), "utf8") > 8 * 1024 * 1024 - 1024)
        throw new Error("本次操作的撤销内容超过 8 MiB，请分批操作；内容未修改");
      this.workspaces.save(bookId, workspace, true);
      this.library.store.put("book-command", `${bookId}:${command.commandId}`, bookId, receipt);
      changedNotes = [...changed.values()];
      changedAnnotations = annotationChanges.map((change) => change.after);
    });
    for (const note of changedNotes)
      this.library.emit({ type: "note", bookId, taskId: note.id, data: structuredClone(note) });
    for (const annotation of changedAnnotations)
      this.library.emit({ type: "annotation", bookId, taskId: annotation.id, data: structuredClone(annotation) });
    if (changedNotes.length || receipt.workspaceChanges.length)
      this.library.emit({ type: "workspace", bookId, taskId: command.commandId });
    return receipt;
  }
}
