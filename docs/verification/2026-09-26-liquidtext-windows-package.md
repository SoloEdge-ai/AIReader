# LiquidText 对齐分支 Windows 打包验证（2026-09-26）

范围：`codex/liquidtext-alignment` 本地工作树。此次记录仅证明下列实际运行的检查；PR CI、正式发布和旧数据升级不由本记录推断。

## 环境与身份

- Windows 11 家庭版 x64，Build 26200，Lenovo 21LD。
- Node.js v24.19.0、pnpm 10.33.0、electron-builder 26.15.3。
- 本地开发版 `package.json` 版本 `0.1.0`；格式文件为数据库 v6、归档 v4、API v2。CI 会通过 `scripts/prepare-release.ts` 另设 `0.2.<run_number>`，因此本机产物不是正式版安装包。
- `1f172cfa8f8b0539802f39306d2452d0981889fb` 的干净提交已完成一次完整打包；`dist/build-info.json` 标记 `workingTreeDirty: false`。该轮产物用于验证打包链，最终提交须再次从干净工作树构建并以新元数据为准。

## 已运行

1. `node_modules/vitest/vitest.mjs run tests/release-build.test.ts`（使用 Node v24.19.0）：1 文件、1 测试通过。覆盖分支包元数据与稳定通道身份限制。
2. `./scripts/uninstall-file-check-smoke.ps1`：通过。隔离 NSIS 探针重现默认卸载在主程序被锁定时的错误成功，然后确认自定义保护在持久锁下返回 6 且保留其他文件，在临时锁释放后重试成功。该探针不安装 AIReader。
3. Node v24.19.0 运行 `scripts/build.mjs`、`scripts/bundled-core-smoke.mjs`：通过，确认打包 Core HTTP 可启动和关闭。
4. `electron-builder --win portable nsis --x64 --publish never`：通过，得到 Portable EXE 和 NSIS Setup EXE。
5. `desktop-smoke` 使用 Portable EXE、隔离数据目录和生成 PDF：导入、保存、关闭、重开通过。`close-save-smoke` 在打包版验证 SQLite 写锁、保存重试与重开通过；打包版选文、批注、跨页笔迹及对象验收也通过。

## 最终提交待执行

- 从最终干净提交重新构建 Web、Core、Desktop，运行 Core HTTP 冒烟。
- 重新生成 Portable 和 NSIS Setup，核对文件版本、格式信息与 SHA256；精确身份见 `release/build-info.json` 和 `release/SHA256SUMS.txt`。
- 再次使用隔离 `AIREADER_DATA` 启动最终 Portable EXE，导入生成 PDF、保存笔记、关闭重开。

## 环境边界

`scripts/installer-smoke.ps1` 明确要求全新 GitHub Actions Windows 工作区，且会安装、更新和卸载当前用户程序；本机可能有 AIReader 用户数据和安装记录，不能安全运行该脚本。真正的 Setup 安装连续性须由本分支 PR 的 Windows CI 产物验证。
