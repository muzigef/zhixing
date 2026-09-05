<!-- generated-by: gsd-doc-writer -->
# 贡献指南

本项目使用 `UNLICENSED`，根目录 [LICENSE](LICENSE) 声明 All rights reserved；代码可见不代表获得开源使用、修改或分发许可。以下流程适用于已经获得权利人授权的协作者。

## 开发准备

前置条件与首次运行见[快速开始](docs/GETTING-STARTED.md)，本地循环与完整脚本见[开发指南](docs/DEVELOPMENT.md)，验证范围见[测试指南](docs/TESTING.md)。使用 Node.js `24.8.x`，建议 npm `10.9.2` 与 CI 一致。在仓库根目录安装两套依赖：

```bash
npm ci
npm ci --prefix desktop
```

## 编码规范

- TypeScript ESM，遵循现有严格类型与文件格式；使用根目录 `npm run lint` 检查 ESLint。
- 运行根目录和桌面的类型检查，或统一执行 `npm run verify`。Prettier 仅为桌面开发依赖，目前没有强制格式脚本或 CI 格式门。
- CLI 保持主题隔离、用户原文证据与受控工具边界；桌面原生能力集中在主进程，renderer 不直接读取文件、密钥或联网。
- 测试使用临时数据和假 Provider，不使用 focused/skipped 测试，不忽略失败退出码。

## PR 指南

围绕稳定性、安全、文档和学习体验提交小而完整的改动。当前主分支是 `main`，没有强制分支名、提交消息格式或 PR 模板；标题和提交消息应说明具体问题及结果。提交前请：

1. 先说明目标、隐私边界与验收标准。
2. 新增失败/边界测试，再实现最小改动。
3. 安装根目录与桌面依赖后运行 `npm run verify`；桌面交互改动另外构建并运行 `test:ui`，交付安装包还要验证实际打包应用。
4. 更新受影响的 README、配置、测试及 `docs/evidence/` 记录；写明本次真实执行的命令、结果和未验证范围。
5. 不提交用户资料、数据库、审计、API Key、token 或外部 Provider 输出。

PR 描述以最终代码行为为准，附上复现方式与验证结果；按审查意见补齐测试和文档。当前没有仓库内定义的强制审查人数或自动合并规则。

CI 配置会在 push/PR 运行根目录 `verify` 与生产依赖审计，但目前遗漏桌面依赖安装，也没有 UI/打包验证；请按[测试指南](docs/TESTING.md)完成本地验证并如实说明结果，不能以工作流存在代替验证通过。

## 报告问题

仓库没有专用 Issue 模板。经授权可在[项目 Issues](https://github.com/muzigef/zhixing/issues)记录复现步骤、预期与实际行为、系统/架构、Node 版本、CLI 或桌面入口，以及不含个人数据的错误摘要；功能建议说明具体使用场景和完成标准。

安全问题请遵循 [SECURITY.md](SECURITY.md)，不要在公开渠道披露可利用细节。
