# 开发指南

Windows11 x64、Node24.19.0+、pnpm10.33.0。确认实际node --version；不能只检查配置。桌面使用Electron内置运行时。

| 命令 | 用途 |
|---|---|
| pnpm install --frozen-lockfile | 安装 |
| pnpm dev | Core/Vite，浏览器127.0.0.1:5173 |
| pnpm typecheck | 应用类型检查、纯引擎无 DOM／Node 检查、协议／引擎依赖边界及当前文档链接检查 |
| pnpm test | 构建worker并运行行为测试 |
| pnpm test:reader-ui | 工具盘/菜单浏览器验收 |
| pnpm build | 桌面/Core/web构建与Core smoke |
| pnpm desktop:windows | Setup和Portable |
| pnpm test:e2e | 桌面smoke |

开发默认数据位置与桌面相同；隔离时显式设置AIREADER_DATA为临时目录。测试不得使用用户数据库。`pnpm test:e2e` 现在默认创建并清理独立临时数据库，避免旧测试库版本阻止窗口启动；安装连续性测试通过 `AIREADER_SMOKE_USE_DEFAULT=1` 明确选择受控的安装测试目录，不能对用户默认目录运行。工作前读索引/规范、检查分支/用户改动；按可观察流程实现、验证、同步文档，再提交。

当前分支使用 DB v5，不会打开旧 v4 目录。开发／预览必须配置独立 AIREADER_DATA，不要为了启动而删除默认用户目录。`node --import tsx scripts/measure-workspace-writes.ts` 用生成样本和临时目录测量 HTTP 耗时及 SQLite 实际变更行数；它不是绘画帧率或 516 页性能验收。

`node --import tsx scripts/manual-pdf-acceptance.ts <本机 PDF 路径> [页码] [设备像素比]` 用隔离临时库经界面及 Core HTTP 检查私有复杂 PDF 的导入、阅读页和指定页面完成渲染，设备像素比仅接受 1、1.5、2。截图保存在忽略的 `.local/screenshots`，不得提交；它不是 Windows 系统显示缩放或长时性能验收。

## 扩展约束

新增工具：声明状态/快捷键/取消、UI设置、几何与命令；验证IME和临时平移。

新增对象：schema、Core事务校验、呈现/命中、材料投影、资源来源、归档及跨书/撤销验收。

新增AI材料：Core读取/版本校验、加入时冻结、实际发送预览、预算/图片上限、引用类别、删除后可用性。

新模块入口稳定后补完整例子；不把尚未存在的目标目录写成现状。

新增笔记生命周期操作使用 `NoteTransactions.run` 包含同步数据库变更，Note／Annotation 通过其 `save` 写入；不得在事务回调里直接广播成功事件、执行异步操作或嵌套生命周期事务。区域文件准备在事务前完成。测试同时检查失败后的 HTTP 状态和 WebSocket 通知，不能只验证数据库回滚。

笔记编辑视图：复用 `features/notes/NoteEditor`，传入当前书籍会话快照中的 Note 和 edit 操作。不要复制 document／title 到组件本地 state，不要在视图内另建 HTTP 保存定时器。外层只在 `flush()` 返回 true 后切书／关闭编辑；普通 refresh 不等于用户批准覆盖远端修改。新增保存路径必须覆盖较旧响应到达时已有新输入的情况。

个人卡片通过 noteId 引用笔记会话；只为选中卡片挂载编辑器，其他卡片使用轻量预览。卡片容器不得接管编辑控件内部的 Shift＋点击等文本操作。工作区刷新也必须覆盖 GET 挂起期间继续编辑的回归。浏览器开发的 CORS 预检允许现有 PUT 保存接口，来源和会话验证不变。

旧卡片转 Note 必须由 Core 在同一事务中创建、校验富文本并清除旧字段。不能仅按旧字段长度判断新文档大小：大量换行拆成富文本块会膨胀 JSON。转换失败时不得清空旧卡片；笔记独立导出和整书归档必须一并验证。
