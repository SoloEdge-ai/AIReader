# 架构与所有权

状态：当前架构及目标依赖，进度见[计划](plans/architecture-refactor.md)。

Electron启动Core utility process，Core回环HTTP/WebSocket；renderer无Node权限。PDF提取在子进程，页面/文字层由PDF.js渲染。Codex使用独立账号目录与App Server stdio。

当前 App 组合书库／阅读／笔记／问答，BookWorkspace/PdfReader 拥有空间交互。WorkspaceState、NotesPanel 分别保存编辑；QuestionDrafts 按 book/session 保存问题草稿。Core Library 仍公开通用 Storage，server 仍含路由和业务；这些不是已完成的目标架构。

已拆出的 `packages/workspace-engine/src` 包含跨页笔迹、形状／套索／移动和视野缩放的纯计算。PDF 组件提供 `WorkspacePage` 坐标变换；引擎不再回引 PDF React 组件。创建形状的 ID 由调用者提供，渲染预览不生成随机实体。

`packages/protocol/src` 按 reading、library、preferences、indexing、chat、images、ai、notes、events 拆分。index 仅作外部兼容导出，内部不得回引；事件已使用带书籍身份的可区分联合。运行 `pnpm typecheck` 同时验证引擎无 DOM／Node 全局和协议／引擎导入边界。

## 不变量

书籍是隔离根，异步结果按创建时book/session/task路由。个人编辑不能覆盖原文来源。Core拥有文件、事务、检索、账号与模型。来源用独立PDF坐标，索引可重建。模型只接收冻结输入。保存失败保留草稿，切书/退出不能静默丢失编辑。

## 目标依赖

应用外壳组合features；features通过书籍编辑会话和类型客户端协作。UI基础不依赖业务；纯工作区引擎不依赖React/DOM/Node；PDF适配提供变换，几何不能导入React阅读器。

Core HTTP调用应用操作，操作拥有事务/业务规则，存储拥有SQL/文件。共享协议不依赖应用。已验证几何、材料和引用模块逐步迁入明确位置，不按文件行数机械拆分。
