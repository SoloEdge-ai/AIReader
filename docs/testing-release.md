# 测试与发布

行为边界：Core HTTP、真实临时SQLite/文件、PDF提取/渲染、上下文、模拟外部Codex。几何按纯输入输出验证。不得用内部mock掩盖事务或来源问题。

历史基线的测试记录不代表本次 LiquidText 对齐验收。`verification` 记录每次真实命令、提交、环境、结果和限制；本次使用生成 PDF、真实 Core HTTP／SQLite／PDF.js 与浏览器界面。

## PR 检查与发布

PR #24 已合入 main；后续功能继续使用 `codex/*` 分支、PR 检查和 squash merge。PR 更新自动检查／构建并提供可下载安装包，不发正式 Release。main 合入从合并提交重建正式版。手动分支预发布工作流目前只允许 `codex/architecture-refactor`，新分支不可假定自动具备预发布权限。

数字版本 `0.2.<run_number>`，同一安装身份；preview 设置 prerelease=true/latest=false。关于和包内 `dist/build-info.json` 显示 channel/SHA/实际数据和协议版本。产物为 Setup、Portable、SHA256SUMS.txt、build-info.json。当前数据库 v6／工作区快照 v5／布局 v3／归档 v4；API v2 包含工作区及书籍级原子命令，其余接口仍逐步迁移。标签绑定实际构建 SHA，不能覆盖其他提交的同版本。普通检查 contents:read，发布 job 单独 contents:write。

若仍需为允许的历史重构分支手动预发布，可执行 `gh workflow run windows-release.yml --ref codex/architecture-refactor`，并核对 prerelease、Latest 和 SHA；其他新分支需先明确扩展工作流规则。工作流接入和本地测试不等于远端发版已验证。

构建格式元数据统一来自 `build/format-versions.json`，修改实际数据库／归档／API 格式时同时更新；本地和 CI 构建不得各自硬编码版本。

## 验收

书籍隔离、来源冻结、模型实际图片、预算；保存失败/响应丢失/幂等/冲突/切书/退出；工具焦点/IME/取消/平移；旋转/CropBox/跨页/区域/来源返回；归档独立恢复与恶意文件拒绝。

浅深主题、1280×720/1440×900/1920×1080、100/150/200%DPI。516页/500卡片/1000关系/5000对象/250000点压力样本，记录机器/帧/长任务/内存/保存时间。

桌面关闭回归运行 `node scripts/close-save-smoke.mjs`：在隔离数据目录中通过真实 Core HTTP 制造笔记版本冲突，再用独立 SQLite 连接持有写锁使画板提交失败；每次确认窗口和草稿仍在，解除冲突／写锁并重试后关闭，重开核对笔记和对象都已持久化。测试把窗口缩到 1080px，随后以 200% 页面缩放检查反馈层边界、内部滚动和重试按钮的实际命中。没有拦截 Core 请求。公共 CI 在构建后执行，不能代替真实安装版在 Windows 11 上的关闭验收。

满载合成样本可先执行 `node --expose-gc --import tsx scripts/workspace-performance.ts`，再将机器、样本构成、时间和局限记录到 verification。此脚本是手动压力测量，不代替真实复杂 PDF 或 Windows 11 安装验收；[初次记录](verification/2026-09-24-workspace-performance.md) 已明确留有内存和连续编辑问题。

公开截图只用生成样本。安装验证覆盖preview→preview→stable，分支不改变Latest。

用户已明确允许放弃旧笔记／工作区兼容。本分支启用 v6，但安装器和运行时代码不自动删除或重写旧目录；旧库由版本检查拒绝。所有本地和 CI 测试指定隔离数据目录。旧数据处理与安装升级验收分别记录，不能把拒绝旧库当成迁移成功。
