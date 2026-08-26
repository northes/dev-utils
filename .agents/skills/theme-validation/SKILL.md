---
name: theme-validation
description: 验证本项目主题的注册、明暗过滤、配置规范化、CSS token 级联和构建质量。新增或修改主题后使用，禁止使用浏览器自动化。
user-invocable: false
---

# 主题验证

主题验证以静态检查、单元测试、类型检查和构建为主。本项目禁止使用 Playwright、Computer Use 或其他浏览器自动化做验证。

## 静态检查

1. 检查 `frontend/src/theme.ts`：
   - 亮色 ID 只出现在 `tone: 'light'` 选项。
   - 暗色 ID 只出现在 `tone: 'dark'` 选项。
   - `normalizeThemeId` 和 `resolveTheme` 的模式解析覆盖 `light`、`dark`、`system`。
2. 检查 `frontend/src/styles/globals.css`：
   - 每个主题亮暗选择器各出现一次。
   - 亮暗选择器都定义完整语义 token。
   - 用户提供的颜色、圆角和阴影值没有被改写。
   - 如果圆角或阴影要求随主题切换，相关变量不只存在于全局 `:root`。
3. 检查 `frontend/src/index.css`：
   - 颜色、radius scale 和 shadow token 都映射到 `@theme inline`。
4. 检查设置页和 locale：
   - 主题名称来自 locale。
   - 设置选择器只展示主题名称，不泄漏持久化 ID。
   - 亮暗选项由注册表的 `tone` 过滤，不手写 ID 列表。
5. 检查 Go：
   - 白名单、后缀校验、默认回退和旧配置迁移一致。
   - `configservice_test.go` 覆盖合法新主题和非法明暗主题回退。
6. 检查项目架构：
   - 设置页仍通过 `ConfigService` 持久化，未新增主题 localStorage。
   - Base UI Select 的选中值来自受控 ID，显示名称来自 locale，不泄漏内部主题 ID。

## 命令验证

在对应目录执行：

```sh
cd frontend
npx tsc --noEmit
npm run build
cd ..
go test ./...
git diff --check
```

不要用 `npx tsc --no-emit`，正确参数是 `--noEmit`。构建失败或测试失败时继续定位根因，不要用额外 CSS 覆盖或异常兜底掩盖问题。

这些命令是 `project-validation` 的主题验证子集；若本次修改还涉及 Go 服务、bindings 或构建资源，继续执行该 skill 的扩展矩阵。

## 回归范围

确认主题切换不会意外改变编辑器、Popover、Select、Dialog、Toast、滚动条及全局设计 token 的级联效果。若修改了 radius 或 shadow，还要确认 Tailwind 组件实际消费的是语义变量，而不是旧的全局值。
