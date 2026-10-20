import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { MaterialReviewInputSchema, type MaterialReview, type MaterialReviewPlan, type QuestionSummary } from "../../../packages/protocol/src/questions";
import type { Note, QuestionMaterialSnapshot, QuestionMaterialTarget } from "../../../packages/protocol/src";
import type { Library } from "./library";
import type { QuestionMaterials } from "./question-materials";
import { QuestionRepository } from "./question-repository";
import { Workspaces, WorkspaceConflict } from "./workspace";

export class Questions {
  private readonly records: QuestionRepository;
  private readonly workspaces: Workspaces;
  constructor(private readonly library: Library, private readonly materials: QuestionMaterials) {
    this.records = new QuestionRepository(library.store);
    this.workspaces = new Workspaces(library);
  }
  private question(bookId: string, id: string) {
    this.library.book(bookId);
    const note = this.library.store.getForBook<Note>("note", id, bookId);
    if (!note?.question || note.deletedAt) throw new Error("问题不存在或不属于此书籍");
    return note;
  }
  list(): QuestionSummary[] {
    const books = new Map(this.library.books().map((book) => [book.id, book]));
    const placements = new Map(this.library.store.workspaces.notePlacements().map((card) => [`${card.bookId}:${card.noteId}`, card]));
    const visits = new Map(this.records.visits().map((visit) => [`${visit.bookId}:${visit.questionId}`, visit.openedAt]));
    return this.records.list().filter((note) => books.has(note.bookId)).map((note) => {
      const card = placements.get(`${note.bookId}:${note.id}`);
      return { id: note.id, bookId: note.bookId, bookTitle: books.get(note.bookId)!.title, title: note.title,
        status: note.question.status, updatedAt: note.updatedAt,
        lastOpenedAt: visits.get(`${note.bookId}:${note.id}`), materialCount: note.question.materialCount,
        conclusionTitle: this.records.title(note.bookId, note.question.currentConclusionId),
        cardId: card?.id, placed: card?.placed ?? false };
    }).sort((a, b) => (b.lastOpenedAt ?? "").localeCompare(a.lastOpenedAt ?? "") || b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
  }
  visit(bookId: string, id: string) { this.question(bookId, id); return this.records.visit(bookId, id); }
  private baseline(note: Note) {
    const question = note.question!;
    const fallback = [question.sourceTurnId, ...question.conclusionNoteIds.map((id) =>
      this.library.store.getForBook<Note>("note", id, note.bookId)?.origin?.turnId)].filter((id): id is string => Boolean(id));
    return this.library.chat.latestQuestionTurn(note.bookId, note.id, fallback);
  }
  plan(bookId: string, id: string, additionalIds: string[] = []): MaterialReviewPlan {
    additionalIds = [...new Set(additionalIds)];
    const note = this.question(bookId, id);
    if (!note.question!.sessionId) throw new Error("请先继续问题以创建恢复后的会话");
    const turn = this.baseline(note), baseline = turn?.context.materials ?? [];
    const previous = new Map(baseline.flatMap((material) => material.targets).map((target) => [target.id, target]));
    const workspace = this.workspaces.get(bookId);
    const extra: QuestionMaterialTarget[] = additionalIds.filter((id) => !previous.has(id)).map((id) => ({ id,
      kind: workspace.cards.some((card) => card.id === id) ? "card" : workspace.objects.some((object) => object.id === id) ? "object" :
        workspace.links.some((link) => link.id === id) ? "relation" :
          this.library.store.getForBook<Note>("note", id, bookId) ? "note" : "annotation" }));
    const all = [...previous.values(), ...extra];
    const selected = new Set(all.filter((target) => target.kind !== "relation").map((target) => target.id));
    for (const link of workspace.links) if (selected.has(link.from) && selected.has(link.to) && !all.some((target) => target.id === link.id))
      all.push({ kind: "relation", id: link.id });
    const resolved = this.materials.currentTargets(bookId, all);
    if (resolved.some((entry) => additionalIds.includes(entry.target.id) && !entry.available))
      throw new Error("新增材料不存在或不属于本书");
    return { bookId, questionId: id, questionRevision: note.revision, sessionId: note.question!.sessionId,
      workspaceRevision: workspace.revision, baselineTurnId: turn?.id, baseline,
      targets: resolved.map((entry) => ({ ...entry,
        title: entry.available ? entry.title : baseline.flatMap((snapshot) => snapshot.sections)
          .find((section) => section.targetId === entry.target.id)?.title || entry.title,
        added: !previous.has(entry.target.id) })) };
  }
  private content(snapshot: QuestionMaterialSnapshot, targetId: string) {
    return JSON.stringify(snapshot.sections.filter((section) => section.targetId === targetId).map((section) => ({
      kind: section.kind, title: section.title, text: section.text, anchors: section.anchors,
      provenance: section.provenance, relation: section.relation,
      images: section.imageIds?.map((id) => {
        const image = snapshot.images.find((image) => image.id === id)!;
        return { width: image.width, height: image.height, userRendered: image.userRendered,
          surface: image.surface, page: image.page, includesPdfBackground: image.includesPdfBackground,
          objectIds: image.objectIds?.slice().sort(), sha: createHash("sha256").update(readFileSync(
            this.materials.image(snapshot.bookId, snapshot.sessionId, snapshot.id, id))).digest("hex") };
      }),
    })));
  }
  async review(bookId: string, id: string, raw: unknown): Promise<MaterialReview> {
    const input = MaterialReviewInputSchema.parse(raw);
    this.question(bookId, id);
    const digest = createHash("sha256").update(JSON.stringify({ id, input })).digest("hex");
    const replay = () => {
      const prior = this.records.review(bookId, input.requestId);
      if (!prior) return;
      if (prior.digest !== digest) throw new Error("审阅标识已被其他内容使用");
      const latest = this.materials.get(bookId, prior.plan.sessionId, prior.latestId);
      if (latest.committedTurnId) throw new Error("这批审阅材料已经发送，请重新生成清单");
      const baseline = prior.plan.baselineTurnId ? this.library.chat.turn(bookId, prior.plan.baselineTurnId)?.context.materials ?? [] : [];
      return this.result({ ...prior.plan, baseline }, latest);
    };
    const previous = replay();
    if (previous) return previous;
    const plan = this.plan(bookId, id, input.targets.map((target) => target.id));
    const assertPlan = (value: MaterialReviewPlan) => {
      if (value.questionRevision !== input.questionRevision || value.baselineTurnId !== input.baselineTurnId ||
          value.workspaceRevision !== input.workspaceRevision)
        throw new WorkspaceConflict("问题或材料已变化，请重新生成差异清单");
    };
    assertPlan(plan);
    for (const target of input.targets) {
      const current = plan.targets.find((entry) => entry.target.id === target.id);
      if (!current?.available || current.target.kind !== target.kind || current.target.revision !== target.revision)
        throw new WorkspaceConflict("材料版本已变化，请重新生成差异清单");
    }
    const latest = await this.materials.create(bookId, { bookId, sessionId: plan.sessionId,
      requestId: input.requestId, workspaceRevision: input.workspaceRevision, targets: input.targets, previews: input.previews });
    const concurrent = replay();
    if (concurrent) return concurrent;
    assertPlan(this.plan(bookId, id, input.targets.map((target) => target.id)));
    const { baseline: _baseline, ...saved } = plan;
    const result = this.result(plan, latest);
    this.records.saveReview(bookId, input.requestId, { digest, latestId: latest.id, plan: saved });
    return result;
  }
  private result(plan: MaterialReviewPlan, latest: QuestionMaterialSnapshot): MaterialReview {
    const entries = plan.targets.map((entry) => {
      const targetId = entry.target.id;
      const old = plan.baseline.filter((snapshot) => snapshot.targets.some((target) => target.id === targetId));
      const before = old.flatMap((snapshot) => snapshot.sections.filter((section) => section.targetId === targetId));
      const after = latest.sections.filter((section) => section.targetId === targetId);
      const status = !old.length ? "added" : !entry.available ? "missing" : !after.length ? "removed" :
        old.map((snapshot) => this.content(snapshot, targetId)).join("\n") === this.content(latest, targetId) ? "unchanged" : "updated";
      return { targetId, title: after[0]?.title || before[0]?.title || entry.title, status, before, after } as const;
    }).filter((entry) => entry.before.length || entry.after.length);
    return { plan, latest, entries };
  }
}
