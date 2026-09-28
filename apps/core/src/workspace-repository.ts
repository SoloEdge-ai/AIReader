import type { DatabaseSync } from "node:sqlite";
import {
  WorkspaceSchema,
  WorkspaceCameraSchema,
  type BookWorkspace,
  type WorkspaceCamera,
} from "../../../packages/protocol/src/workspace";
import {
  WorkspaceReceiptSchema,
  type WorkspaceReceipt,
} from "../../../packages/protocol/src/workspace-commands";

export const workspaceTables = `
CREATE TABLE workspace_books(book_id TEXT PRIMARY KEY,revision INTEGER NOT NULL,format_version INTEGER NOT NULL,layout_version INTEGER NOT NULL);
CREATE TABLE workspace_entities(
  book_id TEXT NOT NULL REFERENCES workspace_books(book_id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK(kind IN ('card','object')),id TEXT NOT NULL,ordinal INTEGER NOT NULL,value TEXT NOT NULL,
  PRIMARY KEY(book_id,kind,id));
CREATE INDEX workspace_entity_order ON workspace_entities(book_id,kind,ordinal);
CREATE TABLE workspace_groups(
  book_id TEXT NOT NULL REFERENCES workspace_books(book_id) ON DELETE CASCADE,
  id TEXT NOT NULL,ordinal INTEGER NOT NULL,value TEXT NOT NULL,
  PRIMARY KEY(book_id,id));
CREATE INDEX workspace_group_order ON workspace_groups(book_id,ordinal);
CREATE TABLE workspace_links(
  book_id TEXT NOT NULL REFERENCES workspace_books(book_id) ON DELETE CASCADE,
  id TEXT NOT NULL,ordinal INTEGER NOT NULL,from_id TEXT NOT NULL,to_id TEXT NOT NULL,label TEXT NOT NULL,directed INTEGER,
  PRIMARY KEY(book_id,id));
CREATE TABLE workspace_views(
  book_id TEXT PRIMARY KEY REFERENCES workspace_books(book_id) ON DELETE CASCADE,x REAL NOT NULL,y REAL NOT NULL,zoom REAL NOT NULL);
CREATE TABLE workspace_receipts(
  book_id TEXT NOT NULL REFERENCES workspace_books(book_id) ON DELETE CASCADE,
  command_id TEXT NOT NULL,payload_hash TEXT NOT NULL,value TEXT NOT NULL,PRIMARY KEY(book_id,command_id));
`;

export interface WorkspaceAssetRecord {
  id: string;
  bookId: string;
  width: number;
  height: number;
  bytes: number;
  sha256: string;
}

export interface LegacyWorkspaceReceipt {
  version: number;
  payloadHash?: string;
}

/** Owns workspace SQL. Public snapshots are projections, never a persisted whole-book JSON. */
export class WorkspaceRepository {
  constructor(private readonly db: DatabaseSync) {}

  /** The pre-v2 command and immutable asset metadata still live in records. */
  private record<T>(kind: string, id: string, bookId: string): T | undefined {
    const row = this.db.prepare("SELECT value FROM records WHERE kind=? AND id=? AND book_id=?")
      .get(kind, id, bookId) as { value: string } | undefined;
    return row ? JSON.parse(row.value) as T : undefined;
  }
  private saveRecord(kind: string, id: string, bookId: string, value: unknown) {
    this.db.prepare("INSERT OR REPLACE INTO records VALUES(?,?,?,?)")
      .run(kind, id, bookId, JSON.stringify(value));
  }
  legacyReceipt(bookId: string, commandId: string): LegacyWorkspaceReceipt | undefined {
    return this.record("workspace-command", `${bookId}:${commandId}`, bookId);
  }
  saveLegacyReceipt(bookId: string, commandId: string, receipt: LegacyWorkspaceReceipt) {
    this.saveRecord("workspace-command", `${bookId}:${commandId}`, bookId, receipt);
  }
  asset(bookId: string, assetId: string): WorkspaceAssetRecord | undefined {
    return this.record("workspace-asset", assetId, bookId);
  }
  saveAsset(record: WorkspaceAssetRecord) {
    // Resource IDs are immutable and globally unique; never replace another book's registration.
    this.db.prepare("INSERT INTO records VALUES(?,?,?,?)")
      .run("workspace-asset", record.id, record.bookId, JSON.stringify(record));
  }
  pageBounds(bookId: string, page: number): [number, number, number, number] | undefined {
    return this.record("pdf-page-bounds", `${bookId}:${page}`, bookId);
  }
  savePageBounds(bookId: string, page: number, bounds: [number, number, number, number]) {
    this.saveRecord("pdf-page-bounds", `${bookId}:${page}`, bookId, bounds);
  }

  get(bookId: string): BookWorkspace | undefined {
    const meta = this.db
      .prepare("SELECT * FROM workspace_books WHERE book_id=?")
      .get(bookId);
    if (!meta) return undefined;
    const entities = this.db
      .prepare(
        "SELECT kind,value FROM workspace_entities WHERE book_id=? ORDER BY ordinal",
      )
      .all(bookId);
    const links = this.db
      .prepare("SELECT * FROM workspace_links WHERE book_id=? ORDER BY ordinal")
      .all(bookId);
    const groups = this.db
      .prepare("SELECT value FROM workspace_groups WHERE book_id=? ORDER BY ordinal")
      .all(bookId);
    return WorkspaceSchema.parse({
      bookId,
      revision: meta.revision,
      formatVersion: meta.format_version,
      layoutVersion: meta.layout_version,
      cards: entities
        .filter((row) => row.kind === "card")
        .map((row) => JSON.parse(String(row.value))),
      objects: entities
        .filter((row) => row.kind === "object")
        .map((row) => JSON.parse(String(row.value))),
      groups: groups.map((row) => JSON.parse(String(row.value))),
      links: links.map((row) => ({
        id: row.id,
        from: row.from_id,
        to: row.to_id,
        label: row.label,
        ...(row.directed === null ? {} : { directed: Boolean(row.directed) }),
      })),
      camera: this.camera(bookId),
    });
  }

  save(input: BookWorkspace) {
    this.saveValidated(WorkspaceSchema.parse(input));
  }

  /** Only for Core paths that parsed the complete snapshot before the same transaction. */
  saveValidated(value: BookWorkspace) {
    // SAVEPOINT also composes with a surrounding Core command/archive transaction.
    this.db.exec("SAVEPOINT workspace_write");
    try {
      this.db
        .prepare(
          `INSERT INTO workspace_books VALUES(?,?,?,?) ON CONFLICT(book_id)
        DO UPDATE SET revision=excluded.revision,format_version=excluded.format_version,layout_version=excluded.layout_version`,
        )
        .run(
          value.bookId,
          value.revision,
          value.formatVersion,
          value.layoutVersion,
        );
      this.entities(value.bookId, "card", value.cards);
      this.entities(value.bookId, "object", value.objects);
      this.groups(value.bookId, value.groups);
      const existing = new Map(
        this.db
          .prepare(
            "SELECT id,ordinal,from_id,to_id,label,directed FROM workspace_links WHERE book_id=?",
          )
          .all(value.bookId)
          .map((row) => [String(row.id), row]),
      );
      const write = this.db
        .prepare(`INSERT INTO workspace_links VALUES(?,?,?,?,?,?,?) ON CONFLICT(book_id,id)
        DO UPDATE SET ordinal=excluded.ordinal,from_id=excluded.from_id,to_id=excluded.to_id,label=excluded.label,directed=excluded.directed`);
      for (const [ordinal, link] of value.links.entries()) {
        const old = existing.get(link.id),
          directed = link.directed === undefined ? null : Number(link.directed);
        if (
          !old ||
          old.ordinal !== ordinal ||
          old.from_id !== link.from ||
          old.to_id !== link.to ||
          old.label !== link.label ||
          old.directed !== directed
        )
          write.run(
            value.bookId,
            link.id,
            ordinal,
            link.from,
            link.to,
            link.label,
            directed,
          );
        existing.delete(link.id);
      }
      const remove = this.db.prepare(
        "DELETE FROM workspace_links WHERE book_id=? AND id=?",
      );
      for (const id of existing.keys()) remove.run(value.bookId, id);
      this.db.exec("RELEASE workspace_write");
    } catch (error) {
      this.db.exec("ROLLBACK TO workspace_write; RELEASE workspace_write");
      throw error;
    }
  }

  private entities(
    bookId: string,
    kind: "card" | "object",
    values: { id: string }[],
  ) {
    const write = this.db
      .prepare(`INSERT INTO workspace_entities VALUES(?,?,?,?,?) ON CONFLICT(book_id,kind,id)
      DO UPDATE SET ordinal=excluded.ordinal,value=excluded.value`);
    const remove = this.db.prepare(
      "DELETE FROM workspace_entities WHERE book_id=? AND kind=? AND id=?",
    );
    this.synchronizeRows(values,
      this.db.prepare("SELECT id,ordinal,value FROM workspace_entities WHERE book_id=? AND kind=?")
        .all(bookId, kind),
      (value, ordinal, encoded) => write.run(bookId, kind, value.id, ordinal, encoded),
      (id) => remove.run(bookId, kind, id));
  }

  private groups(bookId: string, values: { id: string }[]) {
    const write = this.db.prepare(`INSERT INTO workspace_groups VALUES(?,?,?,?) ON CONFLICT(book_id,id)
      DO UPDATE SET ordinal=excluded.ordinal,value=excluded.value`);
    const remove = this.db.prepare("DELETE FROM workspace_groups WHERE book_id=? AND id=?");
    this.synchronizeRows(values,
      this.db.prepare("SELECT id,ordinal,value FROM workspace_groups WHERE book_id=?").all(bookId),
      (value, ordinal, encoded) => write.run(bookId, value.id, ordinal, encoded),
      (id) => remove.run(bookId, id));
  }

  private synchronizeRows(
    values: { id: string }[],
    rows: Record<string, unknown>[],
    write: (value: { id: string }, ordinal: number, encoded: string) => void,
    remove: (id: string) => void,
  ) {
    const existing = new Map(rows.map((row) => [String(row.id), row]));
    for (const [ordinal, value] of values.entries()) {
      const encoded = JSON.stringify(value), old = existing.get(value.id);
      if (!old || Number(old.ordinal) !== ordinal || String(old.value) !== encoded)
        write(value, ordinal, encoded);
      existing.delete(value.id);
    }
    for (const id of existing.keys()) remove(id);
  }

  camera(bookId: string): WorkspaceCamera | undefined {
    const row = this.db
      .prepare("SELECT x,y,zoom FROM workspace_views WHERE book_id=?")
      .get(bookId);
    return row ? WorkspaceCameraSchema.parse(row) : undefined;
  }
  saveCamera(bookId: string, input: WorkspaceCamera) {
    const view = WorkspaceCameraSchema.parse(input);
    this.db.exec("SAVEPOINT workspace_view");
    try {
      this.db
        .prepare("INSERT OR IGNORE INTO workspace_books VALUES(?,0,5,3)")
        .run(bookId);
      this.db
        .prepare(
          `INSERT INTO workspace_views VALUES(?,?,?,?) ON CONFLICT(book_id)
        DO UPDATE SET x=excluded.x,y=excluded.y,zoom=excluded.zoom`,
        )
        .run(bookId, view.x, view.y, view.zoom);
      this.db.exec("RELEASE workspace_view");
    } catch (error) {
      this.db.exec("ROLLBACK TO workspace_view; RELEASE workspace_view");
      throw error;
    }
  }
  receipt(bookId: string, commandId: string): WorkspaceReceipt | undefined {
    const row = this.db
      .prepare(
        "SELECT value FROM workspace_receipts WHERE book_id=? AND command_id=?",
      )
      .get(bookId, commandId);
    return row
      ? WorkspaceReceiptSchema.parse(JSON.parse(String(row.value)))
      : undefined;
  }
  saveReceipt(receipt: WorkspaceReceipt) {
    const value = WorkspaceReceiptSchema.parse(receipt);
    this.db
      .prepare("INSERT INTO workspace_receipts VALUES(?,?,?,?)")
      .run(
        value.bookId,
        value.commandId,
        value.payloadHash,
        JSON.stringify(value),
      );
  }
  remove(bookId: string) {
    this.db.prepare("DELETE FROM workspace_books WHERE book_id=?").run(bookId);
  }
}
