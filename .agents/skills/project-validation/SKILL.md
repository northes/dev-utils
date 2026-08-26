---
name: project-validation
description: 指导本项目 Wails、Go 和 React 修改的静态检查、类型检查、构建、测试和差异验证。完成实现或回归验证时使用。
user-invocable: false
---

# 项目验证

验证以可重复的命令和根因对应的边界检查为主。本项目禁止使用 Playwright、Computer Use、playwright-cli 或其他浏览器自动化做测试和验证。

## 命令准则

- 项目开发、构建、打包和运行命令以根目录 `Taskfile.yml` 为唯一准绳，使用 `wails3 task <name>`；不要根据旧 README 使用 `wails3 dev`。
- 前端依赖只在 `frontend/` 内安装。npm 项目使用 `npm install`，不要在仓库根目录寻找或创建 `package.json`。
- `frontend/.npmrc` 的 `minimum-release-age=10080` 是供应链策略；安装依赖时不要删除或绕过它。
- 前端脚本在 `frontend/` 执行：

  ```sh
  npx tsc --noEmit
  npm run build
  npm run format:check
  ```

- Go 验证在仓库根目录执行：

  ```sh
  go test ./...
  git diff --check
  ```

- 当前没有独立的前端测试套件；Go 至少有 `configservice_test.go` 和 `updateservice_test.go`。不要把“没有前端测试”写成“项目没有测试”。

## 验证矩阵

- 只改 Markdown 或 skill：运行 `git diff --check`，并检查路径、命令、文件名和现有架构描述一致。
- 改 React 组件、locale、样式或工具：运行前端类型检查、生产构建、必要时格式检查；工具任务同时按 `tool-development` 和 `layout-guidance` 的清单静态检查。
- 改主题：使用 `theme-validation`，覆盖主题注册、明暗过滤、CSS token 级联、Go 配置规范化、类型检查、构建和 Go 测试。
- 改 Go 服务、配置、窗口、托盘或事件：运行 Go 测试和前端类型检查/构建；若导出类型改变，先重新生成 bindings，再检查生成文件和调用方。
- 改 `build/config.yml` 的资源元数据：先运行 `wails3 task common:update:build-assets`，检查生成资源，再执行对应的构建验证。
- 改 `main.go` 的嵌入资源、构建流程或分发配置：确认 `frontend/dist` 已生成，再运行 `wails3 task build` 或用户要求的目标任务。

## 失败处理

- 验证失败时先确认失败属于本次修改还是基线问题，继续追到数据流、生命周期、类型或构建配置的根因。
- 不通过额外 CSS 覆盖、特殊判断、异常吞掉、隐式重试或延迟执行来让命令表面通过。
- 代码改动完成后，验证应覆盖原始复现和相关边界；文档改动则检查是否留下过时的文件路径、API 名称、底层 primitive 或命令。
