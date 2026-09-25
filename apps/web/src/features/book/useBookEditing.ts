import { useEffect, useMemo } from "react";
import { BookEditingSession } from "./BookEditingSession";

/** One book-scoped lifecycle; child views only subscribe to their part of the session. */
export function useBookEditing(bookId?: string): BookEditingSession {
  const session = useMemo(() => new BookEditingSession(bookId), [bookId]);
  useEffect(() => {
    session.activate();
    const warn = (event: BeforeUnloadEvent) => {
      if (session.isDirty()) { event.preventDefault(); event.returnValue = ""; }
    };
    window.addEventListener("beforeunload", warn);
    return () => {
      session.dispose();
      window.removeEventListener("beforeunload", warn);
    };
  }, [session]);
  return session;
}
