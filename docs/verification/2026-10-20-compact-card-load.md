# 紧凑卡片加载修复验证

日期：2026-10-20；Windows 11 x64，Node 24.19.0，pnpm 10.33.0。

## 原因与已实现

问题出现在仍运行 0.2.145 的安装程序读取已有 120／128 高度卡片时：旧 Core 的 schema 要求高度至少 160，整个 workspace GET 返回 400，renderer 因而无法加载工作区。当前仓库和正式版 0.2.149 已允许高度至少 120；只刷新旧程序无法解决。

本轮在现有紧凑规则上进一步让卡片 schema、笔记 placement 和 renderer 缩放共用尺寸约束；新增实际打包程序的回归并接入 Windows PR 构建。没有迁移、抬高或删除已有卡片数据。

源码验证基于 `codex/citation-preview-navigation` 的未提交工作树，HEAD 为 `b1f232a`，包含开始本次任务前已有的暂存改动。本记录不将该 SHA 称为包含本轮改动的提交，也不代表远端 PR 已通过。

## 本次实际验证

- `pnpm typecheck`：通过，包含类型、引擎依赖和现行文档链接检查。
- `pnpm test`：51 个文件、95 项通过。包括真实 Core HTTP、SQLite、笔记命令、区域、归档与存储回归。
- `pnpm desktop:windows`：成功构建 Core／web／桌面、打包 Core HTTP smoke、Windows Setup 和 Portable。本地包仍标记 0.1.0／development／dirty，不是新的正式发布。
- `node --import tsx scripts/compact-cards-packaged-smoke.ts <实际程序路径>`：先直接写入隔离 v6 数据库中的已有 120／128 高度摘录卡片，然后运行目标桌面程序，检查 workspace HTTP 200、卡片挂载、120 高度笔记命令保存、退出重启后的卡片尺寸。重启截图已人工检查，两个摘录和一张笔记均正常显示。
- 对原安装版 0.2.145 运行上述脚本：确定失败，HTTP 400，错误分别为 `cards[0].height`、`cards[1].height` 最小值 160，与报告一致。
- 对本地 `dist` 桌面、`release/win-unpacked/AIReader.exe`、从正式 0.2.149 安装包解出的程序，以及升级后的实际安装目录程序运行同一脚本：全部通过。

正式安装包来自仓库 release `v0.2.149`；发布元数据为 stable、提交 `332965a1b084f323e29c2b505f53db354b5a5019`、DB 6／archive 4／API 2。下载的 Setup SHA-256 为 `78da5f3e52ad50d0320061388c2e4c6a2304bb68dfc72315d9b6f250045f83ae`，与该 release 的 `SHA256SUMS.txt` 一致。

旧应用经过正常窗口关闭退出，随后运行正式 Setup 更新现有安装，安装器退出码为 0。安装目录可执行文件版本已确认为 0.2.149，并完成上述隔离回归。用户应用随后已重新打开。

## 范围与限制

所有测试只使用生成 PDF 和临时隔离数据目录；没有使用用户书库作为测试样本。没有自动清理用户数据，也未逐项核验用户原有书籍内容。未重跑完整 DPI／大型 PDF 压力矩阵、真实模型服务或安装卸载连续性矩阵；当前安装更新成功不等于这些矩阵已验收。新增 PR 检查尚未在远端运行。
