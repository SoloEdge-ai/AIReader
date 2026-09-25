# Screenshot questions and resizable chat

> 历史记录（截至 2026-09-24），不是当前实施规范。请从[当前文档入口](../../README.md)开始；下文保留当时的设计、结果及限制。

Baseline: main 2b1bb938c3592c3ef211cab6fb8b88d748f259b7.

- Accept explicitly pasted or picked PNG/JPEG/WebP images; show thumbnails,
  preview and removal before sending. Text pastes remain normal. Allow image-only
  questions with a visible/default request to explain the images.
- At most four images per turn, 8 MiB per image, at most 16 million pixels.
  Invalid/unsupported/oversized images report errors without erasing the draft.
- Draft images are isolated by book/session and preserved with existing in-memory
  drafts across panel navigation. Freeze them at submission; preserve newer edits.
- Core validates PNG payloads normalized by the renderer, owns image paths and
  stores sent images separately from the original PDF. History shows the actual
  attachments across restarts. No credentials, arbitrary paths or remote image URLs.
- Send actual image inputs via App Server localImage, not a textual filename.
  Attachments are user material, not verified book passages or valid citation IDs.
  Only current-turn images are sent; history explains that earlier image pixels
  are not automatically replayed. No automatic PDF screenshots, OCR or note upload.
- Expand chat/notes beyond the old 560px cap using a discoverable drag handle,
  keyboard arrows and Home/End. Keep at least 400px for the desktop reader;
  narrow-window drawers can resize up to 90% of the window. Remember book layout
  and clamp transient window-size changes without overwriting the preferred width.
- Regression boundaries remain Core HTTP, real renderer/PDF operations, context
  assembly and external Codex protocol. CI builds the portable EXE.

Protocol: [official App Server inputs](https://learn.chatgpt.com/docs/app-server#turns),
also checked against the installed fixed 0.155.1 generated UserInput schema.
PNG decoding uses [pngjs](https://github.com/pngjs/pngjs) with CRC validation.
