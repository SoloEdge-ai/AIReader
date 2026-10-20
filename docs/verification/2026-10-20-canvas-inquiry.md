# 2026-10-20：画布问答阶段 A 实施与检查

## PR 整理后的补充检查

已将原工作区保存为原分支快照，基于 main `332965a` 整理为 `codex/canvas-inquiry`、PR #29；整理后重新通过类型检查。第一次 Windows PR 检查在 `chat-smoke.ts` 查找旧的“本轮上下文”文案时失败；脚本已对齐“本轮证据”，回答笔记验收同步从“回答详情”进入原有操作。修正后重新构建 web/Core，实际执行 chat-smoke、answer-notes-smoke、citation-navigation-smoke 全部通过；没有跳过或降低行为断言。远端后续结果仍以 PR 检查为准，正式安装更新另行记录。

状态：本地实现与验收记录，尚未发布。分支 `codex/citation-preview-navigation`；工作开始时已有大量暂存／未提交变更，本轮保留这些内容，新增差异以 `.local/canvas-inquiry-baseline` 的工作前快照核对。构建元数据中的 HEAD 不是本轮完整代码身份，须同时看 `workingTreeDirty`。

## 实现范围

- 画布多选的“问 AI”：解释、比较、指定笔记检查依据、自定义问题；保护已有问题，明确加入和发送。
- `materials` 严格范围：只使用冻结材料与其核验的选定文字，不补发整页、搜索、导航、历史或记忆；本书工具拒绝此类轮次。`search` 明确允许本书补充检索。
- 同一版本冻结选区及关系，保留目标 ID 与 AI 来源身份；逐项移除由 Core 对原快照投影，不重新读取相邻对象。
- `save-answer` 书籍级命令：回答笔记与位置原子保存、复用、回执重试、撤销／重做；引用与原对象删除后仍保留历史依据。
- 结果卡片的“使用材料”与“用于回答”线；归档重映射材料目标、关系端点和引用的书籍身份。问题卡片与结论历史尚未实现。

## 环境与方法

Windows 主机；可用运行时为 `C:/Users/Zplea/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe`（24.19.0），pnpm 10.33.0。系统 pnpm shim 会优先用其同目录的 Node 22.14.0；检查使用 Node 24 直接运行 `C:/nvm4w/nodejs/node_modules/pnpm/bin/pnpm.cjs`，并把 Node 24 目录放到子进程 PATH 前。嵌套 `pnpm build` 的首次打包仍经过旧 shim，最终构建按下表另行记录。

HTTP 测试使用生成 PDF、真实 Core／SQLite／本地资源，仅外部 Codex 使用固定 stdio 进程夹具。浏览器为真实 Chrome，未 mock 业务 HTTP。数据目录使用临时隔离目录，不使用用户书库。

## 已执行与待完成

| 检查 | 本次结果 |
| --- | --- |
| 应用／引擎类型、依赖边界及当前文档链接 | 通过；包括新增打包验收脚本及文档同步后的复查 |
| 新增 Core HTTP、逐项排除与草稿回归 | 通过；包括严格输入、空材料拒绝、关系端点、工具拒绝、原子失败、重复回执、撤销／重做、AI 身份、归档与重启 |
| 全部行为测试 | 最终源码 53 个文件、98/98 通过，包含共享图像移除、40 section 归档和恢复后 AI 编辑身份。首轮夹具回显导致的引用干扰已修正 |
| 新流程＋已有阅读器浏览器回归 | 19/19 通过，包含草稿追加、冻结、发送、保存、使用关联、刷新恢复及窄窗 |
| 完整工具盘／菜单／笔记／阅读器浏览器验收 | 55/55 通过；最后的任务提示与自由提问恢复改动另经新增场景复查通过 |
| Setup／Portable 构建 | 最终源码使用 Node 24 完成开发构建与 bundled Core smoke，两个开发验收包构建成功；本地使用 store 压缩覆盖参数 |
| 实际打包程序的隔离启动／关闭／重开 | 最终包的 `canvas-inquiry-packaged-smoke.ts` 通过保存、材料使用线与重开唯一位置；`desktop-smoke.mjs` 的 unpacked 和 Portable 启动／导入／关闭均通过 |
| 保存失败与退出保护 | `close-save-smoke.mjs` 通过真实 Core 冲突、SQLite 写锁、保留草稿、重试及关闭重开 |

新增测试为 `tests/canvas-inquiry-http.test.ts`、`tests/inquiry-drafts.test.ts`、`tests/canvas-inquiry.spec.ts`。完整现有阅读器验收也验证了多选冻结后独立移除，不因集合冻结而改成整组移除。

新增 `scripts/canvas-inquiry-packaged-smoke.ts` 已加入 Windows PR 工作流；它用生成材料准备已完成回答，再通过实际 exe 的 Core 与 renderer 保存和重开，不能据此宣称真实线上模型已验收。图片移除还检查了同一共享预览包含多个对象时不能只排除其中一项；新预览按对象分别生成，避免已移除对象的像素随邻项再次发送。

类型检查及打包工具输出包含既有依赖告警：Vite 的大分块／PDF.js 图片路径提示、electron-builder 的重复依赖提示，以及 Playwright 启动 Electron 时的 Node 弃用提示。未把这些告警报告为功能失败，也未据此声称消除了现有构建告警。

最终容量回归另验证了 20 张摘录各带个人评论形成的 40 个 section：可发送、保存为回答笔记并归档恢复；恢复后的 AI 内容继续保留编辑身份。该回归与现有回答笔记／归档测试共 9 项通过。

本地打包过程中有一轮正常压缩因代码后续修正而被主动停止，其非零退出不计为产品构建失败。最终开发验收包使用 Node 24 直接执行 `scripts/build.mjs`、`scripts/bundled-core-smoke.mjs` 和 `node_modules/electron-builder/out/cli/cli.js --win --x64 --publish never --config.compression=store`，减少重复本地压缩时间；仓库与 CI 的默认压缩配置未改动。该设置只影响开发包大小与打包耗时，不代表正式发布参数。

## 本地产物身份

开发版本 `0.1.0`、channel `development`，HEAD `b1f232acedbfd3ea8e9de35273354324a54d1ca1`，`workingTreeDirty: true`。没有发布 Release、安装到用户现有目录或更新用户书库；本轮没有把工作前已有的其他暂存变更混合提交。

| 产物 | 字节数 | SHA256 |
| --- | --- | --- |
| `release/AIReader-Setup-0.1.0-x64.exe` | 791856867 | `2D223F46C76F203D192DCB579BBEE40883A0EDA95526D148A1D36AD869DA3A85` |
| `release/AIReader-Portable-0.1.0-x64.exe` | 790902123 | `8AEFF6E5BC5B30515E638140D6814A621A7D8DC9A24C87D4F232C3C5A6226BDF` |
| `release/win-unpacked/resources/app.asar` | — | `35A560744D97B4821999CFAAE442C94ECDE3646004D378E6E77753F7A9C89D07` |

## 限制与未覆盖

- 未连接真实账号向线上模型提问；实际输入由外部 stdio 夹具检查，不据此评价真实模型回答质量。
- 严格文字核验目前只接受单个来源 anchor 内、可与本书已提取 passage 对应的文字。复杂跨锚点摘录继续作为选定资料／图像分析，明确没有核验文字引用；未扩大证据范围。
- 同一集合内的关系一起冻结；分次加入的对象不读取最新画布补建关系。需要关系时应同次选择端点。
- 待保存回答仍在本书聊天中持久存在，失败保留重试入口；不会把失败反馈当作保存成功。并发冲突需要处理现有工作台版本，不能自动覆盖其他窗口。
- 本轮尚未完成 516 页／500 卡片满载、长时间编辑、Windows 系统 100/150/200% DPI 组合、真实安装升级及人工可用性研究。浏览器窄窗通过不代表这些边界通过。
- 本地构建不是正式发布；现有数据库／工作区／布局／归档版本保持 v6／v5／v3／v4。
