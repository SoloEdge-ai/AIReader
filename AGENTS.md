# AIReader engineering rules

- All changes use codex/* branches, PR checks, and squash merge. Never push main.
- Keep the renderer unprivileged. Core owns data, retrieval, and all Codex operations.
- Scope all book operations by book ID; freeze reading state when sending a question.
- Never commit user PDFs, credentials, generated book content, or local databases.
- Test observable behavior at Core HTTP, context assembly, PDF extraction, and Codex protocol boundaries. Mock only the external Codex process.
- Run typecheck and relevant tests before a PR. Portable EXE builds are required.
