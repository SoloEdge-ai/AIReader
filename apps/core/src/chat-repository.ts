import type { ChatTurn, ToolRun } from "../../../packages/protocol/src/chat";
import { Storage } from "./storage";

export interface ChatSessionRecord {
  id: string;
  title: string;
  updatedAt: string;
}

export interface ChatMemoryRecord {
  goal?: string;
  text: string;
}

/** Book-scoped persistence for conversations; callers never compose record keys. */
export class ChatRepository {
  constructor(private readonly store: Storage) {}

  sessions(bookId: string): ChatSessionRecord[] {
    return this.store.list<ChatSessionRecord>("session", bookId);
  }

  saveSession(bookId: string, session: ChatSessionRecord): void {
    this.store.put("session", `${bookId}:${session.id}`, bookId, session);
  }

  turns(bookId: string, sessionId?: string): ChatTurn[] {
    return this.store.list<ChatTurn>("turn", bookId)
      .filter((turn) => !sessionId || turn.sessionId === sessionId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  interruptedTurns(): ChatTurn[] {
    return this.store.list<ChatTurn>("turn")
      .filter((turn) => turn.status === "running");
  }

  turn(bookId: string, turnId: string): ChatTurn | undefined {
    return this.store.getForBook<ChatTurn>("turn", turnId, bookId);
  }

  saveTurn(turn: ChatTurn): ChatTurn {
    // Stream callbacks hold the turn created at request start. Tool runs may
    // have changed its persisted row since then; that list has one owner.
    const current = this.store.get<ChatTurn>("turn", turn.id);
    if (current && (current.bookId !== turn.bookId || current.sessionId !== turn.sessionId))
      throw new Error("会话与书籍不匹配");
    const saved = current ? { ...turn, tools: current.tools } : turn;
    this.store.put("turn", turn.id, turn.bookId, saved);
    return saved;
  }

  appendTool(bookId: string, turnId: string, run: ToolRun): ChatTurn {
    const current = this.turn(bookId, turnId);
    if (!current || run.bookId !== bookId || run.turnId !== turnId)
      throw new Error("会话与书籍不匹配");
    if (current.tools.length >= 8) throw new Error("本轮已达到 8 次工具调用上限");
    const updated = { ...current, tools: [...current.tools, run] };
    this.store.put("turn", turnId, bookId, updated);
    return updated;
  }

  finishTool(bookId: string, turnId: string, run: ToolRun): ChatTurn {
    const current = this.turn(bookId, turnId);
    if (!current || run.bookId !== bookId || run.turnId !== turnId ||
      !current.tools.some((tool) => tool.id === run.id))
      throw new Error("工具记录不存在或不属于当前书籍会话");
    const updated = { ...current, tools: current.tools.map((tool) => tool.id === run.id ? run : tool) };
    this.store.put("turn", turnId, bookId, updated);
    return updated;
  }

  createTurn(turn: ChatTurn, commitMaterials: () => void): void {
    this.store.transaction(() => {
      this.saveTurn(turn);
      commitMaterials();
    });
  }

  memory(bookId: string, sessionId: string): ChatMemoryRecord | undefined {
    return this.store.get<ChatMemoryRecord>("memory", `${bookId}:${sessionId}`);
  }

  saveMemory(bookId: string, sessionId: string, memory: ChatMemoryRecord): void {
    this.store.put("memory", `${bookId}:${sessionId}`, bookId, memory);
  }
}
