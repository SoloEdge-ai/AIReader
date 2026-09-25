import type { ChatTurn } from "../../../../../packages/protocol/src/chat";

export interface ObservedTurn {
  sequence: number;
  turn: ChatTurn;
}

export function upsertTurn(
  turns: ChatTurn[],
  incoming: ChatTurn,
  bookId: string,
  sessionId: string,
): ChatTurn[] {
  if (incoming.bookId !== bookId || incoming.sessionId !== sessionId) return turns;
  const index = turns.findIndex((turn) => turn.id === incoming.id);
  if (index < 0) return [...turns, incoming];
  const next = turns.slice();
  next[index] = incoming;
  return next;
}

/** Apply only events newer than the HTTP request, so a delayed snapshot cannot rewind streaming output. */
export function mergeTurnSnapshot(
  snapshot: ChatTurn[],
  observed: ObservedTurn[],
  startedAt: number,
  bookId: string,
  sessionId: string,
): ChatTurn[] {
  return observed.reduce(
    (turns, event) => event.sequence > startedAt
      ? upsertTurn(turns, event.turn, bookId, sessionId)
      : turns,
    snapshot.filter((turn) => turn.bookId === bookId && turn.sessionId === sessionId),
  );
}
