# Explicit question sources and public reasoning summaries

Baseline: main d14d4b409183f585230f891860f6e3abeb99eb62.

User request: show the passage being asked about in the composer, allow removing
or reselecting it, distinguish temporary PDF selection from attached question
material, and make answers more explainable with a Codex-like thinking display.

## Accepted behavior

- Temporary selections are candidates, not silently attached evidence. Explicit
  toolbar question actions, choosing selection scope, or Add/Replace attach a
  copy. New selections never silently replace the current attachment.
- The composer card shows pages, source text, full-text expansion, removal and
  reselection guidance. Removal keeps the question and returns to reading scope.
  Non-selection scopes do not send a hidden attachment.
- Draft question/scope/attachment are book-and-session scoped in memory. They
  survive sidebar close and navigation within this app run, not app restart.
  Sending freezes the selected source in the turn; historical questions expose
  that source. Successful submission clears an unchanged draft, not newer edits.
- Display service-provided public reasoning summaries separately from answers
  and source evidence, stream them, allow collapse, and persist them with turns.
  The panel defaults open while running and closed afterward unless the user
  chooses otherwise. Cancellation retains received summary text.
- Request `summary: auto` only for interactive answers. Never collect or persist
  raw `item/reasoning/textDelta` or reasoning item `content`. Do not manufacture
  summaries when the service returns none. Old turns without the optional field
  remain readable. Summaries do not enter later conversation context or citations.
- Evidence disclosure reports actual supplied passage count/coverage and allows
  inspection; supplied passages are not presented as independently verified claims.
- No account, sandbox, PDF mutation, OCR or cloud-sync changes.

## Protocol source and verification

[Official App Server documentation](https://learn.chatgpt.com/docs/app-server)
documents `turn/start.summary`, summary deltas and authoritative completed items.
The installed fixed 0.155.1 binary's generated TypeScript protocol was also checked.
Reasoning collection is scoped by thread/turn/item/summary index and bounded to
32,000 characters, 64 items and 64 sections per item.

Observable tests use real Core HTTP, PDF/renderer interactions and a fake external
Codex process only: stream/final replacement, foreign-event rejection, no raw
reasoning storage, omitted summary, cancellation/restart, no summary replay into
prompts, explicit add/replace/remove, draft isolation, HTTP payload and old reader
regressions. CI runs packaged selection acceptance and the full chat UI suite.
