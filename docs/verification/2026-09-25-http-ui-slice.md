# 2026-09-25 Core 边界与阅读 UI 切片验证

分支：`codex/architecture-refactor`，Draft PR #24。以下是分支验证，不代表 0.2 整体重构已经完成，也未合入或安装。

## 代码边界

- Core 将书库阅读、笔记、工作区、聊天、全局 AI、索引、工具和偏好的 HTTP 契约从 `server.ts` 分离；安全入口、来源／会话校验和停止顺序仍由 Core 总入口负责。
- `Preferences` 统一全局阅读、工具盘及每书偏好的作用域和协议校验。真实 HTTP 测试验证全局设置不污染每书布局、越界输入与多余路径被拒绝。
- Codex 延迟启动时 Core 停止不会留下后启动的 App Server 子进程；半包 HTTP 连接不会令 Core 无限等待，已进入处理的异步写入在关库前排空。

## UI 与数据行为

- 保存失败提示位于阅读容器上方，在 1080px 窄窗口和 200% 页面缩放下可滚动且重试按钮可命中，不被材料抽屉遮住。
- 对象／关系条采用选区条的浮层表面与 36px 按钮命中区；批注与画布对象复用颜色弹层，对象支持自定义色。对象测试验证颜色实际写入工作区，截图仅保存在忽略的 `.local/screenshots`。
- 同一 Note 的卡片、笔记面板与展开编辑器使用共享草稿；正在输入的编辑器不会被旧快照覆盖，聚焦但干净的编辑器仍可接收真实的新版本。
- 关闭、切书、返回书库和编辑退出使用同一当前书籍保存入口；Note 先于可能引用它的画布提交。当前仍是两套草稿状态加保存屏障，不把它称为完整 `BookEditingSession`。
- 聊天会话、轮次和学习记忆经 `ChatRepository` 按书籍存取；创建轮次与提交冻结材料保持同一 SQLite 事务，失败时一起回滚。上下文不再自行拼接聊天记录键。
- 画布对象操作条从 `BookWorkspace` 分离，文字选区与源批注共用颜色选项；聊天只在轮次进行中补读，丢失终态 WebSocket 事件时从 Core HTTP 恢复，完成后停止轮询。
- 索引任务、目标章节、批次摘要与语义节点经 `IndexRepository` 按书籍存取；创建任务和目标章节同事务提交，目标及批次读取增加书籍条件。
- 画布草稿、命令队列、视野及历史迁至 `WorkspaceEditingSession`；`WorkspaceState` 保留订阅与浏览器离开保护。Note 和画布仍是两套会话，未宣称跨实体历史完成。

## 已执行

- 本机：`pnpm typecheck`、34 文件／55 项 Vitest、`pnpm build` 与捆绑 Core smoke 通过。`tests/http.test.ts` 使用两本真实生成 PDF 和外部模拟 Codex 进程验证工具轮次书籍隔离。
- 本机打包版：`node scripts/annotations-smoke.mjs 1 release/win-unpacked/AIReader.exe` 通过；旧构建连续重复五次未复现 CI 曾出现的笔记同步时序失败。改进焦点同步后同一整段验收通过。
- 本机 UI：`node --import tsx scripts/objects-smoke.ts`、`node scripts/selection-smoke.mjs` 通过；Playwright 的“双视图编辑一份笔记”和“聚焦干净编辑器接收服务端新版本”定向测试通过。
- 保存屏障修改后 `node scripts/close-save-smoke.mjs` 以真实 Core 版本冲突／SQLite 写锁验证保留草稿、重试和重开；`node scripts/desktop-smoke.mjs .` 验证正常关闭，均通过。
- 聊天仓储修改后 `pnpm typecheck`、`tests/chat-repository.test.ts`、`tests/chat-http.test.ts` 和 `tests/context.test.ts` 通过；仓储测试验证跨书隔离及材料回调失败时轮次回滚。
- `node --import tsx scripts/objects-smoke.ts` 验证批注色点弹层实际改色、撤销／重做、对象关系和重启恢复；截图保存在忽略的 `.local/screenshots/annotation-object-color-menu.png`。`node --import tsx scripts/chat-smoke.ts` 在浏览器侧主动丢弃首轮 turn 事件后仍得到完整回答；定向 Playwright 测试验证终态事件缺失可补读且完成后停止轮询。
- 索引仓储修改后 typecheck 与 `tests/index-repository.test.ts`、`tests/indexer.test.ts`、`tests/context.test.ts`、`tests/chat-http.test.ts` 通过；测试用 SQLite trigger 强制任务写入失败，确认目标章节随事务回滚。
- 画布会话修改后 typecheck、35 项阅读 UI Playwright、`node --import tsx scripts/objects-smoke.ts`、`node scripts/close-save-smoke.mjs` 及本机构建／捆绑 Core 启动通过；其中真实 UI 覆盖旧回执重试、刷新竞态、卡片关系与桌面关闭失败恢复。新增定向测试证明挂载时旧 GET 不会覆盖较新的显式刷新。
- 最新 `b74b9bf` Windows CI `36121994924` 在打包版笔记验收中失败：恢复保存失败后，卡片替换正文时旧草稿偶尔被拼接回新文本。已为编辑器加入共享会话最新快照校验，并在聚焦编辑期间保留本地输入保护；新增真实 UI 回归模拟保存失败、重试、放置卡片及连续全文替换。类型检查、36 项完整阅读 UI、36 文件／57 项 Core 测试通过；新打包版 `annotations-smoke.mjs` 连续四次通过（1× DPI）；本机便携 EXE 和当前用户安装包构建通过。新 CI 尚待验证。
- `507500c` 的 Windows CI `36124407544` 在工具盘的 Vite 测试页一次未找到“添加形状”按钮，35/36 项 UI 测试通过，故打包验收未执行。该测试本机单独重复 30 次全部通过；尚无证据证明是应用按钮逻辑回归，不能把原因断定为 Vite。测试页入口现先确认工具盘已挂载；若首次加载失败，仅重载测试页一次，并在再次失败时报告初始页面内容、脚本错误与 HTTP 5xx。生产阅读页的验收不做此重载兜底。
- Windows CI：`36116023139` 和 `36117038716` 均通过，包含便携 EXE、当前用户安装包、SHA256、阅读／画布／聊天／笔记 UI 及安装更新回归。更早的 `36114328034` 在笔记同步处发生一次时序失败，随后已增加焦点保护和更精确断言。
- Windows CI：`36125200371` 在 `7185b83` 全流程通过，包含便携 EXE、当前用户安装包、SHA256、打包版笔记／画布／聊天／PDF、关闭保存与安装更新验收；这是当前最后一次远端全绿基线，后续本地材料仓储改动尚未推送。此前 `36120839503` 在 `2482aaf` 完整通过；`b74b9bf` 的 `36121994924` 因上述笔记卡片同步竞态失败，`507500c` 的 `36124407544` 因工具盘测试页一次未挂载失败。`36119339601` 暴露过 Core 完成而聊天 UI 停在等待的终态事件缺失，已通过进行中轮次补读和故障注入 UI 测试修复。

## 未完成

当前仍未完成全工作区 `BookEditingSession`、跨实体命令／撤销、其他对象工具条布局约束、真实 Windows 11 系统 DPI 和长时间交互、私有 516 页书的全流程性能、阶段预览 Release。生成样本和 CI Server 镜像不替代这些验收。
