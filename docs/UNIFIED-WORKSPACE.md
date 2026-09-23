# Unified workspace — accepted design and delivery slices

Baseline: `358a9f8bfebb5bea5a52aa36bc5fbe48def132e7` (current main).
The user accepted the interactive workspace prototype on 2026-09-23.
Rewrite production code; do not merge the demonstration implementation or content.

## Slice 1 — real document and durable spatial cards

- A single scrollable world contains the existing real PDF and movable/resizable cards.
  No reading/organizing mode split. Existing PDF selection, annotations and chat remain usable.
- Create an excerpt from the current PDF selection, preserving PDF-space anchors and fingerprint.
  Excerpt text is immutable after creation; a separate personal comment remains editable.
- Create/edit personal note cards. Connect two cards with a named relationship; remove cards and
  connections; undo edits. Source navigation can return to the previous workspace viewport.
- PDF zoom also scales the cards and connections; location is stored in document-independent
  workspace units. Cards cannot disappear through unsupported negative coordinates.
- Persist per-book cards and links in Core-owned SQLite records. Validate bounded input, foreign
  book references, fingerprints, page ranges and dangling links. Reject stale revisions rather
  than overwrite concurrent edits. Restart restores content and geometry.
- Debounced saves expose saving/saved/failure states, retry, and block leaving on failure.
  Original PDF, existing annotations, notes and chats are unchanged. No new model upload.
- HTTP tests cover restart, book isolation, malformed content and stale saves. Typecheck,
  browser interaction checks and Windows portable build before PR.

## Remaining accepted slices (not claimed complete by slice 1)

2. Page-space text and pen strokes, colors/width, stroke erasing and undo; spatial grouping,
   multi-selection, comparison, direct source tethers, keyboard/touch refinement.
3. Explicit removable AI material tray: original excerpts vs personal notes/relations vs cropped
   annotated page regions. Freeze on add and on send, deduplicate, never silently upload the whole
   board; persist turn provenance and validate at Core/Codex boundaries.

Existing individual notes remain in the Notes panel during this incremental rollout. Spatial
note cards are explicitly personal material, not PDF citations. No automatic migration/removal
of old notes and no production data copied into tests.
