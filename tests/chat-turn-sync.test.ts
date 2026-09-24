import { expect, test } from "vitest";
import type { ChatTurn } from "../packages/protocol/src/chat";
import { mergeTurnSnapshot, upsertTurn } from "../apps/web/src/features/chat/turn-sync";

const turn = (id: string, answer: string, sessionId = "session-a") => ({
  id,
  bookId: "book-a",
  sessionId,
  answer,
  status: "running" as const,
  createdAt: "2026-09-24T10:00:00.000Z",
}) as ChatTurn;

test("turn events update only their book and session without adding duplicates", () => {
  const first = turn("turn-a", "one");
  expect(upsertTurn([], first, "book-b", "session-a")).toEqual([]);
  expect(upsertTurn([], first, "book-a", "session-b")).toEqual([]);
  expect(upsertTurn([first], turn("turn-a", "one two"), "book-a", "session-a"))
    .toEqual([expect.objectContaining({ answer: "one two" })]);
});

test("events received while a snapshot is loading win over stale HTTP content", () => {
  const old = turn("turn-a", "one");
  const newAnswer = turn("turn-a", "one two");
  const added = turn("turn-b", "new");
  const result = mergeTurnSnapshot([old], [
    { sequence: 4, turn: old },
    { sequence: 6, turn: newAnswer },
    { sequence: 7, turn: added },
    { sequence: 8, turn: turn("turn-c", "other", "session-b") },
  ], 5, "book-a", "session-a");
  expect(result.map((item) => [item.id, item.answer])).toEqual([
    ["turn-a", "one two"],
    ["turn-b", "new"],
  ]);
});
