# 数据与协议

状态：当前 DB v4、workspace v4/layoutVersion 2、归档 v2；API v2 已接入工作区增量命令，其他接口仍为 v1。目标 DB v5／归档 v3 尚未启用。

SQLite records保存JSON实体，passages/FTS5保存索引。workspace命令检查expectedVersion，视野单独保存；目前仍写整份workspace记录。笔记有独立revision/保存接口。

## 增量命令回执

`POST /api/v2/books/:id/workspace/commands` 接收 bookId、commandId、expectedContentVersion、changes、payloadHash。摘要是 `{bookId, expectedContentVersion, changes}` 的 UTF-8 JSON SHA256：对象键递归排序，数组顺序保留。Core 重算摘要，不信任客户端的值。

成功返回 bookId、commandId、payloadHash、previousVersion、contentVersion、实际 changes 和 inverse。实际差量包含级联删除的关系；不包含完整工作区或相机。内容写入与回执同一事务提交，回执暂存 records 的 workspace-receipt-v2 类别，等待 v5 存储重构。同命令同摘要重试返回原回执，即使后续已有编辑或 Core 重启；同 ID 不同摘要返回 409 COMMAND_ID_REUSED，旧版本返回 409 CONTENT_VERSION_CONFLICT，伪造摘要返回 400 PAYLOAD_HASH_MISMATCH。

新 renderer 的普通画板保存使用该接口，并核对回执身份及版本，再将实际差量应用于原已提交基线。不会把重试时的远端最新快照误当作原提交结果。v1 命令／区域摘录入口暂保留兼容；区域资源创建、Note 命令和全工作区统一历史尚未迁入 v2，不能声称所有保存路径已经统一。

v2 变更集合最多 13000 条，覆盖两个最大工作区之间的差量，避免级联删除产生的逆操作被旧 2000 条限制拒绝。HTTP 仍限 8 MiB；若逆操作无法在此限制内重新提交，整次变更拒绝并提示分批，不先删除再宣称可撤销。删除区域卡片时，在同一事务保留 Core 来源记录；恢复必须匹配原来源且资源仍属于本书，不能通过修改 inverse 伪造原文区域。

导入副本在books；图片在annotations/workspace-assets/chat-images/question-materials。账号在control/codex-home，组件在runtimes。

持久位置为PDF原生或世界坐标，不保存CSS/设备像素。跨页笔迹按逻辑stroke分段。原始点是事实来源。材料绑定book/session/版本与冻结内容；前端预览是用户视觉材料，不代表Core已验证像素。个人材料与原文evidence分离。

一次编辑应原子修改实体及关系。重试不能重复资源；临时资源验证后登记，失败只清理本次新文件。冲突保留草稿。

目标：Note保存唯一富文本，Placement只引用内容及位置；Annotation可无Note，Excerpt原文不可变。v5按实体/外键保存，单实体payload可用校验JSON。commandId绑定摘要和原结果，错误使用稳定code。

归档当前支持v1/v2；重构切换v3后只支持v3。保留大小、路径、hash、图片及跨书验证；恢复独立副本并重映射引用。账号、执行文件和完整聊天不入包。
