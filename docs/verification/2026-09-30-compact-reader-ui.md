# 紧凑问答与材料卡片验证

## 范围与环境

以 main 的 `2cdb928` 为起点，在 `codex/simplify-reader-ui` 实现已选定的“紧凑 · 页码可见”方案。首轮应用代码提交为 `1b9eecd9d3537ae0f4422229c93fd9a664e69498`；下方跟进记录单独注明构建源码。

Windows 11（10.0.26200）、Node 24.19.0、Electron 44.4.3。阅读 UI 使用 Chrome，独立聊天验收使用 Edge。PDF 和图片均由测试生成，Core HTTP／SQLite／PDF.js 真实运行，仅外部 Codex 进程使用替身。每次验收使用隔离数据目录。

## 首轮已通过

- `pnpm typecheck`：TypeScript、依赖边界与现行文档链接通过。
- `pnpm test`：51 个文件、100 项通过；包括 Core HTTP 持久化 128px 摘录和 120px 笔记放置、问答默认窗口几何、书籍隔离和来源上下文。
- `pnpm test:reader-ui`：53 项通过；覆盖笔记编辑与保存恢复、来源、选区、双布局、卡片菜单、连接及键盘／指针操作。
- `node --import tsx scripts/chat-smoke.ts`：登录状态、模型分页／强度、引用、复制、重命名、历史、取消、冻结配置和重载通过。
- `node --import tsx scripts/chat-attachments-smoke.ts`：真实剪贴板、图片预览／移除、无效图片恢复、草稿／历史、模型实际图片输入、浮窗移动缩放和持久化通过。
- `node --import tsx scripts/answer-notes-smoke.ts`：回答转笔记、编辑、幂等重开、持久化、来源导航、ZIP 导出和切书隔离通过。
- `node --import tsx scripts/pdf-region-chat-smoke.ts 1`、`1.5`、`2`：三个浏览器 deviceScaleFactor 下的裁剪像素／坐标、模型图片、取消、旋转、PDF 缩放、会话与书籍隔离、历史和窄浮窗通过。
- `node scripts/selection-smoke.mjs`：选区收起、范围菜单、显式加入／替换／移除引用、冻结内容、标注及问答交接通过。
- `node scripts/annotations-smoke.mjs 1`：批注、自动保存／失败恢复、退出保护、重开、跨页及旋转／缩放来源定位通过。
- `pnpm build`：前端／Core 构建和打包 Core 的启动、认证书库 HTTP 通过。

完整单元／Core 与阅读 UI 套件通过后，最后只修正了浮窗拖柄命中区、详情图标、阴影和范围菜单收起；随后再次通过类型检查及受影响的图片／浮窗、问答、选区、笔记和保存恢复验收。截图检查确认紧凑默认窗口、浅深主题、来源页码、关联笔记图标和卡片菜单。发现的原生 popover 被菜单 display 样式意外显示问题已修复，并由卡片菜单初始隐藏断言覆盖。

## 首轮 Portable 产物

`pnpm desktop:portable` 在上述应用提交的干净工作树上完成。实际 `release/AIReader-Portable-0.1.0-x64.exe` 通过 `node scripts/desktop-smoke.mjs release/AIReader-Portable-0.1.0-x64.exe` 连续两次启动验收：第一次在新的隔离目录导入生成 PDF、写入并保存笔记；第二次复用该目录，确认标题与正文仍在。两次均检查问答开关、浅深主题、返回书库和正常关闭。

- 文件大小：118,952,601 bytes。
- SHA-256：`BEB4E07D683D288A72FE67E431BA7C44D671E4D3961F5E7909EA58EFCC336CD9`。
- 包内身份：0.1.0／development，源码 `1b9eecd9d3537ae0f4422229c93fd9a664e69498`，`workingTreeDirty: false`；DB 6／archive 4／API 2。
- Vite 仍报告大 chunk、既有 Tiptap 指令和 PDF.js annotation SVG 引用警告；未阻止构建、PDF 渲染和本轮验收。此任务未调整打包拆分。

## 边界

已有手动窗口／卡片尺寸不自动改写；新建项目使用紧凑默认尺寸。完整内容与来源仍可展开，保存／发送失败保持明确反馈。Core 仅放宽卡片最小高度，未改变数据所有权或冻结上下文流程。

浏览器 deviceScaleFactor 验收不等同于全部 Windows 系统 DPI 交互矩阵。本次没有重跑大型 PDF／满载画布压力测试或真实模型服务验收。安装升级、卸载和完整远端 Windows 流水线以 PR Actions 结果为准，本地开发产物不表示正式发布。

## 2026-09-30 跟进：删除重复说明

应用提交 `187bb8197f4e24da73741fb13527c942e20fd369` 删除原文聚焦和比较页的面包屑、标题与介绍，改为紧凑返回栏；清理聊天欢迎、材料冻结、图片默认问题、思考摘要、笔记编辑和索引中的重复说明。笔记来源身份使用共享小标识；图片预览保留来源页码，把物理页和 PDF 坐标放入悬停提示。错误、保存状态、来源已变更／已删除和全书索引上传确认保留。

本轮重新通过 `pnpm typecheck`、全部 53 项 `pnpm test:reader-ui`，以及 `chat-smoke.ts`、`answer-notes-smoke.ts` 和 `pdf-region-chat-smoke.ts 1`。现有 PDF 裁剪／历史验收同步检查悬停提示中的原始坐标，未仅删除断言。聚焦和比较截图已检查，无残留介绍占位。此次是界面文案与样式调整，未重跑首轮 100 项 Core／单元套件及 1.5／2 倍像素比矩阵。

`pnpm desktop:portable` 在该应用提交的干净工作树上构建通过。实际 Portable 通过 `AIREADER_CREATE_NOTE=1` 的桌面验收：使用新的隔离目录导入 PDF、创建并保存笔记、打开／关闭问答、切换浅深主题并正常退出。本轮产物覆盖相同路径下的首轮文件，大小为 118,955,043 bytes，SHA-256 为 `178B18F3AB121476F7C16320BC51991DF5BDDEC77238CCD4496B021C0001E83F`。包内提交为 `187bb8197f4e24da73741fb13527c942e20fd369`，`workingTreeDirty: false`，版本／格式身份仍为 0.1.0／development、DB 6／archive 4／API 2。

## 2026-09-30 跟进：保持连续原文

应用提交 `68bbdd8ba68b86e4154af4ee7488179a0ead091d` 将“聚焦原文”改为在现有完整 PDF 中定位并高亮来源，保持缩放、页面顺序和文档矩形；标题栏的返回箭头恢复定位前的阅读位置。删除独立聚焦 PDF、裁剪模型和上下文操作栏，来源预览合并为一个聚焦按钮。窄窗中先显示原文，再完成定位。UI、架构和 ADR 0007 同步这一决定。

本轮通过：

- `pnpm typecheck`：类型、依赖边界和现行文档链接。
- `pnpm test`：51 个文件、95 项。废弃裁剪模式的 5 项测试随实现删除，新交互由真实浏览器覆盖。
- `pnpm test:reader-ui`：54 项，包含连续并排卡片定位、多页来源同时高亮、返回原滚动位置、空间桌面 165% 选区聚焦与文档矩形不变、继续滚动到下一整页、窄窗隐藏原文后的定位。截图检查确认完整页面和紧凑返回箭头。
- `node --import tsx scripts/region-smoke.ts`：图片摘录、连续 PDF 中的来源高亮、重开持久化、含标注图片及显式加入提问。
- `node --import tsx scripts/answer-notes-smoke.ts`：回答笔记保存、编辑、幂等重开、来源导航、ZIP 和书籍隔离。
- `node scripts/annotations-smoke.mjs 1`：批注、自动保存与失败恢复、关闭保护、重开、跨页、旋转和缩放来源定位。
- `pnpm build`：前端、桌面与 Core 构建，以及打包 Core 的启动和认证书库 HTTP。

本轮没有重跑 1.5／2 倍像素比矩阵、大型 PDF／满载工作台压力或真实模型服务；不据此扩大已验证范围。

`pnpm desktop:portable` 从该应用提交的干净工作树启动并构建成功。实际 `release/AIReader-Portable-0.1.0-x64.exe` 通过 `AIREADER_CREATE_NOTE=1 node scripts/desktop-smoke.mjs release/AIReader-Portable-0.1.0-x64.exe`：隔离目录导入生成 PDF、创建并保存笔记、问答开关、浅深主题、返回书库与正常退出。本轮覆盖同一路径的旧产物，大小 118,951,881 bytes，SHA-256 为 `EFEFF0E05BE591C25AEDDF4F08B2AB7AB4401E87F1DC95CA3107D416275D353E`。包内提交 `68bbdd8ba68b86e4154af4ee7488179a0ead091d`，`workingTreeDirty: false`；0.1.0／development、DB 6／archive 4／API 2。远端完整 Windows 检查以 PR 最新 Actions 结果为准。
