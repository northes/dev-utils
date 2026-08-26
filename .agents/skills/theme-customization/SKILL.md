---
name: theme-customization
description: 为本项目新增或修改主题。负责亮暗主题 ID、语义 token、Tailwind 映射、设置页、locale、Go 配置白名单与持久化接线。凡涉及主题 token 或主题选择器的开发任务都应使用此 skill。
user-invocable: false
---

# 主题定制

本项目主题是完整的数据流，不是只修改一段 CSS。主题必须同时覆盖前端显示、设置页选择、根节点切换和 Go 配置持久化。

`default-light` 和 `default-dark` 是已有用户配置中的持久化值，绝不重命名、复用或删除。主题 ID 是内部配置值，用户看到的名称必须来自 locale。

## 接线范围

新增主题时依次检查：

1. `frontend/src/theme.ts`
   - 主题族使用英文小写 kebab-case。
   - ID 固定为 `<theme>-light` 和 `<theme>-dark`。
   - 每个 ID 声明 `id`、`tone` 和 `labelKey`。
   - `normalizeThemeId` 必须按 tone 接受对应后缀，非法值回退到对应默认主题。
2. `frontend/src/styles/globals.css`
   - 使用唯一选择器 `:root[data-theme='<theme>-light']` 和 `:root[data-theme='<theme>-dark']`。
   - 亮色和暗色选择器分别定义完整 token，不依赖另一主题选择器的变量。
   - 用户提供的 OKLCH、HSL、圆角和阴影值必须原样接入，不自行调色或补色。
3. `frontend/src/index.css`
   - 将颜色、圆角和阴影 token 映射到 Tailwind `@theme inline`。
   - `--radius` 通过现有 radius scale 驱动 `rounded-*`。
   - `--shadow-*` 必须通过 Tailwind shadow token 驱动组件，不能只在 CSS 中声明而不映射。
4. `frontend/src/components/SettingsPage.tsx`
   - 主题选项必须由 `THEME_OPTIONS` 按 `tone` 过滤生成。
   - 主题名称只能来自 locale；选择器内只显示主题名，亮暗含义由外层字段标签表达。
   - Base UI Select 使用受控 `value`、`onValueChange` 和与 `SelectItem` 对应的 `items`。
5. `frontend/src/locales/zh-CN.json` 和 `frontend/src/locales/en-US.json`
   - 为每个主题增加 locale key。
   - 不在组件中硬编码用户可见主题名称。
6. `configservice.go` 和 `configservice_test.go`
   - Go 配置校验必须允许新的亮暗 ID，并按后缀验证 `LightTheme`/`DarkTheme`。
   - 非法主题回退到对应明暗侧默认主题。
   - 保留旧配置迁移；不要因新增主题使已有配置失效。

用户明确提供的颜色、OKLCH/HSL 数值、圆角或阴影值必须原样接入。除非用户明确要求，不覆盖既有 `--radius`、字段圆角、Popover/Select 圆角、滚动条或布局样式。

## Token 规则

每套主题至少覆盖项目使用的语义 token：

`--background`、`--foreground`、`--card`、`--card-foreground`、`--popover`、`--popover-foreground`、`--primary`、`--primary-foreground`、`--secondary`、`--secondary-foreground`、`--muted`、`--muted-foreground`、`--accent`、`--accent-foreground`、`--destructive`、`--destructive-foreground`、`--border`、`--input`、`--ring`、`--success`、`--warning`、图表 token 和使用到的 sidebar token。

用户明确要求圆角或阴影跟随主题切换时，亮暗选择器都必须包含：

- `--radius`
- `--shadow-x`、`--shadow-y`、`--shadow-blur`、`--shadow-spread`、`--shadow-opacity`、`--shadow-color`
- `--shadow-2xs`、`--shadow-xs`、`--shadow-sm`、`--shadow`、`--shadow-md`、`--shadow-lg`、`--shadow-xl`、`--shadow-2xl`

不得把这些变量只放在全局 `:root`，也不得通过主题外覆盖规则模拟主题差异。除非用户明确要求，不修改既有圆角、Popover/Select 圆角、滚动条或布局样式。

## 禁止事项

- 不重命名、复用或覆盖既有主题 ID、CSS 选择器、locale key 或设置项。
- 不在组件和 CodeMirror 中增加主题分支或直接写主题颜色。
- 不为少量重复创建平行的主题系统、localStorage 配置或第二套 token 名称。
- 不手改 `frontend/bindings/`。
- 如果修改了 Go `Config` 结构，按 `wails-integration` skill 重新生成 bindings。

## 完成标准

实现完成后使用 `theme-validation` skill 验证，不要只凭代码阅读判断主题已接通。
