# v1 review

Reviewed against the initial main commit c34e741, separately for engineering standards and accepted specification. Independent review agents were used according to the code-review skill.

## Standards

- Fixed stale book A bookmark/search responses appearing in book B: captured book identity, effect cancellation, request sequencing, and citation book guards.
- Fixed old Codex child exit invalidating a replacement process: child-identity guards and reconnect protocol test.
- Fixed directory downloads crashing Core: regular-file validation and stream error handlers; HTTP regression test.
- Added HTTP session/origin, invalid book snapshot, generated-download, and real stdio simulated-Codex tests.
- Follow-up found concurrent startup could skip initialization: connect now awaits the startup promise, tested with delayed initialization.

Standards findings: five concrete issues addressed. Possible divergent responsibilities in HTTP routing remain a non-blocking architecture improvement; behavior boundaries are tested.

## Specification

- Prioritized ranked hits before generic long-chapter filler; added regression with the only match at the end of a long chapter.
- Reserved current-page evidence for deictic questions after a real-book smoke test exposed a retrieval-order regression.
- Separated parsed-page progress from text-page coverage and explicitly labeled partial full-book summaries.
- Added constrained draggable reading/chat divider and collapsible navigation.
- Added cross-book response guards as above.

Specification findings: four original findings and the follow-up protocol race addressed. Tools remain unavailable on the locally tested restricted Windows sandbox, consistent with the explicit fail-closed requirement; no claim of successful real tool execution is made.
