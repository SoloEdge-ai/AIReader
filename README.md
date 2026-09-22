# AIReader

面向 **Windows 11 x64** 的本地 PDF 阅读器。选中原文提问，查看可回跳的引用，并在长对话中保持有界上下文。

[下载最新免安装 EXE](https://github.com/SoloEdge-ai/AIReader/releases/latest) · [构建记录](https://github.com/SoloEdge-ai/AIReader/actions)

## 使用

1. 下载 `AIReader-Portable-<version>-x64.exe`，直接运行，无需 Node、Python 或 WSL。发布附带 `SHA256SUMS.txt`。首版未签名，Windows 可能显示发布者提示。
2. 导入文本型 PDF；不连接 AI 也能阅读、搜索、添加书签及保存进度。扫描页可显示，但首版没有 OCR。
3. AI 功能需要本机 **Codex CLI 0.155.1 或更新的稳定版本**。点击“连接本机 Codex”，优先复用现有 ChatGPT 登录；设置中可指定原生 `codex.exe` 路径。缺少程序时先安装 Codex。
4. 选中文字后选择解释／总结／翻译，或直接提问。回答中的页码按钮返回相应原文。“本轮上下文”显示取证范围和估算用量。

程序可移动，书库数据保存在 `%LOCALAPPDATA%\AIReader`，更换 EXE 不会重置书库。导入的 PDF 会复制到本地书库；退出 AIReader 的连接不会退出其他 Codex 客户端的登录。

## 索引与隐私

本地解析提供关键词检索。提问后按需建立当前章节的语义导航；“全书深度索引”只有主动启动后才会分批发送更多原文。AI 问答与索引使用当前 Codex 账户的服务及用量；应用不承诺云端离线处理。应用自身不上传整个 PDF 文件，但完整索引累计可能发送全书文本。

完整聊天在本地保存，每轮新建模型线程并筛选近期对话、用户目标和证据。应用输入估算预算为 12,000 tokens；Codex 的运行时指令等额外开销单独显示。章节不完整、扫描页或证据预算受限时，必须按部分覆盖解读回答。

## 编程工具限制

工具仅面向单本书的独立工作区，生成材料不作为原文引用。启用前必须通过工作区写入、外部读取／写入拒绝和网络拒绝探针。

**目前本机实测 Codex 0.155.1 的 Windows elevated 沙盒要求根目录读取权限，不能满足本应用的书籍隔离要求，因此执行入口保持禁用。** UI 会显示具体检测结果；不会通过放宽文件读取权限绕过验证。脚本执行、停止和产物下载链路已实现，只有兼容沙盒通过检测后才可使用。

## 开发与验证

需要 Windows 11 x64、Node **24.19.0+**、pnpm 10.33.0。Node 24 提供带 FTS5 的内置 SQLite；无需额外原生 SQLite 模块。

```powershell
corepack enable
pnpm install --frozen-lockfile
pnpm dev
# 浏览器打开 http://127.0.0.1:5173
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
pnpm desktop:portable
```

开发模式和桌面模式共用 Core HTTP/WebSocket 协议。React 不拥有 Node 权限；Core 仅监听回环地址并验证来源和会话。数据层支持升级前备份和新版本数据库拒写。

所有实现经 PR，`main` 对管理员同样受保护，仅 squash merge。每次 PR 更新生成保留 30 天的 EXE；合并后发布新版本。CI 使用生成的测试 PDF 和模拟 Codex，不保存账户凭证或用户书籍。

[实施规格](docs/SPEC.md) · [验收与限制](docs/VERIFICATION.md) · [审查记录](docs/REVIEW.md)
Local-first PDF reading with grounded AI conversations for Windows 11
