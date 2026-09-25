# v5 工作区分行存储验证

状态：接续 e6d60ce 的阶段 2 存储切片，不代表 Note／placement、统一历史或归档 v3 已完成。

## 测试

- 版本保护测试先复现旧 v4 可被打开，改为只读检查后拒绝；校验旧版与未来版本文件不被修改。替换原 v3→v4 迁移测试是已接受的 0.2 无旧格式迁移决策，不是删掉现行迁移保障。
- 相关 Core HTTP：工作区保存、相机、回执跨重启重放、逆操作、批注关系及归档独立恢复通过。
- 完整 Vitest 26 文件／43 测试通过（62.79 秒）；Playwright 13 项通过（19.1 秒）。测试均使用临时数据库／生成 PDF。
- 类型检查及架构／文档检查通过。Windows Portable 和当前用户 Setup 构建通过；本地开发版本 0.1.0，基于 e6d60ce 加本次工作区改动，不是正式发布。
- 打包后文本／形状、跨页笔迹以及 1x DPI 批注、自动保存／失败恢复、退出保护、旋转和缩放锚点测试通过。对象／笔迹脚本中的 restart 实际为返回书库再打开；进程重启持久性由 Core HTTP 测试覆盖。
- 首次与打包并行运行的对象检查出现 Playwright `Page.handleJavaScriptDialog: No dialog is showing`，构建完成并设置 Node 24 PATH 后重跑通过，未据此断言异常根因。构建仍有 pnpm shim 引擎版本、PDF.js SVG 资源及大 chunk 等告警；脚本有既有 shell 参数弃用告警。

## 持久化测量

命令：`node --import tsx scripts/measure-workspace-writes.ts`。Windows 11 10.0.26200，Intel Core Ultra 7 155H，Node v24.19.0。生成的 1 页 PDF、500 卡片、25 万笔迹点、1000 连线；经真实 Core HTTP 写入，通过 SQLite total_changes 只读计数观察变更行。

| 操作 | HTTP 耗时 | SQLite 变更行 |
|---|---:|---:|
| 首次写入 | 817 ms | 1527 |
| 只改一张卡片 | 650 ms | 3 |
| 只移动视野 | 23 ms | 1 |

这是单次存储测量，不是统计分位数或完整性能验收。单卡保存仍经过全量快照与校验，650 ms 是后续优化项；没有验证 516 页渲染帧率、长任务或全部 DPI。不得据此宣称“性能正常”。

## Standards

独立静态审查无新增违规或阻断项。仓储 SAVEPOINT 保留外层事务、视野独立、失败副本级联清理及只读版本保护符合规范。

## Spec

独立静态审查无新增明确问题。符合工作区实体存储及事务边界；Note／placement、归档 v3 和性能优化仍是未完成项。

未安装、未清理本机书库、未发布预览。当前 DB v5，快照／layoutVersion 仍为 4／2，归档仍为 v2。
