# 数据与协议

状态：当前 DB v6、workspace 快照 v5/layoutVersion 3、归档 v4；API v2 已接入工作区增量命令和书籍级 Note／工作台原子命令。仍保留少量 v1 Note／Annotation 入口，调用方应优先使用书籍级命令。

SQLite records 仍保存笔记、批注等独立 JSON 实体，passages/FTS5 保存索引；工作区不再写整份 JSON。笔记仍有独立 revision／保存接口。

`ReaderPreferences` 将内容外的阅读布局按书籍保存：`visualStyle` 为 `professional | paper`，`splitRatio` 为 0.3–0.7，`readerPaneMode` 为 `split | pdf | board`，`pdfZoom` 与 `boardZoom` 分别为 0.4–3；可选 `pdfView` 用页码及页内归一化 x/y 保存阅读位置。`navigationWidth` 为 220–320（默认 240），可选 `chatWindow` 保存浮窗的 CSS 像素 x/y/宽/高。旧单一 `zoom` 不再属于协议。分区、视野和浮窗变化不增加工作区内容版本。

## v6 工作区存储

`WorkspaceRepository` 独占工作区 SQL。workspace_books 保存书籍工作区版本；workspace_entities 按书籍／类型／ID 分行保存卡片和对象的校验后 JSON；workspace_groups 按书籍／组 ID 分行保存单层主题组；workspace_links 单独保存端点、名称、方向与顺序；workspace_views 保存视野；workspace_receipts 保存命令摘要和原始回执。子表外键引用工作区根，清理失败恢复副本时一起删除；连线端点可能是 records 中的批注，因此端点有效性仍由 Core 在事务中校验。

读取时组装兼容快照，写入比较每个实体，仅更新变化的行。相机不属于实体快照写入；普通内容保存不会重写视野。仓储 SAVEPOINT 可以嵌入命令／批注／归档的外层事务，不提前提交外层事务。旧的通用 records 工作区快照读写入口明确报错，防止两个事实来源并存；仍在 records 的 v1 命令回执、区域图片元数据和 PDF 页面边界缓存由同一仓储以 bookId 限定读写。

启动先只读检查已有数据库版本：小于 v6 拒绝并提示使用独立目录，不迁移、不备份、不重置；高于 v6 拒绝写入。检查失败不修改数据库文件。新数据目录直接创建 v6。

workspace v5 的主题组包含 `id/title/color/x/y/width/height/memberIds/collapsed`。卡片的 `placed=false` 表示内容保留在材料库、暂不显示于工作台；默认视为已放置。移出时清除主题组成员引用，关系保留但暂不绘制，放回仍使用原坐标。成员只能是本书已放置的卡片或完全位于白板的绘图对象，一个对象最多属于一个组，组不嵌套。组折叠只改变呈现；关系仍保存真实成员端点，组本身不是关系端点。彻底删除卡片或对象时，同一命令清理所有组成员引用；删除组不删除成员。Note 生命周期删除和恢复位置时也在同一事务保存并恢复其组归属。

## 增量命令回执

`POST /api/v2/books/:id/workspace/commands` 接收 bookId、commandId、expectedContentVersion、changes、payloadHash。摘要是 `{bookId, expectedContentVersion, changes}` 的 UTF-8 JSON SHA256：对象键递归排序，数组顺序保留。Core 重算摘要，不信任客户端的值。

成功返回 bookId、commandId、payloadHash、previousVersion、contentVersion、实际 changes 和 inverse。实际差量包含级联删除的关系；不包含完整工作区或相机。实体写入与 workspace_receipts 回执同一事务提交。同命令同摘要重试返回原回执，即使后续已有编辑或 Core 重启；同 ID 不同摘要返回 409 COMMAND_ID_REUSED，旧版本返回 409 CONTENT_VERSION_CONFLICT，伪造摘要返回 400 PAYLOAD_HASH_MISMATCH。

新 renderer 的普通画板保存使用该接口，并核对回执身份及版本，再将实际差量应用于原已提交基线。不会把重试时的远端最新快照误当作原提交结果。v1 命令／区域摘录入口暂保留；新创建的 v1 回执也记录输入摘要，同 ID 不同载荷返回 409 COMMAND_ID_REUSED。v1 重试仍返回当前工作区而非原始差量回执，区域资源创建尚未迁入书籍级命令。

`POST /api/v2/books/:id/commands` 是跨 Note 与工作台的事务边界，接收同样的 bookId、commandId、expectedContentVersion、changes、payloadHash；摘要规则与工作区 v2 一致。类型化变更包括 `create-note`（同时放置唯一笔记卡片）、`update-note`、`add-source`、`remove-source`、`delete-note`、`restore-note`、`workspace` 和单独提交的 `undo`。每个 Note 更新带 expectedRevision；Core 从本书真实摘录卡片或标记冻结 `Note.sourceReferences`，不能从 renderer 提供任意原文。来源图片记录资源归属；正文 `sourceReference` 节点只保存已关联的 referenceId。删除仍被正文引用的来源会拒绝。回执持久保存正文、工作台差量、逆操作及受影响标记；同 ID 同载荷重试返回原回执，同 ID 不同载荷以及与 v1/v2 工作区命令 ID 撞车都返回 409。事务提交后才发 Note、Annotation、workspace 事件。`undo` 仅允许撤销当前最新内容版本的命令，并再次校验受影响 Note revision。

v2 变更集合最多 14000 条，覆盖两个最大工作区之间的卡片、对象、主题组和关系差量，避免级联删除产生的逆操作被旧 2000 条限制拒绝。HTTP 仍限 8 MiB；若逆操作无法在此限制内重新提交，整次变更拒绝并提示分批，不先删除再宣称可撤销。删除区域卡片时，在同一事务保留 Core 来源记录；恢复必须匹配原来源且资源仍属于本书，不能通过修改 inverse 伪造原文区域。

导入副本在books；图片在annotations/workspace-assets/chat-images/question-materials。账号在control/codex-home，组件在runtimes。区域图片的 HTTP 读取、工作区打包和源卡片笔记导出使用同一按书籍验证的资源读取入口；只有磁盘上存在 PNG 而缺少本书资源登记时不能将其打包为可信区域摘录。

持久位置为PDF原生或世界坐标，不保存CSS/设备像素。跨页笔迹按逻辑stroke分段。原始点是事实来源。材料绑定book/session/版本与冻结内容；前端预览是用户视觉材料，不代表Core已验证像素。个人材料与原文evidence分离。冻结材料及请求回执由 QuestionMaterialRepository 按书籍读取并原子提交；同一 requestId 与同一载荷并发重试返回首份快照，载荷不同则拒绝，新尝试生成的临时图片不留下额外资源目录。材料与聊天轮次的最终提交仍共用外层 SQLite 事务。

一次编辑应原子修改实体及关系。重试不能重复资源；临时资源验证后登记，失败只清理本次新文件。冲突保留草稿。

Note／Annotation 生命周期事件只在其同步事务提交后发布；失败回滚不发布暂存事件。事件正文为写入时冻结的快照，书籍和任务标识不变。不增加持久事件日志或断线重放协议；HTTP 失败后可以重新读取实体状态，不应凭未确认的通知覆盖本地草稿。

聊天面板用书籍／会话双重过滤的 `turn` 事件更新回答，不对已完成会话持续轮询。仅当本会话有进行中的轮次时，每 1.5 秒补读 Core HTTP 快照，以防终态事件在连接边界丢失；轮次完成即停。事件在 renderer 中按到达顺序短暂排队；若 HTTP 快照读取期间收到新事件，以新事件覆盖该快照中的旧回答。WebSocket 断线后重新建立会话并连接；重新联网或窗口恢复可见时也读取会话快照，补齐断线期间未收到的变化。Core 不保证事件重放，HTTP 快照仍是恢复事实来源；账号状态目前仍由独立状态层轮询。

Annotation.noteId 已可缺省；POST /api/books/:id/annotations/:annotationId/note 在事务中创建并关联评论，已有活跃评论则返回同一 Note。跨书或已删除标注拒绝。删除标注只标记其删除并处理关系，不删除 Note；删除 Note 解除源标注的活跃 noteId，不删除标注。恢复 Note 仅在源标注活跃且没有新评论时恢复活跃关联，不覆盖后来创建的评论。

Note.annotationId 保留来源引用，可能指向已删除标注或不再以该 Note 为当前评论的标注。列表返回只读 annotationSource 投影；更新正文不能修改此来源。归档保留活跃 Note 引用的标注 tombstone 和区域资源，恢复重映射 ID；导出已删除源标注时明确标识。归档 v4 允许没有 noteId 的独立标注。

Note.document 使用 Core 校验后的 Tiptap JSON。允许基础段落／标题／列表／引用／代码之外的 `table/tableRow/tableHeader/tableCell`、显式 `inlineMath/blockMath` 和 `sourceReference`；来源引用节点只保存 Core 生成的 referenceId，不能把 renderer 提供的文字当作可信原文。公式源码只保存在 `attrs.latex`，不会把正文中的 `$` 字符串自动迁移为公式。文档 JSON 上限 100000 字符、总节点上限 10000、深度上限 20、单个公式上限 20000 字符，表格最多 100 行且每行最多 50 个单元格。单元格只保留受限的合并、列宽和对齐属性；链接仅允许 http、https、mailto。AI 回答 Markdown 的 GFM 表格与公式转换为这些节点，笔记 Markdown 导出再输出表格、LaTeX 源码与来源脚注；无法由 GFM 无损表达的合并或无表头表格使用安全的 Markdown 内嵌 HTML 表格。

新个人卡片使用 WorkspaceCard.noteId 引用本书活跃 Note，每个 Note 最多一张卡片；字段 title/text/comment 必须为空，禁止卡片保存另一份正文。原文／区域摘录卡片保留不可编辑的原始 text/source/region，可用 noteId 引用评论 Note，但 comment 必须为空。Note.sourceCard 保留单一摘录评论的冻结来源；Note.sourceReferences 最多保存 500 个由 Core 从真实卡片或标记生成的冻结投影，区域图片同时记录 annotation/workspace 资源归属。删除当前对象后投影仍可解释历史引用。`POST /api/v2/books/:bookId/commands` 原子提交创建、更新、删除、恢复及来源增删并返回回执；正文保存与画布内容版本进入同一串行协调层。

删除 Note 在同一事务保存其位置／主题组归属／关系逆操作并删除个人卡片；源摘录卡片只解除评论引用。恢复时若 ID 已冲突、主题组已删除或关系端点缺失，整次恢复失败，不部分恢复。单独删除卡片不删除 Note。材料选择关联卡片必须携带 Note revision，Core 将摘录原文与评论分别分类并冻结；最终提交前再次核对 Note 版本。归档 v4 校验活跃 Note 引用、来源快照、主题组引用及单位置约束，恢复副本重映射 noteId/sourceCard.cardId、sourceReferences 的 ID／目标／资源、正文引用节点、组 ID、成员 ID 和图片资源。

归档只支持 v4；v1、v2、v3 和未知较新版本在导入前明确拒绝。保留大小、路径、hash、图片及跨书验证；恢复独立副本并重映射引用。账号、执行文件和完整聊天不入包。旧版 `.aireader` 包需用生成它的旧版应用处理，本分支不提供转换。

阅读偏好增加 `deskLayout: spatial | adjacent`（默认 spatial）、`documentRect` 和 `noteWindow`。文档矩形位于桌面单位，浮窗矩形位于窗口像素；两者均不增加内容版本。`WorkspaceGroup.presentation` 可为 frame 或 cluster，缺省按 frame 显示；软连接从 cluster 成员与位置派生，不另存永久关系。此处为当前格式内的可选字段扩展，格式版本仍为 DB v6／工作区 v5／布局 v3／归档 v4。
