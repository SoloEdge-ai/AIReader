# 问答浮窗验证（2026-09-25）

范围：PR #24 合入后的 `codex/chat-floating-window`。问答由固定右栏改为应用内浮窗；聊天业务流程不变。

已实际运行：

- `pnpm typecheck`：通过，含协议／引擎依赖边界及文档链接检查。
- `pnpm test`：39 文件、63 项通过；新增纯几何测试覆盖初始位置、窗口收窄、移动约束与边角缩放。
- `pnpm test:reader-ui`：37 项通过，含窄窗材料与问答同时可见、笔记草稿保存。
- `pnpm build`：通过，打包 Core 启动和书库 HTTP smoke 通过。
- `node --import tsx scripts/chat-attachments-smoke.ts`：真实浏览器验证移动、缩放、按书偏好重开恢复、窄窗边界、截图粘贴、图片模型输入和历史恢复；缩至 320px 高、加入四张图片及原文选区后，“发送”仍在可视范围，材料预览内部滚动。
- `node --import tsx scripts/chat-smoke.ts`、`scripts/answer-notes-smoke.ts`、`scripts/pdf-region-chat-smoke.ts 1`：模型、引用、回答存笔记和区域截图流程通过。区域截图暂时隐藏问答浮窗且不持久化为关闭偏好。

浏览器截图位于忽略的 `.local/screenshots/chat-images-*.png`，不提交生成 PDF 或用户数据。尚未完成正式 Windows 安装版在 100%／150%／200% 系统显示缩放下的人工拖动验收；CI 安装包和 SHA 需在新 PR 检查后核对。本记录不宣称这些未完成项已通过。
