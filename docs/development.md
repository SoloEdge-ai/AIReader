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
| node scripts/close-save-smoke.mjs | 隔离 Electron 关闭／真实 Core 冲突与 SQLite 写锁失败恢复、重开持久化验收 |

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

桌面退出：`features/desktop/useDesktopCloseHandshake` 负责 renderer 的保存入口、重复关窗合并、12 秒截止和界面锁定；App 使用同一 `flushCurrentBook()` 处理关闭、切书及返回书库，BookWorkspace 先提交 Note 再提交画布，未挂载时只提交 Note。不要另起与它并行的保存链。修改关闭路径时运行 `node scripts/close-save-smoke.mjs` 和 `node scripts/desktop-smoke.mjs .`，覆盖真实 Core 冲突、SQLite 写锁、取消关闭、重试及 Core 回执。

Core 笔记／批注接口：`apps/core/src/note-routes.ts` 拥有这些路由的 HTTP 方法、请求大小、ZIP/PNG 响应；`Notes` 保持业务和事务规则，`server.ts` 负责鉴权及书籍路由入口。修改边界时优先运行 `tests/notes.test.ts`、`tests/answer-notes.test.ts`、`tests/note-placements-http.test.ts` 和 `tests/excerpt-comments-http.test.ts`，不要只 mock Notes 服务。

Core 工作区接口：`apps/core/src/workspace-routes.ts` 拥有命令、相机、区域图片、资源、归档和问题材料的 HTTP 方法与请求限制；`server.ts` 仍负责会话／来源鉴权、普通书籍路由的存在性检查及服务生命周期。较早分派的 `/api/v2` 命令由工作区服务检查书籍存在性。修改此边界时运行工作区、归档、区域图片及问题材料的真实 HTTP 测试；不能仅用路由 mock 代替 Core/SQLite 行为。

Core 聊天接口：`apps/core/src/chat-routes.ts` 拥有会话、轮次、冻结阅读请求、图片资源、学习目标与回答转笔记的 HTTP 契约；模型能力检查由 `server.ts` 提供的选择函数执行，实际请求归 `ChatService`，会话、轮次和学习记忆由 `ChatRepository` 按书籍存取。创建轮次和提交冻结材料共用一个 SQLite 事务。修改时运行 `tests/chat-repository.test.ts`、`tests/chat-http.test.ts`、`tests/context.test.ts`、`tests/images-http.test.ts`、`tests/answer-notes.test.ts`、`tests/region-images-http.test.ts` 及材料上下文测试。

书库与阅读接口：`apps/core/src/book-routes.ts` 处理导入、打开、PDF 文件、搜索、进度、每书偏好和书签的 HTTP 契约；`Library` 负责书籍存在性、来源文件路径和书库写入，`Preferences` 负责全局阅读、工具盘与每书布局偏好的校验、隔离和持久化，`preferences-routes.ts` 负责全局 HTTP。`server.ts` 在分派前统一做会话与来源检查。修改时运行 `tests/http.test.ts` 和 `tests/library.test.ts`；全局偏好与每书布局不得串写，跨书删除书签不得影响原书。

全局 AI 接口：`apps/core/src/ai-routes.ts` 只处理 HTTP 方法与协议形状；`AiService` 负责账号断连／退出前暂停书籍任务、组件准备切换和模型可用性校验。问答和索引通过同一个 `selectModel` 入口冻结实际配置。修改时运行 `tests/ai-http.test.ts`、`tests/chat-http.test.ts`、`tests/indexer.test.ts` 和 Codex 进程协议测试，确保断连不删本应用模型选择，而退出账号会清除选择。

书籍索引／工具接口：`apps/core/src/index-routes.ts` 和 `book-tools-routes.ts` 拥有 HTTP 形状与方法，`IndexService` 负责任务状态，`BookTools` 负责书籍工作区、沙盒验证、同书轮次取消与生成文件路径。工具执行先验证真实轮次属于当前书，再检查沙盒可用性；新增能力不得绕过后者。更改路由时运行 `tests/http.test.ts` 中真实外书轮次的停止／运行拒绝、`tests/indexer.test.ts` 和 Windows 工具验收。

桌面关闭验收：`tests/core-shutdown-http.test.ts` 用未完成的真实请求验证草稿保存后的 Core 停止不会被卡住的 HTTP 连接无限阻塞。关闭顺序必须先拒绝新请求、断开连接、等待已进入处理的异步请求完成，再关闭 SQLite；不能把连接断开等同于文件／事务处理已经结束。`scripts/close-save-smoke.mjs` 在窄窗口及 200% 网页缩放下验证冲突／写锁失败时窗口和草稿仍在、重试按钮不被导航遮挡或裁切、重试后可以关闭和重开。不要用简单增加等待时间来掩盖关闭阶段卡住。

个人卡片通过 noteId 引用笔记会话；只为选中卡片挂载编辑器，其他卡片使用轻量预览。卡片容器不得接管编辑控件内部的 Shift＋点击等文本操作。工作区刷新也必须覆盖 GET 挂起期间继续编辑的回归。浏览器开发的 CORS 预检允许现有 PUT 保存接口，来源和会话验证不变。

旧卡片转 Note 必须由 Core 在同一事务中创建、校验富文本并清除旧字段。不能仅按旧字段长度判断新文档大小：大量换行拆成富文本块会膨胀 JSON。转换失败时不得清空旧卡片；笔记独立导出和整书归档必须一并验证。
