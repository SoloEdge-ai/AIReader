# Selection toolbar dismissal

Baseline: main ff119314cfae3470bcb1ee7666e1d5d759f19e9c.

User request: after selecting PDF text, left-clicking elsewhere to cancel the
selection must dismiss the floating toolbar without requiring its X button.
Toolbar annotation/color actions and selection-based questions must keep working.

Root cause: the reader only reported non-empty selections during mouseup. PDF.js
can clear the selection after mouseup, so the retained React state outlived the
native selection. Listen to selectionchange and clear invalid/outside selections.
An explicit question action captures its passage separately, so focusing the
composer can dismiss the toolbar without losing the question's source text.
New PDF selections supersede that capture; changing books clears it.

Regression boundary: real Electron/PDF mouse gestures in an isolated generated
fixture, plus real Core HTTP/UI with only the external Codex process mocked.
The original test failed twice with an empty DOM selection and one remaining
toolbar. Coverage includes page blank space, outside-reader clicks, color choice,
highlight creation and the selected passage actually sent in the question.
The packaged selection test runs on each PR and release build.
