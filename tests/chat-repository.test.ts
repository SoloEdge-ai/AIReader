import { test, expect } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ChatTurn } from "../packages/protocol/src/chat";
import { ChatRepository } from "../apps/core/src/chat-repository";
import { Storage } from "../apps/core/src/storage";

test("chat records are book scoped and a failed material commit rolls back the turn", async () => {
  const directory = await mkdtemp(join(tmpdir(), "aireader-chat-repository-"));
  const store = new Storage(directory);
  const repository = new ChatRepository(store);
  try {
    repository.saveSession("book-a", { id: "same", title: "A", updatedAt: "2026-01-01" });
    repository.saveSession("book-b", { id: "same", title: "B", updatedAt: "2026-01-02" });
    repository.saveMemory("book-a", "same", { goal: "A goal", text: "A memory" });
    repository.saveMemory("book-b", "same", { goal: "B goal", text: "B memory" });
    expect(repository.sessions("book-a").map((session) => session.title)).toEqual(["A"]);
    expect(repository.memory("book-a", "same")?.text).toBe("A memory");
    expect(repository.memory("book-b", "same")?.text).toBe("B memory");

    const turn: ChatTurn = {
      id: "turn-a", bookId: "book-a", sessionId: "same", question: "Question",
      answer: "", status: "running", createdAt: "2026-01-03",
      context: {
        estimatedTokens: 0, budget: 12000, coverage: "", memory: "", recent: "",
        navigation: "", evidence: [],
        reading: { bookId: "book-a", page: 1, selection: "", scope: "auto" },
      },
      citations: [], tools: [],
    };
    expect(() => repository.createTurn(turn, () => { throw new Error("material failed"); }))
      .toThrow("material failed");
    expect(repository.turns("book-a")).toEqual([]);
    repository.createTurn(turn, () => {
      store.put("material-commit", "material-a", "book-a", { turnId: turn.id });
    });
    expect(repository.turns("book-a").map((item) => item.id)).toEqual(["turn-a"]);
    expect(repository.turns("book-b")).toEqual([]);
    expect(store.get("material-commit", "material-a")).toEqual({ turnId: turn.id });
  } finally {
    store.close();
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
