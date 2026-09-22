# Windows PDF parser process isolation

Baseline: main f34db0c7f956b5a2b4ca750c571f2de05933de29 (PR #12).

The release test process exited with native status 0xC0000005, followed by
Vitest's secondary ERR_IPC_CHANNEL_CLOSED. A local loop importing PDF.js 5.4.54
in worker_threads reproduced the native failure without chatting or parsing.
The real Core HTTP continuous-import test also failed before this fix.
[Upstream report](https://github.com/mozilla/pdf.js/issues/21934) describes the
same Windows PDF.js 5.x worker-thread issue. Longer test waits did not fix it.

- Keep the pinned PDF.js version and existing PDF extraction/index semantics.
- Load the backend PDF parser in an independent hidden Node-mode child process,
  not a worker thread in Core's address space. Renderer privileges stay unchanged.
- Core supplies the source path and book identity through its private IPC channel;
  metadata, passages, errors and completion retain their existing meanings.
- A parser process ending before completion marks only that book as failed,
  instead of leaving it permanently parsing or stopping Core.
- Closing Core stops its parsers; loss of the parent IPC connection also exits
  the parser. Interrupted parsing remains resumable by the existing startup path.
- Verify at the real Core HTTP/PDF boundary with 40 consecutive generated PDF
  imports, search after each import, and a damaged PDF that leaves Core available.
  Repeat locally and retain the test in CI; no parser or database mocks.
- Run all existing tests, renderer smoke tests and packaged desktop acceptance.
  Delivery remains a protected-main PR, squash merge and portable EXE.
