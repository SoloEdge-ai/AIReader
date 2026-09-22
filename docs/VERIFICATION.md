# Verification record

Environment: Windows 11 x64 build 26200. Local CLI upgraded from 0.128.0 to 0.155.1 through npm; existing ChatGPT login remained valid. The updater left an in-use old binary in npm's temporary cleanup directory; it was not forcibly removed.

## Automated

- PDF import/deduplication, FTS5 retrieval, source anchors, blank-page detection, bookmarks and persisted reading progress.
- 50-turn context bound, immutable reading snapshot, invalid citation rejection and late-chapter evidence regression.
- HTTP session/origin rejection, PDF import, invalid cross-book reading state, directory download rejection.
- Simulated App Server stdio initialization, fresh threads, delayed startup/concurrent callers, cancellation and reconnect without logout.
- Semantic index pause/resume, durable nodes and source-passage ownership.
- Packaged Electron startup, renderer text layer and completed background parsing using a generated PDF; also run in Windows CI. Hosted Windows Server checks are distinct from Windows 11 compatibility checks.

## Local real-book checks

The user-provided PDF was tested locally only; no source PDF or extracted contents are committed. Initial parse: 516 pages, all pages contained extractable text, 121 outline entries, 672 passages, approximately 4.6 seconds. A later parser revision additionally represents front matter and nested outline relationships.

Headless Edge and native Electron both loaded the 516-page PDF. The browser reported zero uncaught page errors; Chinese keyword search returned results and navigated to source pages. Screenshots remain in ignored local test output.

The actual single-file portable EXE also launched successfully, rendered the 516-page book and completed text indexing. Its self-extracting launcher does not forward the inspector pipe used by Playwright's Electron launcher, so the portable test attaches through an explicitly enabled local debugging port instead. The application does not enable this port during normal launches.

Real Codex connection reused the existing ChatGPT login. A question about physical page 20 returned a source-grounded answer with a validated page-20 citation. Manual comparison confirmed the cited paragraph discusses capacity/unit accounting. A current-section semantic-index job completed successfully. A first run exposed wrong retrieval prioritization for “current page”; that was fixed before the successful rerun.

## Limits

- Current Codex 0.155.1 Windows elevated sandbox rejects restricted-root permissions. Tool verification returns unavailable; execution remains disabled. No unrestricted fallback is used.
- Multi-column reading order, formulas and figures can be incomplete despite successful text extraction. No OCR or image understanding in v1.
- Token counts are conservative application estimates, not a guarantee of Codex total input size.
- Summaries are navigation aids, not verified facts. Full-book answers with bounded evidence remain explicitly partial; exhaustive synthesis is not claimed.
- The portable executable is unsigned. No automatic update mechanism, ARM64 build, or Windows 10 support.
