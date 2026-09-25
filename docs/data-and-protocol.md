# 数据与协议

状态：当前 DB v5、workspace 快照 v4/layoutVersion 2、归档 v3；API v2 已接入工作区增量命令，其他接口仍为 v1。个人 Note 引用卡片已接入，完整 Note／placement 统一尚未完成。

SQLite records 仍保存笔记、批注等独立 JSON 实体，passages/FTS5 保存索引；工作区不再写整份 JSON。笔记仍有独立 revision／保存接口。

`ReaderPreferences` 新增 `navigationWidth`（220–320，默认 240），按书籍保存；旧偏好缺省时由协议补默认值。历史 `panel: "notes"` 仍可读取，renderer 打开该书时把笔记入口显示在左侧材料栏、问答放右侧，不在 Core 中破坏性改写旧记录。

## v5 工作区存储

`WorkspaceRepository` 独占工作区 SQL。workspace_books 保存书籍工作区版本；workspace_entities 按书籍／类型／ID 分行保存卡片和对象的校验后 JSON；workspace_links 单独保存端点、名称、方向与顺序；workspace_views 保存视野；workspace_receipts 保存命令摘要和原始回执。子表外键引用工作区根，清理失败恢复副本时一起删除；连线端点可能是 records 中的批注，因此端点有效性仍由 Core 在事务中校验。

读取时组装兼容快照，写入比较每个实体，仅更新变化的行。相机不属于实体快照写入；普通内容保存不会重写视野。仓储 SAVEPOINT 可以嵌入命令／批注／归档的外层事务，不提前提交外层事务。旧的通用 records 工作区读写入口明确报错，防止两个事实来源并存。

启动先只读检查已有数据库版本：小于 v5 拒绝并提示使用独立目录，不自动迁移／重置；高于 v5 拒绝写入。当前本机旧测试数据的独立清理授权不等于安装器可自动删除任意数据库。后续 v5 预览重启直接复用已有实体表。

## 增量命令回执

`POST /api/v2/books/:id/workspace/commands` 接收 bookId、commandId、expectedContentVersion、changes、payloadHash。摘要是 `{bookId, expectedContentVersion, changes}` 的 UTF-8 JSON SHA256：对象键递归排序，数组顺序保留。Core 重算摘要，不信任客户端的值。

成功返回 bookId、commandId、payloadHash、previousVersion、contentVersion、实际 changes 和 inverse。实际差量包含级联删除的关系；不包含完整工作区或相机。实体写入与 workspace_receipts 回执同一事务提交。同命令同摘要重试返回原回执，即使后续已有编辑或 Core 重启；同 ID 不同摘要返回 409 COMMAND_ID_REUSED，旧版本返回 409 CONTENT_VERSION_CONFLICT，伪造摘要返回 400 PAYLOAD_HASH_MISMATCH。

新 renderer 的普通画板保存使用该接口，并核对回执身份及版本，再将实际差量应用于原已提交基线。不会把重试时的远端最新快照误当作原提交结果。v1 命令／区域摘录入口暂保留兼容；新创建的 v1 回执也记录输入摘要，同 ID 不同载荷返回 409 COMMAND_ID_REUSED，已有无摘要的旧回执保留原重试行为。v1 重试仍返回当前工作区而非原始差量回执，区域资源创建、Note 命令和全工作区统一历史尚未迁入 v2，不能声称所有保存路径已经统一。

v2 变更集合最多 13000 条，覆盖两个最大工作区之间的差量，避免级联删除产生的逆操作被旧 2000 条限制拒绝。HTTP 仍限 8 MiB；若逆操作无法在此限制内重新提交，整次变更拒绝并提示分批，不先删除再宣称可撤销。删除区域卡片时，在同一事务保留 Core 来源记录；恢复必须匹配原来源且资源仍属于本书，不能通过修改 inverse 伪造原文区域。

导入副本在books；图片在annotations/workspace-assets/chat-images/question-materials。账号在control/codex-home，组件在runtimes。

持久位置为PDF原生或世界坐标，不保存CSS/设备像素。跨页笔迹按逻辑stroke分段。原始点是事实来源。材料绑定book/session/版本与冻结内容；前端预览是用户视觉材料，不代表Core已验证像素。个人材料与原文evidence分离。冻结材料及请求回执由 QuestionMaterialRepository 按书籍读取并原子提交；同一 requestId 与同一载荷并发重试返回首份快照，载荷不同则拒绝，新尝试生成的临时图片不留下额外资源目录。材料与聊天轮次的最终提交仍共用外层 SQLite 事务。

一次编辑应原子修改实体及关系。重试不能重复资源；临时资源验证后登记，失败只清理本次新文件。冲突保留草稿。

Note／Annotation 生命周期事件只在其同步事务提交后发布；失败回滚不发布暂存事件。事件正文为写入时冻结的快照，书籍和任务标识不变。不增加持久事件日志或断线重放协议；HTTP 失败后可以重新读取实体状态，不应凭未确认的通知覆盖本地草稿。

聊天面板用书籍／会话双重过滤的 `turn` 事件更新回答，不对已完成会话持续轮询。仅当本会话有进行中的轮次时，每 1.5 秒补读 Core HTTP 快照，以防终态事件在连接边界丢失；轮次完成即停。事件在 renderer 中按到达顺序短暂排队；若 HTTP 快照读取期间收到新事件，以新事件覆盖该快照中的旧回答。WebSocket 断线后重新建立会话并连接；重新联网或窗口恢复可见时也读取会话快照，补齐断线期间未收到的变化。Core 不保证事件重放，HTTP 快照仍是恢复事实来源；账号状态目前仍由独立状态层轮询。

Annotation.noteId 已可缺省；POST /api/books/:id/annotations/:annotationId/note 在事务中创建并关联评论，已有活跃评论则返回同一 Note。跨书或已删除标注拒绝。删除标注只标记其删除并处理关系，不删除 Note；删除 Note 解除源标注的活跃 noteId，不删除标注。恢复 Note 仅在源标注活跃且没有新评论时恢复活跃关联，不覆盖后来创建的评论。

Note.annotationId 保留来源引用，可能指向已删除标注或不再以该 Note 为当前评论的标注。列表返回只读 annotationSource 投影；更新正文不能修改此来源。归档保留活跃 Note 引用的标注 tombstone 和区域资源，恢复重映射 ID；导出已删除源标注时明确标识。归档 v3 允许没有 noteId 的独立标注。

新个人卡片使用 WorkspaceCard.noteId 引用本书活跃 Note，每个 Note 最多一张卡片；兼容字段 title/text/comment 必须为空，禁止卡片保存另一份正文。原文／区域摘录卡片保留不可编辑的原始 text/source/region，可用 noteId 引用评论 Note，但 comment 必须为空。`POST /api/books/:id/workspace/cards/:cardId/note` 在一个数据库事务中把旧纯文本评论或独立个人卡片转成 Note 并绑定卡片；个人卡片的 title/text/comment 清空，重复请求返回现有 Note。Note.sourceCard 冻结卡片来源，删除源卡片后仍保留，归档恢复会重映射来源卡片及图片资源 ID。旧无 noteId 的独立个人卡片在首次编辑前仍可阅读，但界面不再写旧正文路径。Note 接口仍为 v1，尚未获得 v2 命令回执和统一跨实体历史。

删除 Note 在同一事务保存其位置／关系逆操作并删除个人卡片；源摘录卡片只解除评论引用。恢复时若 ID 已冲突或关系端点缺失，整次恢复失败，不部分恢复。单独删除卡片不删除 Note。材料选择关联卡片必须携带 Note revision，Core 将摘录原文与评论分别分类并冻结；最终提交前再次核对 Note 版本。归档 v3 校验活跃 Note 引用、来源快照及单位置约束，恢复副本重映射 noteId/sourceCard.cardId 和图片资源。

归档只支持 v3；v1、v2 和未知较新版本在导入前明确拒绝。保留大小、路径、hash、图片及跨书验证；恢复独立副本并重映射引用。账号、执行文件和完整聊天不入包。旧版 `.aireader` 包需用生成它的旧版应用处理，本分支不提供转换。
