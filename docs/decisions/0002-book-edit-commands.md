# ADR 0002：跨 Note 与画布的书籍编辑命令

状态：实施目标，尚未接入；细化已接受的 [整体重构方案](../plans/architecture-refactor.md)。

当前 Note 编辑由 `NoteEditingSession` 的独立 revision／草稿队列提交，画布由 `WorkspaceEditingSession` 的 v2 命令队列提交。`BookEditingSession` 能先保存 Note 再保存位置，也能阻止带脏草稿切书，但这不是单事务：新建 Note 后放置卡片失败会留下列表中的 Note，撤销记录也分属两个会话。Core 已有若干具体生命周期事务（如删除／恢复 Note、旧卡片转 Note），不能把它们误称为通用跨实体命令。

目标采用一条按书籍限定的命令通道，而不是让 renderer 拼接两次 HTTP 写入。命令以 `bookId`、`commandId`、规范化载荷摘要、工作区内容版本和触及的 Note／Annotation revision 为前提；载荷使用受限的类型化变更，不接受任意整库 JSON。Core 在同一 SQLite 事务内检查书籍、版本、来源和引用，应用 Note、位置与关系，保存原始回执和可验证逆操作；事务提交后才发送事件。同 ID 同载荷重试返回原回执，不同载荷返回 409。视野滚动仍不进入内容版本或撤销历史。大图片使用现有临时资源验证与登记流程，不放进命令 JSON。

先贯通“创建 Note 并放置卡片”的一条纵向路径，再迁入删除／恢复和涉及关系的操作，最后由 `BookEditingSession` 接管统一的命令队列与最近 100 项历史。编辑器内输入时 Ctrl+Z 仍由编辑器处理；提交后的撤销才走书籍命令。每步都保留 v1 读取和明确的旧写入兼容期，不能让旧请求覆盖新实体。迁移期间 `NoteEditingSession` 和 `WorkspaceEditingSession` 仍各自拥有草稿，直到跨实体提交与失败恢复的端到端测试通过才移除旧历史。

首条路径的门槛：以真实 Core HTTP／SQLite 测试同命令重试、不同载荷复用、过期 Note／工作区版本、跨书引用、事务回滚、撤销／重做和重启回执；以真实渲染器测试创建后立即切书、网络响应丢失、保存失败保留草稿及两窗口竞争。仅模拟外部 Codex 进程。此记录描述目标，不宣称接口或 UI 已实现。
