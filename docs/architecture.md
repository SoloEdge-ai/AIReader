# 架构与所有权

状态：`codex/liquidtext-alignment` 实现分支；交付门槛见[对齐计划](plans/liquidtext-alignment.md)。

Electron启动Core utility process，Core回环HTTP/WebSocket；renderer无Node权限。PDF提取在子进程，页面/文字层由PDF.js渲染。Codex使用独立账号目录与App Server stdio。聊天轮次优先用 WebSocket 更新；仅有进行中的轮次时按书籍／会话补读 HTTP 快照，以恢复可能丢失的终态事件，完成后停止轮询。

问答与笔记浮窗共用 renderer 的 `ui/floating-window` 管理拖动和尺寸手势；纯几何运算位于该模块的 `geometry`。业务保存与关闭保护留在笔记组件中。浮窗仍复用原 `ChatPanel`、会话草稿和 Core 聊天接口，仅把按书籍保存的窗口矩形写入 `ReaderPreferences`。窗口变化不修改 PDF／工作区内容版本，也不通过独立系统窗口或 Node 权限实现。

App 组合书库、双区阅读、材料、笔记和问答；`BookWorkspace` 管理 PDF／工作台交互，两个 `PdfReader` 实例分别持有 PDF 与画布视口。PDF 页面只在原文实例加载；工作台实例只绘制画布对象。跨区来源线和 AI 材料线由 `features/connections` 把 PDF、画布和浮窗端点投影到屏幕，动画帧合并几何变化，不写入永久关系。原文聚焦仍使用 PDF.js 原始页面坐标及文字层，比较视图只读取已有摘录。两套视觉风格共享布局与语义组件，仅颜色和纸面层次不同。

`features/book/BookEditingSession` 按书籍持有 Note 与 Workspace 编辑会话，串行提交跨实体命令，协调版本、离开保护和最近 100 项内容历史。Note 正文保存、新建并放置、来源增删和删除恢复通过 `POST /api/v2/books/:bookId/commands` 的一笔 SQLite 事务提交；Core 存原始回执和逆操作，提交后才发布事件。独立工作区命令保留同一内容版本协调层，用于画布纯对象操作；视口另行保存，不增加内容版本。`WorkspaceState` 与 `useBookNotes` 只提供 React 订阅和操作映射。QuestionDrafts 按 book/session 保存问题草稿。

Core 的 `book-routes` 拥有书库、阅读进度、书籍偏好、书签和 PDF 文件 HTTP；`note-routes` 拥有批注、笔记查询／导出与资源；`workspace-routes` 拥有工作区、归档、资源和材料冻结；`chat-routes` 拥有会话、轮次和回答转笔记。`BookCommands` 验证并原子提交跨 Note／工作台变更。`AiService` 拥有账号、组件和模型策略，其他服务继续按书籍作用域验证。renderer 不直接访问文件、SQLite 或 Codex 进程。

笔记会话按书籍创建，拥有已提交版本、实时草稿、串行保存、响应丢失核对和批注操作撤销；`useBookNotes` 仅处理 React 订阅与操作映射；离开保护由书籍会话统一负责。`client/notes.ts` 捕获 bookId 并提供类型化笔记操作。列表与展开编辑使用同一 `NoteEditor` 和会话快照，不再各自缓存标题／正文。普通刷新保留脏草稿的原始 revision；只有明确的“用此草稿覆盖最新版本”才重取冲突基线。较早请求的响应不能清除较新的输入。

工作区保存错误、笔迹／导出错误与连线提示通过阅读容器中的反馈层显示，而不作为 PDF 滚动内容；反馈层高于导航，但问答浮窗可以遮住画布局部，用户可移动或关闭它。反馈层限制高度、允许内部滚动，使高缩放和矮窗口仍可触达按钮，且不随 PDF 滚动消失。草稿错误仍提供重试、下载备份和明确确认后的重新加载。

桌面窗口关闭先通过固定的 renderer 保存入口等待当前书籍的 Note 与工作区草稿提交，再经 utility process 消息等待 Core 完成关闭并回执，最后不可取消地销毁窗口，避免已停库后被 `beforeunload` 留在编辑界面。App 的当前书籍保存入口调用 BookEditingSession；跨 Note／工作台操作以单条书籍级命令提交，其余已有笔记和画布草稿按顺序冲刷。切书和返回书库复用同一入口，避免重复并发保存。草稿确认保存后，Core 拒绝新请求、取消下载和长时工具／索引／聊天／Codex 任务，再断开卡住的 HTTP 连接；已进入异步处理的请求仍须完成文件／事务收尾，才关闭数据库，避免孤儿文件或库关闭后的写入。关闭中的服务拒绝新任务，防止遗留处理器重启任务。renderer 的 `features/desktop/useDesktopCloseHandshake` 拥有重复关窗合并、输入锁定、保存超时和失败恢复；App 只提供当前书籍的保存操作与错误提示。缺少入口、保存失败或超时时取消关闭、解除界面锁定并保留草稿。等待保存上限 12 秒，主进程另有 15 秒保护；超时不假定后台保存已失败，需重新确认后再关闭。Core 停止超时或失败时保持界面锁定；超时继续监听迟到回执，明确失败则不能假定可重试。原生“保留窗口／退出应用”选择在再次尝试关窗时可重新打开，不能在 Core 状态不明时重新允许编辑。浏览器开发模式由 BookEditingSession 的 `beforeunload` 脏草稿保护。

会话区分选中的标注与选中的 Note；显式 comment 操作通过书籍客户端请求 Core 原子建立关联。标注和评论可独立删除，Note 的来源引用不等于标注的活跃评论指针。只读来源投影用于展示已删除标注，不能回写为用户可编辑来源。

已拆出的 `packages/workspace-engine/src` 包含跨页笔迹、形状／套索／移动和视野缩放的纯计算。PDF 组件提供 `WorkspacePage` 坐标变换；引擎不再回引 PDF React 组件。创建形状的 ID 由调用者提供，渲染预览不生成随机实体。

引擎中的 commands 模块共享实体差量和级联关系删除投影；Core 验证并事务提交，renderer 不重复维护投影分支。`client/workspace` 组装 v2 摘要并校验回执，`WorkspaceEditingSession` 负责画板草稿、重试键、视野与纯工作台命令历史；BookEditingSession 将跨 Note／工作台命令纳入同一最近操作历史。增量回执不保存每一步的完整工作区快照。旧 v2 画布命令仍用于单实体操作，须遵守同一本书的内容版本与事务协调。

`workspace-repository.ts` 拥有 v6 工作区实体／主题组／关系／视野／回执 SQL，Workspaces、Notes 的位置删除及归档恢复统一调用它。Storage 负责数据库生命周期和外层事务，拒绝旧 records 工作区键读写；`getForBook` 对仍在 records 的领域提供带书籍条件的读取。工作区仓储从分行数据组装协议快照，但只写发生变化的实体；主题组成员、关系端点的跨书和存在性校验继续属于 Core 业务规则。主题组是单层容器，折叠不会把持久关系端点改为组 ID。`ChatRepository` 集中会话、轮次、工具运行和学习记忆的按书籍存取，保持创建轮次与提交本轮材料在同一事务内；流式回答保存及事件广播会保留仓储中较新的工具列表，工具完成会读取当前轮次后合并运行结果，避免两者用旧对象相互覆盖；`IndexRepository` 集中索引任务、目标章节、批次摘要及语义节点的按书籍存取，创建任务与目标章节同一事务。`QuestionMaterialRepository` 按书籍／会话读取冻结材料，拥有材料请求回执和记录的原子提交；并发的同请求重试只能得到首份快照，新尝试的图片由材料服务清理。图片文件写入及对象内容／来源验证仍归 `QuestionMaterials` 用例。其余领域仍有 `Library.store` 直接访问，后端职责尚未全部收拢。

若列表读取期间发生成功保存，最新刷新会重新读取，不能简单丢弃新建／删除的结果。同步到另一编辑器的正文事务不进入该编辑器的本地撤销历史；Tiptap 的文字撤销与 BookEditingSession 的内容命令历史仍是不同层次。

`packages/protocol/src` 按 reading、library、preferences、indexing、chat、images、ai、notes、events 拆分。index 仅作外部兼容导出，内部不得回引；事件已使用带书籍身份的可区分联合。运行 `pnpm typecheck` 同时验证引擎无 DOM／Node 全局和协议／引擎导入边界。

## 不变量

工作区旧命令回执、区域图片登记和 PDF 页面边界缓存仍物理存放在 records，但业务代码通过 `WorkspaceRepository` 的按书籍接口访问。区域图片文件的异步创建与失败清理由 `WorkspaceAssets` 负责；仓储仅在工作区事务内登记元数据。归档恢复复用同一登记入口，避免另有一套写法。

区域资源导出不再由笔记和工作区归档各自拼磁盘路径；它们都调用 `WorkspaceAssets.read(bookId, assetId)`，先核对本书登记，再读取文件。归档恢复仍先写新副本的文件、再在事务内登记，失败只清理新副本。

个人笔记卡片通过 noteId 引用 Note。`NoteCardContent` 只读会话快照并始终渲染轻量预览；唯一的 Tiptap 实例位于 `ExpandedNote`，从材料栏、个人卡片或摘录评论进入都打开同一展开编辑面。摘录卡片保留只读原文或区域图及定位，以 noteId 指向个人评论 Note；Note 的 sourceCard 是创建时冻结的来源投影，删除卡片后仍可在笔记面板和导出中查看。`note-placements.ts` 在 Note 删除／恢复的外层事务内协调位置、主题组归属及关系；源摘录只解除／恢复评论绑定，不随 Note 删除。仓储保存使用嵌套 SAVEPOINT。新建笔记及放置卡片使用同一书籍级命令；失败时两者均不提交，草稿与命令 ID 保留以便重试。

工作区刷新在响应返回时复查请求序号、内容编辑代次和已提交基线；读取期间产生编辑则保留草稿并提示，不用旧响应覆盖。视野与内容版本独立，刷新不回退本地新视野。

`note-transactions.ts` 集中 Note／Annotation 写入和通知顺序：同步生命周期事务内冻结事件快照，SQLite 提交成功后才发布，回滚时丢弃；事务外的单记录写入在持久化成功后通知。Note／位置／关系恢复失败不会向界面广播虚假的恢复状态。此模块不是持久事件队列，客户端断线后仍需读取当前快照；其他领域尚未统一此机制。

书籍是隔离根，异步结果按创建时book/session/task路由。个人编辑不能覆盖原文来源。Core拥有文件、事务、检索、账号与模型。来源用独立PDF坐标，索引可重建。模型只接收冻结输入。保存失败保留草稿，切书/退出不能静默丢失编辑。

## 目标依赖

应用外壳组合features；features通过书籍编辑会话和类型客户端协作。UI基础不依赖业务；纯工作区引擎不依赖React/DOM/Node；PDF适配提供变换，几何不能导入React阅读器。

Core HTTP调用应用操作，操作拥有事务/业务规则，存储拥有SQL/文件。共享协议不依赖应用。已验证几何、材料和引用模块逐步迁入明确位置，不按文件行数机械拆分。

桌面呈现、选区拖出与接触几何的边界见 [ADR 0006](decisions/0006-continuous-desk.md)。接触分组通过既有 workspace 编辑会话一次提交位置及组归属；不把显示桥当作语义关系。
