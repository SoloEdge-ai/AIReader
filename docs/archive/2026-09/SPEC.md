# AIReader v1

> 历史记录（截至 2026-09-24），不是当前实施规范。请从[当前文档入口](../../README.md)开始；下文保留当时的设计、结果及限制。

Windows 11 x64 portable PDF reader. Public SoloEdge-ai/AIReader; protected main, PR-only squash merges. Each PR builds an EXE; each merged change publishes a release and SHA256SUMS.

Electron + React/TypeScript/Vite + independent Core, PDF.js, SQLite/FTS5. Browser debugging and native desktop share the same HTTP/WebSocket protocol. Data lives under LOCALAPPDATA/AIReader.

Import copied and fingerprinted text PDFs, read immediately, parse in background. Continuous pages, text selection, outline, zoom, page labels, bookmarks, persisted progress and Chinese/English search. Scans remain readable with explicit coverage warnings. No OCR, cross-book search or cloud synchronization.

Freeze book/page/selection on send. Ground answers in validated source IDs that jump to pages and highlights. Persist chat locally but create a fresh Codex thread for each question. Bound application input to approximately 12000 tokens. Display context and coverage, never misrepresent partial indexing as complete. Semantic indexing is on demand, full indexing is opt-in; pause/cancel/retry/restart supported.

Reuse installed Codex >=0.155.1 and existing ChatGPT credentials through App Server stdio. No credential copying or shared logout. Disable unsupported AI without breaking reading. Per-book tool workspaces, original PDF read-only, no other books/secrets/network or escalation. At most 8 tool calls per turn. Tools stay disabled unless sandbox isolation passes probes. Show commands, bounded outputs, generated files and cancellation.

Acceptance: Windows11 normal-user launch, no-Codex offline reading, bilingual/scan/malformed PDF behavior, valid citation navigation, switch-book isolation, 50-turn bounded context, resumable indexing, retained data after upgrade, denied tool access outside workspace, artifact/release traceability. User PDF is local-only; CI uses generated fixtures and a simulated Codex protocol endpoint.
