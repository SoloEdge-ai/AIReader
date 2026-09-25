import type { ChatTurn } from "../../../packages/protocol/src/chat";
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

  saveTurn(turn: ChatTurn): void {
    this.store.put("turn", turn.id, turn.bookId, turn);
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
