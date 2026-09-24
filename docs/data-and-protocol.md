# 数据与协议

状态：当前DB v4、workspace v4/layoutVersion 2、归档v2；目标DB v5/归档v3/API v2尚未启用。

SQLite records保存JSON实体，passages/FTS5保存索引。workspace命令检查expectedVersion，视野单独保存；目前仍写整份workspace记录。笔记有独立revision/保存接口。

导入副本在books；图片在annotations/workspace-assets/chat-images/question-materials。账号在control/codex-home，组件在runtimes。

持久位置为PDF原生或世界坐标，不保存CSS/设备像素。跨页笔迹按逻辑stroke分段。原始点是事实来源。材料绑定book/session/版本与冻结内容；前端预览是用户视觉材料，不代表Core已验证像素。个人材料与原文evidence分离。

一次编辑应原子修改实体及关系。重试不能重复资源；临时资源验证后登记，失败只清理本次新文件。冲突保留草稿。

目标：Note保存唯一富文本，Placement只引用内容及位置；Annotation可无Note，Excerpt原文不可变。v5按实体/外键保存，单实体payload可用校验JSON。commandId绑定摘要和原结果，错误使用稳定code。

归档当前支持v1/v2；重构切换v3后只支持v3。保留大小、路径、hash、图片及跨书验证；恢复独立副本并重映射引用。账号、执行文件和完整聊天不入包。
