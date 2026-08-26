---
name: tool-development
description: 指导本项目新增开发者工具的组件结构、App 路由、命令面板、历史记录、托盘识别、locale 和验证接线。新增 JSON、JWT、文本或其他工具时使用。
user-invocable: false
---

# 新增工具

新增工具必须完成完整接线，不能只新增一个组件并把导航或历史逻辑留在旧代码中。工具组件使用 `ToolLayout`、`ToolActionBar` 和共享类型，遵循现有工具的数据流。

## 必需接线

按以下顺序检查：

1. `frontend/src/components/shared.tsx`
   - 将新工具 ID 加入 `ToolId` 联合类型。
   - 复用 `ToolLayout`、`ToolActionBar`、`Reveal`、`PendingAction` 和共享 helper。
2. 新组件 `frontend/src/components/<Tool>Tool.tsx`
   - 每个工具独立文件。
   - 编辑器工具使用 `ToolLayout`；CodeMirror 工具通常使用 `contentMode="fixed"`。
   - pending effect 必须校验 `pending.tool === '<id>'`。
   - 工具动作使用 `ToolActionBar`，不要自行拼装 `.tool-actions` 或 footer。
   - 工具专属 CSS 放在组件旁并由组件引入；`.cm-*` 覆盖必须收敛在工具根类作用域下。
3. `frontend/src/App.tsx`
   - `tools` 数组加入侧栏和路由定义。
   - 加入常驻 `tool-slot` 渲染，切页只隐藏不卸载。
   - `paletteItems` 加入 `open:<id>` 导航命令和实际存在的工具动作命令。
   - 命令 `labelKey` 直接复用界面按钮文案；切换型命令才使用独立的 `commands.toggleXxx`。
4. `frontend/src/components/HistoryPage.tsx`
   - 同步更新 `toHistoryItem`、`HistoryIcon` 和 `historyTools`。
   - 否则工具记录会被过滤或显示缺少图标。
5. locale
   - `frontend/src/locales/zh-CN.json` 和 `frontend/src/locales/en-US.json` 同步增加 `tools.<id>`、导航命令和工具文案。
   - 不在组件、App 或 Go 托盘菜单中硬编码用户可见文案。
   - 具体 key 命名和语言资源规则遵循 `i18n-guidance` skill。
6. 页面恢复
   - 上次打开的工具或页面只使用 `localStorage` key `devutils.lastPage`。
   - 设置配置仍由 Go `ConfigService` 管理，不得写入 localStorage。

## 命令面板

- 命令必须与界面实际功能一一对应；自动实时行为没有按钮时不要添加命令。
- 使用 `context` 表达 Schema、编辑区、模式等上下文；统一由命令面板过滤，不为单个工具增加特殊字段。
- 命令索引同时包含 label、group、subgroup 和 keywords，并支持项目已有的拼音/首字母匹配。
- 右侧归属显示为两级“工具名 - 子分组”；无子分组时只显示工具名。
- 排序优先级为当前工具功能、导航命令、其他工具功能，组内再按匹配分数。
- 不消费输入的切换命令必须在 pending effect 中先处理并 `return`，不能先把空输入写回编辑器。

## 托盘和剪贴板匹配

若新工具支持托盘识别，必须同时更新：

- Go `configservice.go` 的 `defaultConfig`、`normalizeConfig` 和迁移逻辑。
- 前端 `App.tsx` 的默认 `trayMatchTools`、检测 helper 和 `analyzeClipboard` 检测顺序。
- `SettingsPage` 的 `trayTools` 和 `toggleTrayTool` 兜底集合。

三处工具 ID 必须一致。新支持的工具默认开启；已有用户配置通过一次性迁移加入，之后用户手动关闭必须持久化，不能每次启动重新开启。

## 以 JWT 为例

- 纯前端解码，不新增依赖；复用共享 `decodeBase64` 解 header/payload。
- 使用左侧可编辑 CodeMirror，右侧上下只读 header/payload；不展示 signature。
- 底部动作顺序为“清空 → 复制 Header → 复制 Payload”，对应 tertiary、secondary、primary。
- 托盘命中要求三段 base64url JWT，且 header、payload 都能解为非空 JSON 对象。
- JWT 检测顺序在 time 之后、base64/json/text 之前。

## 验证

- 检查工具 ID 在侧栏、路由、常驻挂载、命令面板、历史记录和 locale 中完整出现。
- 检查 pending action 不会被其他常驻工具消费，切换页后编辑器状态和撤销历史仍保留。
- 检查托盘识别开关、默认值、迁移和用户关闭状态一致。
- 在 `frontend/` 运行 `npx tsc --noEmit` 和 `npm run build`，项目根目录运行 `go test ./...` 和 `git diff --check`。
- 本项目禁止使用 Playwright、Computer Use 或其他浏览器自动化验证。
- 完整命令矩阵和 Go/Wails 变更验证遵循 `project-validation` skill。
