# 测试与发布

行为边界：Core HTTP、真实临时SQLite/文件、PDF提取/渲染、上下文、模拟外部Codex。几何按纯输入输出验证。不得用内部mock掩盖事务或来源问题。

基线d7fcbc2在规划时typecheck及23文件/40测试通过，不代表重构验收。verification记录每次真实命令、提交、环境、结果和限制。

## 单分支与预发布

codex/architecture-refactor，一个Draft PR。PR更新自动检查/构建，不发Release。阶段完成后手动运行既有Windows desktop packages选择该分支，仅此手动分支允许预发布。main合入从合并提交重建正式版。

数字版本 `0.2.<run_number>`，同一安装身份；preview 设置 prerelease=true/latest=false。关于和包内 `dist/build-info.json` 显示 channel/SHA/实际数据和协议版本。产物为 Setup、Portable、SHA256SUMS.txt、build-info.json。当前数据库 v4／归档 v2；API 最高支持版本为 v2（工作区增量命令，其余仍为 v1），不代表所有接口迁移完成。标签绑定实际构建 SHA，不能覆盖其他提交的同版本。普通检查 contents:read，发布 job 单独 contents:write。

阶段验收后执行 `gh workflow run windows-release.yml --ref codex/architecture-refactor`。检查生成的 Release 为预览、Latest 未改变、SHA 与阶段提交一致，之后再决定本机安装。工作流接入和本地测试不等于远端发版已验证。

构建格式元数据统一来自 `build/format-versions.json`，修改实际数据库／归档／API 格式时同时更新；本地和 CI 构建不得各自硬编码版本。

## 验收

书籍隔离、来源冻结、模型实际图片、预算；保存失败/响应丢失/幂等/冲突/切书/退出；工具焦点/IME/取消/平移；旋转/CropBox/跨页/区域/来源返回；归档独立恢复与恶意文件拒绝。

浅深主题、1280×720/1440×900/1920×1080、100/150/200%DPI。516页/500卡片/1000关系/5000对象/250000点压力样本，记录机器/帧/长任务/内存/保存时间。

公开截图只用生成样本。安装验证覆盖preview→preview→stable，分支不改变Latest。

本次旧测试库仅在实际切换新格式时清理一次，不备份/迁移。核实绝对目标并停机；限AIReader测试内容，不含账号/runtime或Downloads原始PDF。安装器不通用清空数据。
