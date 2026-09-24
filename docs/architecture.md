# 架构与所有权

状态：当前架构及目标依赖，进度见[计划](plans/architecture-refactor.md)。

Electron启动Core utility process，Core回环HTTP/WebSocket；renderer无Node权限。PDF提取在子进程，页面/文字层由PDF.js渲染。Codex使用独立账号目录与App Server stdio。

当前 App 组合书库／阅读／笔记／问答，BookWorkspace/PdfReader 拥有空间交互。WorkspaceState 保存画板编辑，`features/notes/NoteEditingSession` 保存富文本笔记编辑；两者尚未合并为最终 BookEditingSession。QuestionDrafts 按 book/session 保存问题草稿。Core Library 仍公开通用 Storage，server 仍含路由和业务；这些不是已完成的目标架构。

笔记会话按书籍创建，拥有已提交版本、实时草稿、串行保存、响应丢失核对和批注操作撤销；`useBookNotes` 仅处理 React 订阅与离开保护。`client/notes.ts` 捕获 bookId 并提供类型化笔记操作。列表与展开编辑使用同一 `NoteEditor` 和会话快照，不再各自缓存标题／正文。普通刷新保留脏草稿的原始 revision；只有明确的“用此草稿覆盖最新版本”才重取冲突基线。较早请求的响应不能清除较新的输入。

会话区分选中的标注与选中的 Note；显式 comment 操作通过书籍客户端请求 Core 原子建立关联。标注和评论可独立删除，Note 的来源引用不等于标注的活跃评论指针。只读来源投影用于展示已删除标注，不能回写为用户可编辑来源。

已拆出的 `packages/workspace-engine/src` 包含跨页笔迹、形状／套索／移动和视野缩放的纯计算。PDF 组件提供 `WorkspacePage` 坐标变换；引擎不再回引 PDF React 组件。创建形状的 ID 由调用者提供，渲染预览不生成随机实体。

引擎中的 commands 模块共享实体差量和级联关系删除投影；Core 验证并事务提交，renderer 不重复维护投影分支。`client/workspace` 组装 v2 摘要并校验回执，WorkspaceState 仍负责现有画板草稿和队列；这不是最终 BookEditingSession。增量回执不保存每一步的完整工作区快照。

`workspace-repository.ts` 拥有 v5 工作区实体／关系／视野／回执 SQL，Workspaces、Notes 的关系删除及归档恢复统一调用它。Storage 负责数据库生命周期和外层事务，拒绝旧 records 工作区键读写。仓储从分行数据组装协议快照，但只写发生变化的实体；关系端点的跨书和存在性校验继续属于 Core 业务规则。其他领域仍使用 records 和 Library.store，尚未完成全部后端职责收拢。

若列表读取期间发生成功保存，最新刷新会重新读取，不能简单丢弃新建／删除的结果。同步到另一编辑器的正文事务不进入该编辑器的本地撤销历史；原生编辑撤销与未来全工作区命令历史仍是不同层次。

`packages/protocol/src` 按 reading、library、preferences、indexing、chat、images、ai、notes、events 拆分。index 仅作外部兼容导出，内部不得回引；事件已使用带书籍身份的可区分联合。运行 `pnpm typecheck` 同时验证引擎无 DOM／Node 全局和协议／引擎导入边界。

## 不变量

个人笔记卡片通过 noteId 引用 Note，`NoteCardContent` 复用会话和 NoteEditor；未选中卡片只渲染只读文本预览，不挂载富文本编辑器。摘录卡片保留只读原文或区域图及定位，以 noteId 指向个人评论 Note；Note 的 sourceCard 是创建时冻结的来源投影，删除卡片后仍可在笔记面板和导出中查看。`note-placements.ts` 在 Note 删除／恢复的外层事务内协调位置及关系；源摘录只解除／恢复评论绑定，不随 Note 删除。仓储保存使用嵌套 SAVEPOINT。创建笔记再放置是两步操作，放置失败时笔记仍在列表，不宣称跨请求原子创建。旧独立个人卡片首次编辑时通过同一 Core 用例迁入 Note，未被打开的旧卡片继续可读；不进行启动时批量迁移。

工作区刷新在响应返回时复查请求序号、内容编辑代次和已提交基线；读取期间产生编辑则保留草稿并提示，不用旧响应覆盖。视野与内容版本独立，刷新不回退本地新视野。

`note-transactions.ts` 集中 Note／Annotation 写入和通知顺序：同步生命周期事务内冻结事件快照，SQLite 提交成功后才发布，回滚时丢弃；事务外的单记录写入在持久化成功后通知。Note／位置／关系恢复失败不会向界面广播虚假的恢复状态。此模块不是持久事件队列，客户端断线后仍需读取当前快照；其他领域尚未统一此机制。

书籍是隔离根，异步结果按创建时book/session/task路由。个人编辑不能覆盖原文来源。Core拥有文件、事务、检索、账号与模型。来源用独立PDF坐标，索引可重建。模型只接收冻结输入。保存失败保留草稿，切书/退出不能静默丢失编辑。

## 目标依赖

应用外壳组合features；features通过书籍编辑会话和类型客户端协作。UI基础不依赖业务；纯工作区引擎不依赖React/DOM/Node；PDF适配提供变换，几何不能导入React阅读器。

Core HTTP调用应用操作，操作拥有事务/业务规则，存储拥有SQL/文件。共享协议不依赖应用。已验证几何、材料和引用模块逐步迁入明确位置，不按文件行数机械拆分。
