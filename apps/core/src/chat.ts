import { randomUUID } from "node:crypto";
import type {
  ChatTurn,
  ReadingSnapshot,
  ChatImageInput,
} from "../../../packages/protocol/src";
import { ChatImages } from "./chat-images";
import { Library } from "./library";
import { CodexAdapter } from "./codex";
import { buildContext, renderPrompt, validateCitations } from "./context";
export class ChatService {
  readonly images: ChatImages;
  sessions(bookId: string) {
    const map = new Map<
      string,
      { id: string; title: string; updatedAt: string }
    >();
    for (const turn of this.list(bookId))
      map.set(turn.sessionId, {
        id: turn.sessionId,
        title: map.get(turn.sessionId)?.title ?? turn.question.slice(0, 60),
        updatedAt: turn.createdAt,
      });
    for (const session of this.library.store.list<{
      id: string;
      title: string;
      updatedAt: string;
    }>("session", bookId)) {
      const previous = map.get(session.id);
      map.set(session.id, {
        ...session,
        updatedAt: previous?.updatedAt ?? session.updatedAt,
      });
    }
    return [...map.values()].sort((a, b) =>
      b.updatedAt.localeCompare(a.updatedAt),
    );
  }
  createSession(bookId: string) {
    this.library.book(bookId);
    const session = {
      id: randomUUID(),
      title: "新会话",
      updatedAt: new Date().toISOString(),
    };
    this.library.store.put(
      "session",
      bookId + ":" + session.id,
      bookId,
      session,
    );
    return session;
  }
  renameSession(bookId: string, id: string, title: string) {
    const session = this.sessions(bookId).find((s) => s.id === id);
    if (!session) throw new Error("会话不存在");
    session.title = title;
    this.library.store.put("session", bookId + ":" + id, bookId, session);
    return session;
  }
  private running = new Map<string, AbortController>();
  private closed = false;
  constructor(
    readonly library: Library,
    readonly codex: CodexAdapter,
  ) {
    this.images = new ChatImages(library);
    for (const turn of library.store.list<ChatTurn>("turn"))
      if (turn.status === "running") {
        turn.status = "error";
        turn.error = "应用重启，上一轮已中断。";
        this.save(turn);
      }
  }
  list(bookId: string, sessionId?: string) {
    this.library.book(bookId);
    return this.library.store
      .list<ChatTurn>("turn", bookId)
      .filter((t) => !sessionId || t.sessionId === sessionId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }
  start(
    reading: ReadingSnapshot,
    question: string,
    sessionId: string,
    model?: string,
    effort?: string,
    imageInputs: ChatImageInput[] = [],
  ) {
    if (
      this.list(reading.bookId, sessionId).some((t) => t.status === "running")
    )
      throw new Error("请先停止当前回答。");
    const images = this.images.create(reading.bookId, imageInputs);
    let context: ReturnType<typeof buildContext>;
    try {
      context = buildContext(
        this.library,
        reading,
        question,
        sessionId,
        images,
      );
    } catch (error) {
      this.images.discard(reading.bookId, images);
      throw error;
    }
    const session = this.sessions(reading.bookId).find(
      (s) => s.id === sessionId,
    );
    if (session?.title === "新会话")
      this.renameSession(reading.bookId, sessionId, question.slice(0, 60));
    const turn: ChatTurn = {
      id: randomUUID(),
      images,
      model,
      effort,
      bookId: reading.bookId,
      sessionId,
      question,
      answer: "",
      reasoning: "",
      status: "running",
      createdAt: new Date().toISOString(),
      context,
      citations: [],
      tools: [],
    };
    const control = new AbortController();
    this.running.set(turn.id, control);
    try {
      this.save(turn);
    } catch (error) {
      this.running.delete(turn.id);
      this.images.discard(turn.bookId, images);
      throw error;
    }
    void this.codex
      .answer(renderPrompt(context, question, images), {
        imagePaths: images.map((image) =>
          this.images.asset(turn.bookId, image.id),
        ),
        signal: control.signal,
        model,
        effort,
        onText: (text) => {
          if (turn.status === "running") {
            turn.answer = text;
            this.save(turn);
          }
        },
        onReasoning: (text) => {
          if (turn.status === "running") {
            turn.reasoning = text;
            this.save(turn);
          }
        },
      })
      .then((result) => {
        if (control.signal.aborted || this.closed) return;
        Object.assign(turn, validateCitations(result.text, context), {
          status: "complete",
          usage: result.usage,
          reasoning: result.reasoning,
        });
        const key = turn.bookId + ":" + sessionId;
        const previous = this.library.store.get<{ goal?: string }>(
          "memory",
          key,
        );
        const recentQuestions = [
          ...this.list(turn.bookId, sessionId)
            .filter((t) => t.status === "complete")
            .slice(-5)
            .map((t) => t.question),
          question,
        ];
        this.library.store.put("memory", key, turn.bookId, {
          goal: previous?.goal ?? "",
          text: `学习目标：${previous?.goal ?? "尚未指定"}\n最近关注的问题（不代表已验证事实）：\n${recentQuestions.map((q) => q.slice(0, 180)).join("\n")}`.slice(
            0,
            1600,
          ),
        });
      })
      .catch((error) => {
        turn.status = control.signal.aborted ? "cancelled" : "error";
        turn.error = error.message;
      })
      .finally(() => {
        this.running.delete(turn.id);
        this.save(turn);
      });
    return turn;
  }
  private save(turn: ChatTurn) {
    if (this.closed) return;
    this.library.store.put("turn", turn.id, turn.bookId, turn);
    this.library.emit({
      type: "turn",
      bookId: turn.bookId,
      taskId: turn.id,
      data: turn,
    });
  }
  cancel(bookId: string, id: string) {
    const turn = this.list(bookId).find((t) => t.id === id);
    if (turn) this.running.get(id)?.abort();
  }
  cancelAll() {
    for (const control of this.running.values()) control.abort();
  }
  close() {
    this.cancelAll();
    this.closed = true;
  }
}
