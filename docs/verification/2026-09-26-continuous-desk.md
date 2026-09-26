# 连续阅读桌面：实现与验证

## 本轮范围

以 PR #26 的 `c274e6b` 为起点，将已认可原型接入正式 React／Core 应用。默认空间桌面 B，PDF 文档对象可移动、调整大小并连续阅读；支持连续并排 A。新增共享浮窗框架、浮动笔记、原文直接拖出、接触材料组、可见多选与逐项冻结 AI 材料。

架构见 [ADR 0006](../decisions/0006-continuous-desk.md)。新增模块复用 BookEditingSession、WorkspaceEditingSession 与 Core 校验；没有引入第二个画布框架或 renderer 数据权限。

## 已执行

环境：Windows 11，本地 Node 24 runtime，Chrome 浏览器。测试 PDF 由 pdf-lib 生成。

- 完整 `pnpm test`：50 个文件、97 项通过。随后新增接触转组与缩放边界回归，针对 contact／viewport／group HTTP／浮窗几何重跑 11 项通过。
- `pnpm typecheck`：通过，包括 protocol／workspace-engine 依赖边界和文档链接检查。
- 完整 `pnpm test:reader-ui`：49 项通过。涵盖双布局、真实 PDF 选区直接拖出、窄窗跨页签拖出、材料多选逐项冻结与去重、浮动编辑和来源、保存冲突／响应丢失／重开、Esc 取消以及桌面外 PDF 回源。
- 调整窗口焦点叠放后，空间桌面、文档与笔记手势取消、笔记与聊天同时可用三项回归通过。
- 真实 Core HTTP 主题组回归包含 cluster 的持久化、重启与原子撤销；纯几何回归确认桥不产生语义关系，移走单卡不会拖入远处原组成员。

## 审查

按工程边界与原型需求分别进行只读审查。发现并修复：有效 PDF 缩放与固有缩放范围混淆、回源没有恢复桌面相机、单卡跨组错误合并、键盘／批量移动丢失组归属、窄窗原生拖动未命中页签、窗口手势 Esc 未取消。原文拖出现在不静默截断正文；超过当前卡片 20,000 字限制明确拒绝并保留选区。

## 打包与限制

Portable 构建与真实 EXE 两次启动通过：首次导入生成 PDF、等待索引、写入笔记、切换主题并正常退出；第二次使用同一个隔离目录，确认保存的标题和正文存在，然后正常退出。测试未使用用户 PDF 或现有应用数据。

- 构建源码：`919f4032716d6430d8a047afeaa03a07fa33f52a`，工作树干净。随后提交仅调整验收脚本／记录，应用代码相同。
- 本地产物：`release/AIReader-Portable-0.1.0-x64.exe`，118,951,145 bytes。
- SHA-256：`EBC2A1C59FE239DE21892AC151F59FFFBC7C90F9FFB71AA5EBF80203826149C5`。
- 身份：development；DB 6／archive 4／API 2，与 `dist/build-info.json` 一致。构建执行器为 Node 24.19.0。
- 正式 dist 的 workspace、objects、materials、ink smoke 均通过。笔迹回归保留跨页、板上绘画、擦除、撤销、重开和带个人笔迹截图比较；文档平移改在可滚动的纵向范围内验证。

Windows PR 完整流水线仍以 Actions 最新结果为准；本地产物不能称为稳定发布。

本次不以原型截图或历史记录代替验收。未重新完成 516 页／500 卡片／5,000 绘图的完整性能测量，以及 Windows 150%／200% 的全部交互矩阵。安装升级、完整签名和发布仍由 Windows PR 流水线检验。测试用外部 Codex 进程替身；没有冒充实际模型服务请求成功。PR 保持草稿，不自动合并 main。
