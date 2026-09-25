# 架构与所有权

状态：当前架构及目标依赖，进度见[计划](plans/architecture-refactor.md)。

Electron启动Core utility process，Core回环HTTP/WebSocket；renderer无Node权限。PDF提取在子进程，页面/文字层由PDF.js渲染。Codex使用独立账号目录与App Server stdio。聊天轮次优先用 WebSocket 更新；仅有进行中的轮次时按书籍／会话补读 HTTP 快照，以恢复可能丢失的终态事件，完成后停止轮询。

当前 App 组合书库／阅读／笔记／问答，BookWorkspace/PdfReader 拥有空间交互。WorkspaceState 保存画板编辑，`features/notes/NoteEditingSession` 保存富文本笔记编辑；两者尚未合并为最终 BookEditingSession。QuestionDrafts 按 book/session 保存问题草稿。Core 的 `book-routes` 拥有书库、阅读进度、书籍偏好、书签和 PDF 文件 HTTP 契约；Library 校验书籍、来源文件及书库写入，`Preferences` 统一全局阅读、工具盘和每书布局偏好的校验与持久化，`preferences-routes` 处理全局偏好 HTTP。`note-routes` 拥有按书籍隔离的笔记／批注 HTTP、导出与资源响应；`workspace-routes` 拥有工作区命令、归档、资源和冻结提问材料的 HTTP 契约；`chat-routes` 拥有会话、轮次、图片资源、学习目标和回答转笔记的 HTTP 契约。`AiService` 统一全局账号断连、组件准备与模型选择策略，`ai-routes` 处理其 HTTP 契约；`index-routes` 与 `book-tools-routes` 分别处理每书索引任务和受限工具接口，书籍、任务与文件路径由各自服务校验。普通书籍路由由 `server` 在分派前检查书籍存在性；`/api/v2` 命令经更早的全局入口分派，由工作区服务验证书籍。通用请求体和 JSON 响应位于 `http`；Library 仍公开通用 Storage，其他领域尚未完成全部后端职责收拢。

笔记会话按书籍创建，拥有已提交版本、实时草稿、串行保存、响应丢失核对和批注操作撤销；`useBookNotes` 仅处理 React 订阅与离开保护。`client/notes.ts` 捕获 bookId 并提供类型化笔记操作。列表与展开编辑使用同一 `NoteEditor` 和会话快照，不再各自缓存标题／正文。普通刷新保留脏草稿的原始 revision；只有明确的“用此草稿覆盖最新版本”才重取冲突基线。较早请求的响应不能清除较新的输入。

工作区保存错误、笔迹／导出错误与连线提示通过阅读容器中的反馈层显示，而不作为 PDF 滚动内容；反馈层高于窄窗导航／问答抽屉，并限制高度、允许内部滚动，使高缩放和矮窗口仍可触达按钮，且不随 PDF 滚动消失。草稿错误仍提供重试、下载备份和明确确认后的重新加载。

桌面窗口关闭先通过固定的 renderer 保存入口等待当前书籍的 Note 与工作区草稿提交，再经 utility process 消息等待 Core 完成关闭并回执，最后不可取消地销毁窗口，避免已停库后被 `beforeunload` 留在编辑界面。App 的单一当前书籍保存入口由 BookWorkspace 先提交 Note、再提交可能引用它的画布；画布未挂载时直接提交 Note，切书和返回书库复用同一入口，避免重复并发保存。草稿确认保存后，Core 拒绝新请求、取消下载和长时工具／索引／聊天／Codex 任务，再断开卡住的 HTTP 连接；已进入异步处理的请求仍须完成文件／事务收尾，才关闭数据库，避免孤儿文件或库关闭后的写入。关闭中的服务拒绝新任务，防止遗留处理器重启任务。renderer 的 `features/desktop/useDesktopCloseHandshake` 拥有重复关窗合并、输入锁定、保存超时和失败恢复；App 只提供当前书籍的保存操作与错误提示。缺少入口、保存失败或超时时取消关闭、解除界面锁定并保留草稿。等待保存上限 12 秒，主进程另有 15 秒保护；超时不假定后台保存已失败，需重新确认后再关闭。Core 停止超时或失败时保持界面锁定；超时继续监听迟到回执，明确失败则不能假定可重试。原生“保留窗口／退出应用”选择在再次尝试关窗时可重新打开，不能在 Core 状态不明时重新允许编辑。这个关闭握手不等于全工作区统一编辑会话；浏览器开发模式仍由各自的 `beforeunload` 脏草稿保护。

会话区分选中的标注与选中的 Note；显式 comment 操作通过书籍客户端请求 Core 原子建立关联。标注和评论可独立删除，Note 的来源引用不等于标注的活跃评论指针。只读来源投影用于展示已删除标注，不能回写为用户可编辑来源。

已拆出的 `packages/workspace-engine/src` 包含跨页笔迹、形状／套索／移动和视野缩放的纯计算。PDF 组件提供 `WorkspacePage` 坐标变换；引擎不再回引 PDF React 组件。创建形状的 ID 由调用者提供，渲染预览不生成随机实体。

引擎中的 commands 模块共享实体差量和级联关系删除投影；Core 验证并事务提交，renderer 不重复维护投影分支。`client/workspace` 组装 v2 摘要并校验回执，WorkspaceState 仍负责现有画板草稿和队列；这不是最终 BookEditingSession。增量回执不保存每一步的完整工作区快照。

`workspace-repository.ts` 拥有 v5 工作区实体／关系／视野／回执 SQL，Workspaces、Notes 的关系删除及归档恢复统一调用它。Storage 负责数据库生命周期和外层事务，拒绝旧 records 工作区键读写；`getForBook` 对仍在 records 的领域提供带书籍条件的读取。工作区仓储从分行数据组装协议快照，但只写发生变化的实体；关系端点的跨书和存在性校验继续属于 Core 业务规则。`ChatRepository` 集中会话、轮次和学习记忆的按书籍存取，并保持创建轮次与提交本轮材料在同一事务内；`IndexRepository` 集中索引任务、目标章节、批次摘要及语义节点的按书籍存取，创建任务与目标章节同一事务。其余领域仍有 `Library.store` 直接访问，后端职责尚未全部收拢。

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
