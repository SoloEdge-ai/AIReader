# 数据与协议

状态：当前 DB v5、workspace 快照 v4/layoutVersion 2、归档 v2；API v2 已接入工作区增量命令，其他接口仍为 v1。Note／placement 统一和归档 v3 尚未完成。

SQLite records 仍保存笔记、批注等独立 JSON 实体，passages/FTS5 保存索引；工作区不再写整份 JSON。笔记仍有独立 revision／保存接口。

## v5 工作区存储

`WorkspaceRepository` 独占工作区 SQL。workspace_books 保存书籍工作区版本；workspace_entities 按书籍／类型／ID 分行保存卡片和对象的校验后 JSON；workspace_links 单独保存端点、名称、方向与顺序；workspace_views 保存视野；workspace_receipts 保存命令摘要和原始回执。子表外键引用工作区根，清理失败恢复副本时一起删除；连线端点可能是 records 中的批注，因此端点有效性仍由 Core 在事务中校验。

读取时组装兼容快照，写入比较每个实体，仅更新变化的行。相机不属于实体快照写入；普通内容保存不会重写视野。仓储 SAVEPOINT 可以嵌入命令／批注／归档的外层事务，不提前提交外层事务。旧的通用 records 工作区读写入口明确报错，防止两个事实来源并存。

启动先只读检查已有数据库版本：小于 v5 拒绝并提示使用独立目录，不自动迁移／重置；高于 v5 拒绝写入。当前本机旧测试数据的独立清理授权不等于安装器可自动删除任意数据库。后续 v5 预览重启直接复用已有实体表。

## 增量命令回执

`POST /api/v2/books/:id/workspace/commands` 接收 bookId、commandId、expectedContentVersion、changes、payloadHash。摘要是 `{bookId, expectedContentVersion, changes}` 的 UTF-8 JSON SHA256：对象键递归排序，数组顺序保留。Core 重算摘要，不信任客户端的值。

成功返回 bookId、commandId、payloadHash、previousVersion、contentVersion、实际 changes 和 inverse。实际差量包含级联删除的关系；不包含完整工作区或相机。实体写入与 workspace_receipts 回执同一事务提交。同命令同摘要重试返回原回执，即使后续已有编辑或 Core 重启；同 ID 不同摘要返回 409 COMMAND_ID_REUSED，旧版本返回 409 CONTENT_VERSION_CONFLICT，伪造摘要返回 400 PAYLOAD_HASH_MISMATCH。

新 renderer 的普通画板保存使用该接口，并核对回执身份及版本，再将实际差量应用于原已提交基线。不会把重试时的远端最新快照误当作原提交结果。v1 命令／区域摘录入口暂保留兼容；区域资源创建、Note 命令和全工作区统一历史尚未迁入 v2，不能声称所有保存路径已经统一。

v2 变更集合最多 13000 条，覆盖两个最大工作区之间的差量，避免级联删除产生的逆操作被旧 2000 条限制拒绝。HTTP 仍限 8 MiB；若逆操作无法在此限制内重新提交，整次变更拒绝并提示分批，不先删除再宣称可撤销。删除区域卡片时，在同一事务保留 Core 来源记录；恢复必须匹配原来源且资源仍属于本书，不能通过修改 inverse 伪造原文区域。

导入副本在books；图片在annotations/workspace-assets/chat-images/question-materials。账号在control/codex-home，组件在runtimes。

持久位置为PDF原生或世界坐标，不保存CSS/设备像素。跨页笔迹按逻辑stroke分段。原始点是事实来源。材料绑定book/session/版本与冻结内容；前端预览是用户视觉材料，不代表Core已验证像素。个人材料与原文evidence分离。

一次编辑应原子修改实体及关系。重试不能重复资源；临时资源验证后登记，失败只清理本次新文件。冲突保留草稿。

Annotation.noteId 已可缺省；POST /api/books/:id/annotations/:annotationId/note 在事务中创建并关联评论，已有活跃评论则返回同一 Note。跨书或已删除标注拒绝。删除标注只标记其删除并处理关系，不删除 Note；删除 Note 解除源标注的活跃 noteId，不删除标注。恢复 Note 仅在源标注活跃且没有新评论时恢复活跃关联，不覆盖后来创建的评论。

Note.annotationId 保留来源引用，可能指向已删除标注或不再以该 Note 为当前评论的标注。列表返回只读 annotationSource 投影；更新正文不能修改此来源。归档保留活跃 Note 引用的标注 tombstone 和区域资源，恢复重映射 ID；导出已删除源标注时明确标识。当前归档仍为 v2，允许没有 noteId 的独立标注，完整 v3 仍待后续阶段。

后续目标：Note 保存唯一富文本，Placement 只引用内容及位置，Excerpt 原文不可变。现有 Note 和卡片正文尚未合并，不能因数据库已使用 v5 就视为领域重构完成。Note 接口仍为 v1，尚未获得 v2 命令回执和统一跨实体历史。

归档当前支持v1/v2；重构切换v3后只支持v3。保留大小、路径、hash、图片及跨书验证；恢复独立副本并重映射引用。账号、执行文件和完整聊天不入包。
