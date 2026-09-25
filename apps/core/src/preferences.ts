import {
  ReaderPreferencesSchema,
  ToolPreferencesSchema,
  type ReaderPreferences,
  type ToolPreferences,
} from "../../../packages/protocol/src";
import type { Library } from "./library";

/** Owns the three persisted preference scopes and their protocol validation. */
export class Preferences {
  constructor(private readonly library: Library) {}

  reader(): ReaderPreferences {
    return ReaderPreferencesSchema.parse(this.library.store.get("setting", "reader") ?? {});
  }

  saveReader(value: unknown): ReaderPreferences {
    const preferences = ReaderPreferencesSchema.parse(value);
    this.library.store.put("setting", "reader", "", preferences);
    return preferences;
  }

  tools(): ToolPreferences {
    return ToolPreferencesSchema.parse(this.library.store.get("setting", "reader-tools") ?? {});
  }

  saveTools(value: unknown): ToolPreferences {
    const preferences = ToolPreferencesSchema.parse(value);
    this.library.store.put("setting", "reader-tools", "", preferences);
    return preferences;
  }

  forBook(bookId: string): ReaderPreferences {
    this.library.book(bookId);
    return ReaderPreferencesSchema.parse(this.library.store.get("reader", bookId) ?? {});
  }

  saveForBook(bookId: string, value: unknown): ReaderPreferences {
    this.library.book(bookId);
    const preferences = ReaderPreferencesSchema.parse(value);
    this.library.store.put("reader", bookId, bookId, preferences);
    return preferences;
  }
}
