# AGENTS.md

Wails v3(beta)桌面托盘应用:Go 后端 + React 19 前端。本地优先的开发者工具启动器。UI 即产品;Go 层只是薄壳。

## 语言与国际化

- 本应用是中文项目:所有用户可见文案默认使用简体中文(zh-CN),包括前端 UI 与托盘菜单(`main.go`)。
- **始终使用简体中文与用户沟通**:所有输出、提问、回答(包括代码注释、commit 说明、报告、评审意见等)一律使用中文,除非用户明确要求使用其他语言。
- 国际化使用 **react-i18next**:在 `frontend/src/main.tsx` 初始化,语言资源统一放在 `frontend/src/locales/`(当前仅 `zh-CN.json`)。
- 组件内禁止硬编码用户可见字符串,一律通过 `useTranslation()` / `t()` 取值;文案修改只改 locale 文件。
- 当前只聚焦中文,但文案结构必须可扩展(默认回退 zh-CN,新增语种只需新增 locale 文件)。
- 现状:`App.tsx` 与 `main.go` 中英文文案尚未迁移,迁移完成后以 zh-CN 为准。

## 命令

- 所有任务通过 `wails3 task <name>` 执行 — 未单独安装 task/go-task,wails3 CLI 自带。以 `Taskfile.yml` 为唯一准绳(自带 README 中的 `wails3 dev` 已过时)。
- `wails3 task dev` — 开发循环:编译 DEV 二进制,在 9245 端口启动 Vite(可用 `WAILS_VITE_PORT` 覆盖),`*.go` 变更时热重载 Go(watcher 配置在 `build/config.yml`),前端由 Vite 处理。
- `wails3 task build` / `package` / `run` — 分发到 `build/{GOOS}/Taskfile.yml`。
- 前端依赖:只在 `frontend/` 内执行 `npm install`(仓库根目录无 package.json)。前端构建 = `tsc && vite build`;`main.go` 通过 `//go:embed all:frontend/dist` 嵌入 `frontend/dist`,因此任何 Go 构建前 dist 必须存在。
- 未配置 lint/format(无 eslint/prettier/golangci)。类型检查:在 `frontend/` 运行 `npx tsc --noEmit`。无测试。

## 架构

- `main.go` 是整个 Go 侧:一个窗口、系统托盘菜单、无服务。**未绑定任何 Go 服务** — `greetservice.go` 是未使用的模板残留;前端无法调用 Go 方法。Go→前端通信仅通过 `app.Event.Emit` / `Events.On`(托盘「设置」发出 `navigate`,由 `frontend/src/App.tsx` 处理)。
- 关闭窗口隐藏到托盘而非退出(`WindowClosing` 钩子调用 `Hide()` + `Cancel()`);退出只能走托盘菜单。应用为 Mac accessory(`ActivationPolicyAccessory`),无普通 Dock 窗口。
- `go.mod` 模块名仍是模板默认值 `changeme` — 不要惊讶;添加依赖时使用真实 import 路径。
- `build/config.yml` 保存构建资源元数据(info 字段仍是「My Company」占位符)。修改后需运行 `wails3 task common:update:build-assets`,它会重新生成/覆盖资源。
- `frontend/bindings/` 由 wails Vite 插件生成并已提交 — 永不手改。

## 前端约定

- UI 分层:根布局与状态(`App.tsx`:页面路由、侧栏、命令面板、持久化)与工具组件分离。**每个工具封装为独立组件文件** `frontend/src/components/`(如 `JsonTool.tsx`、`TimeTool.tsx`、`TextTool.tsx`),在 `App.tsx` 引入;共享 UI 原语与类型(`Reveal`/`ToolHeader`/`Editor`/`samples`/`ToolId`/`PendingAction`/`Icon`)集中在 `frontend/src/components/shared.tsx`。
- 代码刻意保持压缩单行风格(每个组件一行、最少空格)。不要重新格式化或美化;编辑时匹配这种紧凑风格。
- 所有样式在 `frontend/src/index.css`,使用 CSS 自定义属性(仅暗色主题:`--bg`、`--surface`、`--accent` …)。body 为 `user-select:none`。
- HeroUI(`@heroui/react`):用 HeroUI props 而非标准 DOM — `Button` 触发 `onPress`,`Switch` 用 `isSelected` + `onChange`。使用其他 HeroUI 组件前先查阅 `frontend/.agents/skills/heroui-react/SKILL.md`。
- 图标来自 `@phosphor-icons/react`(统一 `weight="bold"` 粗笔画)。字体用系统默认栈,`frontend/public/` 内的 Inter TTF 未引用,勿在 CSS 引入。
- 窗口拖拽区域由 `--wails-draggable: drag/no-drag` CSS 控制(titlebar 用 `data-wails-drag`),不用 JS。
- **工具页面扁平化,禁止圆角卡片**:不要用带边框/圆角/独立背景的卡片包裹工具内容;工具栏与状态栏用顶部/底部边框线分隔,内容直接落在页面背景上。
- 持久化状态用 localStorage key:`devutils.favorites`、`devutils.history`、`devutils.settings`。
- `frontend/.npmrc` 设置 `minimum-release-age=10080`(供应链策略;pnpm/bun 生效,npm 忽略)。

## HeroUI 设计原则

内化 HeroUI v3 设计原则(https://heroui.com/en/docs/react/getting-started/design-principles),所有 HeroUI 用法必须遵循:

- **语义意图优于视觉风格**:变体只用语义名(`primary`/`secondary`/`tertiary`/`danger`),禁止按视觉命名(`solid`/`flat`/`bordered`)。层级约定:每个上下文仅一个 `primary`,`secondary` 可多个,`tertiary` 仅用于 dismissive/取消,`danger` 用于破坏性操作。
- **无障碍为基础**:组件基于 React Aria(WCAG 2.1 AA),自带 ARIA 与键盘导航 — 不要破坏默认语义;交互一律 `onPress`,不写 `onClick`。
- **组合优于配置**:优先 compound components(如 `ComboBox.InputGroup`、`ComboBox.Popover`),按需组装/省略子部件,而非堆 props。
- **渐进披露**:从最小 props 起步,需求增长再扩展;不为一次性场景提前加复杂度。
- **可预测行为**:`size`/`variant`/`className`/data 属性在各组件间语义一致。
- **类型安全优先**:全量 TypeScript;自定义组件用 `extends Omit<ButtonProps,'variant'>` 等类型扩展,吃满 IntelliSense 与编译期校验。
- **样式与逻辑分离**:样式(`@heroui/styles`)与逻辑(`@heroui/react`)分离。本项目统一在 `index.css` 覆盖样式,不在组件里写内联主题逻辑。
- **完全可定制**:主题级用 CSS 变量(`--accent`、`--radius` 等),组件级用 BEM 类(`.button--primary`)。覆盖时选择器特异性要足够(如 `.app-shell .button--primary`),并显式声明关键色(`color`/`background`)而非依赖变量链。
- **动效走 CSS + GPU**:只用 `transform`/`opacity`,不用 framer-motion。
- **开放可扩展**:需要时写 wrapper 组件、直接用 BEM 类或 `tv({ extend: ... })` 扩展,不 fork 库。

## 工具约束

- **禁止使用 Playwright**(含 `playwright-cli` 及任何浏览器自动化)做测试或验证。全局配置中虽存在 playwright 相关技能,本项目一律不使用。
