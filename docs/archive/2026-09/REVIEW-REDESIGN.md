# Redesign review

> 历史记录（截至 2026-09-24），不是当前实施规范。请从[当前文档入口](../../README.md)开始；下文保留当时的设计、结果及限制。

Fixed baseline: `e01b880`; specification: `docs/REDESIGN.md` and the accepted user plan. Standards source: `AGENTS.md`, plus the code-review skill's Fowler smell baseline. Independent Standards and Spec reviews were performed; results are kept separate.

## Standards

No documented-rule violations found. Three judgment findings in the annotations slice:

1. A successful save whose response is lost can leave stale-revision retries stuck. Fixed by reconciling already-committed identical content and offering explicit draft-over-latest recovery for conflicts. The UI test drops a response after Core commits.
2. Underline/strike decoration did not follow page rotation. Fixed by converting stroke endpoints from PDF coordinates, verified across all four orientations and a natively rotated page.
3. Vetoing Quit for unsaved notes could leave Core already terminated. Shutdown now stops Core only at `will-quit`; a native confirmation defaults to keeping the draft. Desktop acceptance verifies a veto followed by a working save.

Earlier citation parsing and pending-session race findings were also fixed before PR #7 merged. No additional structural smell changes were requested.

## Spec

Two findings in the annotations slice: rotated underline/strike geometry and lost-response save recovery. Both were addressed as described above. Earlier malformed citation, pending-session and zoom-position findings were also addressed. No scope creep identified.

## Summary

Standards: 3 annotations-slice findings addressed. Spec: 2 annotations-slice findings addressed. Real browser authorization and native IME acceptance remain explicitly documented verification limits, not reported as automated passes.

Focused recheck of `e034f91`: Standards reported no remaining documented violations or heuristic findings; Spec confirmed both remaining findings resolved and no material defect in the focused recheck. Packaged release verification follows CI; real authorization remains user-interactive.
