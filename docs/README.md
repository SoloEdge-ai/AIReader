# 文档索引

PR #24 的重构基线已于 2026-09-25 合入 main（eaa2403）；未完成的统一事务和验收仍是后续工作。开发者和 agent 从本页开始。

## 权威与阅读路径

用户最新决定优先，根 AGENTS 规定工程约束。[产品](product.md)、[UI](ui.md) 描述当前行为；[架构](architecture.md)、[数据协议](data-and-protocol.md) 描述当前所有权。字段以 packages/protocol/src 的 schema 为准。

[实施计划](plans/architecture-refactor.md) 描述已接受目标，按进度表判断是否实现；[边界决策](decisions/0001-refactor-boundaries.md) 和[跨实体命令决策](decisions/0002-book-edit-commands.md) 解释实现方向；verification 只证明特定提交实际检查过的内容。archive/2026-09 全部是历史材料，不作为现行要求。
[问答浮窗决策](decisions/0003-floating-chat.md) 记录 PR #24 合入后从固定右栏改为应用内浮窗的行为边界。
[主题组与格式升级决策](decisions/0004-workspace-groups-and-format-v6.md) 记录主题组身份、关系端点和不迁移旧数据的格式边界。

最近的 [Core 边界与阅读 UI 切片验证](verification/2026-09-25-http-ui-slice.md) 列出已跑的真实测试、Windows CI 与未完成项。
[提问材料并发重试验证](verification/2026-09-25-question-material-retry.md) 记录冻结材料的书籍隔离和原子回执回归。
[书籍编辑会话验证](verification/2026-09-25-book-editing-session.md) 记录 Note 与画布保存生命周期收拢及未完成的跨实体命令。
[聊天与工具写入交错验证](verification/2026-09-25-chat-tool-write.md) 记录流式回答不会覆盖工具运行结果的存储回归。
[区域摘录重试验证](verification/2026-09-25-region-command-retry.md) 记录旧入口 commandId 的摘要校验及兼容限制。
[工作区就绪边界验证](verification/2026-09-25-workspace-readiness.md) 记录 PDF 已渲染但工作区未加载时的首笔输入问题与修复。
[问答浮窗验证](verification/2026-09-25-floating-chat.md) 记录应用内拖动、缩放、会话回归与仍待 Windows 安装版验收的部分。

| 工作 | 必读 |
|---|---|
| 功能/修复 | 产品、相关 UI、相关协议、测试 |
| UI/工具/笔记 | UI、架构、开发 |
| 数据/保存/归档 | 数据协议、架构、测试 |
| Codex/材料 | 产品、数据协议、架构 |
| 构建/安装/发布 | 开发、测试与发布 |

[开发指南](development.md) · [测试与发布](testing-release.md) · [用户指南](user-guide.md)

[连续阅读桌面决策](decisions/0006-continuous-desk.md) 记录认可原型落地的布局、浮动笔记、接触分组和材料多选边界。

## 同步

行为变化更新产品/UI；职责变化更新架构；格式/接口变化更新数据协议；命令变化更新开发/发布。重要取舍记录 ADR。阶段发布前文档须准确反映实际版本。无需修改无关文档；PR 说明同步范围或无需更新的原因。不得只刷新日期/SHA制造同步假象。
