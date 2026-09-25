# Unified workspace — accepted design and delivery slices

> 历史记录（截至 2026-09-24），不是当前实施规范。请从[当前文档入口](../../README.md)开始；下文保留当时的设计、结果及限制。

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
- Ctrl + mouse wheel zooms the whole workspace around the cursor, prevents browser zoom,
  and respects the existing 40%–300% limits. Unmodified wheel still scrolls normally.
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

## Refinement accepted after v0.1.58

- The continuous PDF column is the fixed reading axis in a larger shared world, with usable space
  on both sides. Pan the viewport, not the PDF object. Cards dock outside the document column;
  rotating the document also reconciles overlapping cards. Migrate the previous x=40 layout
  into the centered coordinate system while preserving relative card placement and dimensions.
- Left drag on the PDF selects text or performs the chosen annotation action. Hold right mouse
  and move at least 5 CSS pixels to pan; a stationary right click keeps normal context-menu behavior.
  Blank-canvas left drag, middle drag, and Space+left drag also pan. Editors retain normal typing.
- Restore the accepted prototype's restrained paper cards, subtle selection, borderless editors,
  source footers, curved relationships and compact floating toolbar. Card actions appear on hover,
  selection or keyboard focus; screen-sized controls remain usable during world zoom. Light/dark
  themes leave PDF colors unchanged. Existing manually resized cards are not resized automatically.
- Persist each book's viewport and zoom alongside its cards and links. Locate document restores
  the current page to the center; overview zooms out within the existing 40–300% reader range and
  lists all cards, so distant material in long books remains reachable without shrinking text to dots.
- Download a `.aireader` ZIP from the workspace toolbar; restore from the library. Include the
  exact PDF, spatial graph, camera, reader preferences, bookmarks, annotations, rich notes, and
  their referenced images/provenance. Restore as a separate book copy without overwriting existing
  user data. Validate schema/version, PDF/image hashes, bounded decompression, safe ZIP paths,
  book references, rich text and all graph endpoints before restoring. Preserve referenced deleted
  note/annotation markers to avoid reviving deleted content or breaking active references.
- Packages do not contain accounts, executable files, personal configuration or full chat history.
  Existing AI answer notes retain their frozen sources and attached images. Freehand ink remains
  part of the next accepted slice, and will need a schema/version extension before being packaged.
- Verify at the agreed Core HTTP and real PDF/renderer boundaries: restart, independent restore,
  unsafe/malformed archives, account-free answer-note restoration, left selection vs right pan,
  docking, keyboard operations, zoom anchoring and normal reading/annotation regression.
