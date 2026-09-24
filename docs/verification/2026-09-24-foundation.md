# 重构基础阶段验证

状态：阶段 0／1 工作进行中，不是整体重构验收。基线 `d7fcbc21ea9c3f428ed81160849119d3f27e72cd`，分支 `codex/architecture-refactor`。

环境：Windows 11 x64（构建日志 10.0.26200）、Node 24.19.0、pnpm 10.33.0、Electron 44.4.3。通过绝对路径调用 Node 24 与 pnpm 脚本；桌面打包的嵌套 pnpm 仍经过本机 Node 22 shim 并输出 engines 警告，不应误称所有进程都使用 Node 24。

## 已验证

- `pnpm typecheck`：应用类型、纯引擎无 DOM／Node 全局、协议／引擎导入及当前文档链接通过。
- `pnpm test`：24 文件、41 测试通过，57.57 秒。此后新增依赖检查器行为测试单独通过；最终汇总待再次运行。
- 发布身份测试先因缺少脚本失败，实现后通过：预览／检查／正式渠道区分，拒绝未批准的手动发布分支；实际数字版本和提交写入产物元数据。
- 边界检查器在真实临时目录验证：拒绝引擎 Node 导入／回引 Renderer、协议 barrel 循环和当前文档失效链接。历史文档不作为当前规范校验。
- `pnpm test:reader-ui` 等价 Node 24 Playwright 命令：5 项通过，10.3 秒；底部／两侧收起位置、键盘收起、工作区菜单回归。
- 生成样本截图：本地 `test-results/palette-collapsed.png`、`test-results/workspace-menu.png`，不含用户书籍。已目视检查收起截图；不代表新版三栏或深色／高 DPI 全量验收。
- `pnpm desktop:windows`：web 构建及 bundled Core HTTP smoke 通过；完整打包结果待记录。

## 未交付／限制

- 未手动发布 Preview，未验证远端 Latest 状态；未安装、未清理本机内容。
- 仍为数据 v4／归档 v2／API v1。统一 Note、实体事务、原始命令回执、统一编辑会话、三栏 UI、事件驱动聊天、优雅退出及压力验收尚未完成。
- 包体仍有大 chunk 提示及 PDF.js CSS 引用图片提示；本次未通过关闭警告掩盖它们。
- 工具盘拖动缺陷仍待交互阶段；本次只保留已有收起行为。
