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

开发默认数据位置与桌面相同；隔离时显式设置AIREADER_DATA为临时目录。测试不得使用用户数据库。工作前读索引/规范、检查分支/用户改动；按可观察流程实现、验证、同步文档，再提交。

## 扩展约束

新增工具：声明状态/快捷键/取消、UI设置、几何与命令；验证IME和临时平移。

新增对象：schema、Core事务校验、呈现/命中、材料投影、资源来源、归档及跨书/撤销验收。

新增AI材料：Core读取/版本校验、加入时冻结、实际发送预览、预算/图片上限、引用类别、删除后可用性。

新模块入口稳定后补完整例子；不把尚未存在的目标目录写成现状。
