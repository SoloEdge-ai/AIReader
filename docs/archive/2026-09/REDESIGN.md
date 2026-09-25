# Immersive reading and independent account redesign

> 历史记录（截至 2026-09-24），不是当前实施规范。请从[当前文档入口](../../README.md)开始；下文保留当时的设计、结果及限制。

Accepted scope: technical books and papers; neutral desktop UI, system/light/dark themes without PDF inversion; real library thumbnails, recent reading, search and import. Navigation and side panel start closed and persist per book. The side panel contains chat and notes, with an overlay on narrow windows. No marketing slogans or constant engineering status.

Chat has visible dynamic model/reasoning selectors, persistent choices, frozen per-turn and per-index-job settings, session history/rename and safe Markdown/code/math with validated citations. A managed pinned Codex 0.155.1 Windows x64 runtime is downloaded from official npm with a bundled checksum, cancellation, safe extraction and retained previous version. Credentials are isolated in AIReader CODEX_HOME with file ACLs, never copied from system Codex. Browser login/cancel/logout must not affect other clients. No CLI prerequisite. Reading and notes work offline and signed out.

Annotations: highlight, underline, strikeout, sticky note and rectangular image excerpt; colors, edit/delete/undo. Anchors use document fingerprint and PDF coordinates across pages, not index passage IDs. Tiptap WYSIWYG notes support paragraphs/headings/lists/quotes/links/emphasis/code; auto-save must preserve drafts on failure and flush before book changes. Per-book note search/type/color filters and source navigation. Notes and image excerpts stay local and are not AI evidence. No PDF rewrite, export, OCR, handwriting, sync or sandbox repair.

Data migration backs up before schema changes and keeps existing books/bookmarks/progress/chat. Rich text and assets are validated at Core; all book requests/events are scoped. Runtime and account are global. Three PRs: UI, independent account/model control, annotations/notes + acceptance. Each produces a Windows portable artifact and merges only through protected PR/squash.

Acceptance: generated fixtures plus local 516-page book; light/dark, window sizes and 100/150/200% DPI; rotation/multi-page/double-column/scan annotations; restart/reindex persistence; IME/keyboard/focus/undo/save failure; model pagination/effort/restart/invalid choice; clean runtime download/cancel/corruption/retry and isolated auth; EXE/checksum/data migration. CI uses fake Codex and generated PDFs. Real login requires the user's browser authorization.
