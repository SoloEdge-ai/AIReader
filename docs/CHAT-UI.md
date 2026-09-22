# Approved chat UI refinement

Baseline: main e57442c. The maintainer approved the interactive conversation-style
preview on 2026-09-22, including its revised thick effort slider and the book icon.

- Neutral chat surface; compact underlined Questions / Notes tabs.
- Session title opens book-local history. New conversation is an icon button;
  rename lives in the session menu.
- User questions are short right-aligned bubbles. Answers use readable Markdown
  with no answer bubble, understated AIReader label, inline validated page citations,
  expandable source excerpts, copy and answer details.
- Composer is a single rounded surface with reading scope/page, text entry,
  stacked effort/model trigger and circular send/stop button.
- Model popover follows the reference: centered effort, quieter model name,
  reset to that model's default, 24 px gradient track and 28 px white thumb.
  Only actual service choices appear; one-effort models omit the slider.
- Preserve independent account, book scoping, frozen per-turn model/reading state,
  model persistence, safe Markdown and validated citations. No preview answers,
  fabricated models or usage values are shipped. Zoom remains unchanged.
- Use approved charcoal/ivory book and blue bookmark artwork for EXE, window and
  favicon, retaining transparent edges and including multi-size Windows ICO.

Acceptance: model-control browser interactions and real renderer/Core HTTP with
only the external Codex process mocked; full tests/typecheck, packaged desktop and
annotation regression. Light/dark, narrow popovers and keyboard/IME operation.
Deliver using codex branch, PR checks, portable EXE artifact and squash merge.
