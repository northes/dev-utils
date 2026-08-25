# AGENTS.md

## 主题定制约束

- 用户提供主题变量时，必须按原值接入，不得自行调色、改写 OKLCH 数值或凭印象补充颜色。
- 新主题必须分别提供亮色与暗色命名，并完整接通设置页、前端主题选择、根节点 `data-theme`/class 切换及 Go 配置校验与持久化。
- 主题颜色应映射到项目现有语义 token；除非用户明确要求，主题不得覆盖项目既有的 `--radius`、`--field-radius`、Popover/Select 圆角、滚动条或其他布局样式。
- 修改主题后必须检查主题选择器的实际级联效果，确认 Popover 圆角及现有全局设计 token 没有被意外改变。
- 多个自定义主题必须同时保留：新增主题时不得重命名、复用或覆盖既有主题的 id、CSS 选择器、颜色变量或设置项；每个主题使用独立的 `<theme>-light` / `<theme>-dark` id。
- 主题 CSS 出现同一选择器的多段定义时，后定义会覆盖前定义；新增前先检查重复选择器，并将每个主题的最终变量收敛为唯一一组，避免跨主题颜色串用。
- 设置页主题名称必须全部通过 i18n locale key 提供，禁止硬编码主题名。每个亮/暗选项的 `textValue` 与显示标签都应为“浅色 - 主题名”或“深色 - 主题名”，以保证选中态与搜索文本一致。
- 新增主题后，至少验证：设置列表中亮暗分组正确、每个主题名正确显示、选中态显示完整的亮暗前缀、前端类型检查和 `git diff --check` 通过。

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

- `main.go` 是整个 Go 侧:一个窗口、系统托盘菜单、已绑定的服务。**已绑定 `ConfigService`**(`configservice.go`):`Get()`/`Save()` 管理应用配置,持久化到 `~/Library/Application Support/DevUtils/config.json`,前端通过 `frontend/bindings/changeme/` 生成的绑定调用。`greetservice.go` 是未使用的模板残留。Go→前端通信通过 `app.Event.Emit` / `Events.On`(托盘「设置」发出 `navigate`,托盘点击发出 `tray:analyze`,由 `frontend/src/App.tsx` 处理)。
- 配置(设置页内容)由 Go 统一管理;**前端不把设置写入 localStorage**;`devutils.settings` 仅用于旧版迁移(已废弃)。
- 关闭窗口隐藏到托盘而非退出(`WindowClosing` 钩子调用 `Hide()` + `Cancel()`);退出只能走托盘菜单。应用为 Mac accessory(`ActivationPolicyAccessory`),无普通 Dock 窗口。
- `go.mod` 模块名仍是模板默认值 `changeme` — 不要惊讶;添加依赖时使用真实 import 路径。
- `build/config.yml` 保存构建资源元数据(info 字段仍是「My Company」占位符)。修改后需运行 `wails3 task common:update:build-assets`,它会重新生成/覆盖资源。
- `frontend/bindings/` 由 wails Vite 插件生成并已提交 — 永不手改。

## 前端约定

- UI 分层:根布局与状态(`App.tsx`:页面路由、侧栏、命令面板、持久化)与工具组件分离。**每个工具封装为独立组件文件** `frontend/src/components/`(如 `JsonTool.tsx`、`TimeTool.tsx`、`TextTool.tsx`),在 `App.tsx` 引入;共享 UI 原语与类型(`Reveal`/`ToolHeader`/`samples`/`ToolId`/`PendingAction`/`Icon`)集中在 `frontend/src/components/shared.tsx`。
- 前端代码使用 Prettier 格式化；编辑时保持现有格式，避免产生无关的格式化变更。
- 样式入口在 `frontend/src/index.css`(Tailwind v4 + shadcn/ui),主题变量定义在 `frontend/src/styles/globals.css`(shadcn `:root`/`.dark` oklch 变量 + 功能必需的 `--success`/`--warning` 语义色)。body 为 `user-select:none`。
- UI 组件统一用 shadcn/ui(`frontend/src/components/ui/`,复制进项目的源码,非黑盒 npm 包):安装、检索、查看文档和更新组件必须使用 shadcn skill 及 `npx shadcn@latest` CLI，禁止使用 Context7 查询，也不要手工从 GitHub/raw URL 抓取组件源码。新增前先检查已安装组件并使用 `npx shadcn@latest search`，安装使用 `npx shadcn@latest add`；更新已有组件先使用 `--dry-run` 和 `--diff`，未经用户明确同意不得使用 `--overwrite`。安装或更新后必须阅读涉及文件，检查依赖、导入路径、组件组合和项目约束。
- UI 组件使用约定:`Button` 用 `onClick`+`disabled`,`Switch` 用 `checked`+`onCheckedChange`,`Select` 用 `value`+`onValueChange`,`Toggle` 用 `pressed`+`onPressedChange`,`AlertDialog` 用 `open`+`onOpenChange`(在 Root 上)。variant 语义映射:项目内部 `primary`→`default`、`secondary`→`outline`、`tertiary`→`ghost`、`danger`→`destructive`。
- Base UI Select 使用受控 `value` + `SelectValue` 时，Select Root 必须传入与 `SelectItem` 对应的 `items`（`value`/`label`）；`options` 必须复用 i18n label，避免选中态显示内部 ID 而泄漏给用户。
- 图标来自 `@phosphor-icons/react`,统一 `weight="duotone"` 双色风格(状态区分除外,如选中态用 `fill`)。字体用系统默认栈,`frontend/public/` 内的 Inter TTF 未引用,勿在 CSS 引入。
- 图标按钮位于 flex 布局(尤其输入框右侧操作区)时,必须显式设置相等的 `width` 与 `min-width`、`flex:none`/`flex-shrink:0`，并按需要清除横向 padding；否则长输入或窄窗口会把按钮左右压扁。
- 窗口拖拽区域由 `--wails-draggable: drag/no-drag` CSS 控制(titlebar 用 `data-wails-drag`),不用 JS。
- **工具页面扁平化,禁止圆角卡片**:不要用带边框/圆角/独立背景的卡片包裹工具内容;内容直接落在页面背景上,层次用 1px 顶/底边框线表达,并按视觉密度取舍(标题-编辑区、编辑区-底部按钮栏之间若显紧贴就去掉边框)。
- 持久化状态用 localStorage key:`devutils.lastPage`(重启后恢复上次打开的工具/页面;设置页配置由 Go `ConfigService` 管理,不走 localStorage)。
- `frontend/.npmrc` 设置 `minimum-release-age=10080`(供应链策略;pnpm/bun 生效,npm 忽略)。

### 命令面板(`paletteItems` / `CommandPalette`)
- item 由 `id`/`labelKey`/`groupKey`/`subgroupKey?`/`icon`/`keywords`/`tool?`/`action?`/`mode?`/`target?`/`pane?`/`needsInput?`/`context?` 等字段构成,定义在 `App.tsx`;`context` 用于声明命令所属的可见上下文,由命令面板统一根据当前上下文状态过滤,上下文标识必须可扩展,不要为某个工具单独增加固定字段。索引 `buildIndex` 把 label + group + subgroup + keywords 一并纳入(含拼音/首字母),搜索「剪贴板」「大小写」等子分组词也要命中。
- **命令名必须与工具界面按钮文案完全一致**:`labelKey` 直接复用工具组件的 locale key(如 `jsonTool.copy`、`textTool.caseModes.upper`),禁止另造带工具名的文案(不要写成「复制 JSON」)。
- **切换/开关型命令例外**:面板/模式开关类命令(如 JSON 的 Schema、排序规则)在命令面板中命名为「切换 xxx」/「Toggle xxx」——`labelKey` 用独立的 `commands.toggleXxx` key(如 `commands.toggleSchema`、`commands.toggleSortRules`),不直接复用工具按钮文案;工具界面按钮文案保持「Schema」「排序规则」不变,中英文均按此规则。
- **上下文状态命令必须按状态可见**:属于某个可切换面板、模式、编辑区或其他上下文的操作命令，只能在对应上下文有效时加入命令索引；统一通过 `context` 和上下文状态表过滤，并随着新增功能扩展，不要为 Schema 或其他单个功能写特殊判断。例如 JSON Schema 右侧的「复制」「清空」「压缩」「格式化」使用 `context:'json.schema'`，仅在 Schema 打开时可见；切换面板本身的命令(如「切换 Schema」)不绑定该上下文,始终保留。
- 右侧归属为两级:**`工具名 - 子分组`**(如「差异对比 - 剪贴板填入」);子分组通过 `subgroupKey` 表达(如 `diffTool.clipboardTarget`、`textTool.case`),无子分组的命令只显示工具名。
- **命令必须与界面功能一一对应**:界面不存在对应按钮/功能(如 Base64 编码/解码、JSON 校验、时间转换——这些是自动/实时行为,无按钮)的命令不要保留在 `paletteItems`。
- 列表排序组优先于匹配分数:当前工具的功能(`tool===当前页`) → 打开其他工具/导航(`page` 存在) → 其他工具的功能;组内再按分数。`CommandPalette` 接收 `page` prop 判定。
- 命令通过 `PendingAction` 派发给工具组件 pending effect 执行;带 `mode`/`target` 的命令由 `run()` 透传。diff「剪贴板填入-交替」在 App 层用 `nextDiffTarget` 解析成具体 before/after 后再派发。
- **不消费输入的切换型命令**(schema 开关、sortDefault 恢复、插入时间戳、使用本机时区、diff 高亮模式)必须在 pending effect 中**先于 `setInput/changeInput(pending.input)` 分支处理并 `return`**,否则会拿空/剪贴板内容清空编辑器。
- 新增命令若复用已有按钮文案,则 locale 零新增;删除命令时同步清理不再引用的 locale 键。

### Popover 与命令面板滚动条/圆角
- 浮层滚动必须分层:外层 Popover/命令列表负责背景、边框、`border-radius` 与 `overflow:hidden` 裁切;内部真实滚动层负责尺寸收缩、`overflow:auto`、滚动条和滚动内容。不要让外层和内层同时承担滚动。
- `scrollbar-gutter` 只应作用于真实滚动层。外层即使 `overflow:hidden`,被通用规则设为 `scrollbar-gutter:stable` 仍可能预留 gutter,造成内层滚动条向左缩、未贴住浮层右边界;需要在外层和真实滚动层明确使用 `scrollbar-gutter:auto!important`。
- 命令面板当前由 `.palette-list` 外壳和 `.palette-list-scroll` 滚动层组成。外壳保留 `padding:5px` 时,滚动层用等量负右边距延伸到外壳内容边界,再用等量 `padding-right` 保持列表项留白;负边距必须与外壳 padding 成对维护,不能孤立调整。
- shadcn Popover/Select(基于 Radix)会 Portal 到 `body`,局部父级选择器失效;需要时用组件 `className` 传入覆盖类,或检查 Radix 实际渲染的 `data-state`/`data-side` 属性定位。
- 圆角统一用 shadcn 的单一 `--radius`(Tailwind `rounded-*` 已按 `@theme inline` 缩放);浮层四角由组件 `rounded-md`/`rounded-lg` 承担,不要另建全局圆角覆盖层。
- 排查顺序固定为:确认真实滚动 DOM → 检查外/内层 `overflow`、`scrollbar-gutter`、padding、负 margin、尺寸和圆角 → 检查 Portal 后类名/`data-state` → 检查 import 顺序和特异性。修改后运行 `npm run build`、Impeccable layout detector 与 `git diff --check`;本项目禁止用 Playwright 或 Computer Use 做验证。
- 命令面板的搜索区、命令列表和空状态属于同一浮层表面，背景统一使用 `bg-popover`，不要使用 `bg-muted` 造成与浮层外壳或其他 Portal 浮层的明度层级不一致；搜索框使用 `Input` 时必须显式加 `dark:bg-transparent`，覆盖组件默认的 `dark:bg-input/30`，避免输入区域出现额外的暗色胶囊背景。外部遮罩仍使用 `--backdrop`，选中命令才使用 `bg-primary` 表示交互状态。

### 自定义悬浮滚动条
- WKWebView/macOS 的系统滚动条是否采用 Overlay 受系统偏好与 WebView 行为影响;一旦用 `scrollbar-width`、`scrollbar-color` 或 `::-webkit-scrollbar` 强制定制,可能退化为占位滚动条并产生底部/侧边槽。需要“细滑块 + 不占布局”时,应明确选择系统原生 Overlay 或隐藏原生滚动条后完整自绘,不要混用两套机制。
- 自绘滚动条必须以真实滚动容器为责任边界:初始化时发现已有容器,DOM 新增/移除时增量注册/注销,用 `ResizeObserver` 跟踪尺寸;滚动帧只测量已注册容器,禁止每次滚动 `querySelectorAll('*')`、逐节点 `getComputedStyle()` 或全 DOM 扫描。
- 横纵轴资格必须由同一个函数统一判定并贯穿发现、布局和拖动计算:`overflow-x:hidden` 绝不能因为 `scrollWidth>clientWidth` 生成横向滑块,反之亦然。滑块长度、位置与拖动映射均使用“可滚范围”和“扣除最小滑块后的可用轨道”,并钳制在容器边界内。
- 可视滑块和命中区域分离:视觉可保持 6px,命中区可放宽到约 12px;Overlay 外壳 `pointer-events:none`,仅滑块接收事件。hover 只改变视觉反馈,位移只能在主指针按下并进入明确 drag 状态后发生。
- 拖动状态必须绑定发起手势的 `pointerId`,使用 pointer capture,并在 `pointerup`、`pointercancel`、`window.blur`、页面隐藏、源节点移除和组件卸载时走同一清理函数;动态注册的 document/window 监听器也必须由该生命周期统一移除,禁止遗留旧拖动状态。
- fixed Overlay 脱离源元素的 stacking context 与裁切链,不能使用一个全局固定高 `z-index`。应根据源容器所在层级定位,并理解 Portal 的 DOM 顺序:Dialog/命令面板打开时隐藏背景滚动条,Popover/Select 只显示当前顶层浮层的滚动条,后打开的模态层不得被旧浮层滚动条穿透。
- 全局隐藏原生滚动条后,自绘滑块必须补齐原生交互契约:`role="scrollbar"`、可聚焦、可访问名称、`aria-controls`、`aria-valuemin/max/now`、方向信息,并支持方向键、PageUp/PageDown、Home/End;焦点态必须可见。只做视觉滑块而丢失键盘和辅助技术能力不可接受。
- 自绘滚动条至少回归这些边界:单轴/双轴、`overflow:hidden` 的另一轴、滚到起点/终点、最小滑块、嵌套滚动区、CodeMirror、常驻但隐藏的页面、Popover/Select Portal、先开浮层再开 Dialog、Dialog 内再开浮层、窗口外释放拖动、窗口失焦、动态内容增删和窗口缩放。

## UI 与布局经验(通用原则,自本项目实践沉淀)

### 页面切换与状态保留
- 工具页**常驻挂载**,隐藏用 `position:absolute;inset:0;visibility:hidden;pointer-events:none`(不要 `display:none`)——保留布局与尺寸,避免 CodeMirror 塌陷/重测量,也保住撤销历史与滚动状态。
- CodeMirror 的原生撤销/重做历史绑定在编辑器实例上:实例不卸载则历史天然保留。JSON 左区/路径/右区各是独立实例 → 各自独立撤销重做,聚焦哪个区就撤销哪个。**不要在切页或 schema 开关时重建编辑器。**
- 文本工具的主输入也使用 CodeMirror,沿用其实例级原生撤销/重做;不要再为该输入接入 `Editor` textarea、`useHistory` 或手写 `onKeyDown` 撤销拦截。文本变换和外部恢复通过受控 `value` 更新,编辑器保持常驻挂载。
- 纯 textarea/input 的浏览器原生撤销不可靠(程序化 `setValue` 后失效):用 `useHistory`(shared.tsx)自研撤销栈——600ms 窗口内键入合并成一步,工具栏/粘贴等程序化变更用 `{isolate:true}` 独立入栈;快捷键在元素 `onKeyDown` 拦截(`Mod/Ctrl+Z`、`Shift+Mod/Ctrl+Z` / `Ctrl+Y`),`event.nativeEvent.isComposing` 时放行 IME。
- 常驻后所有工具页都会收到同一个 `pending` action,**effect 必须校验 `pending.tool === 自身 id`**,否则多个工具会互相抢走剪贴板命令。

### 入场动画与滚动条闪烁(共因)
- 自下而上入场动画用 `translateY(+12px)` 时,元素底部会瞬时超出滚动容器视口 → 产生可滚动溢出 → 滚动条「短暂出现又消失」(所有页面复现)。
- 解决(二选一):保留上移动画时,用包裹容器 `overflow:hidden` 裁剪该溢出(本项目 `.tool-slot` 承担此职);或改用 `translateY(-12px)`(顶部溢出不可滚动,不出滚动条)。
- 切页滚动复位用 `useLayoutEffect`(绘制前),别用 `useEffect`(会先按旧滚动位置绘制一帧)。滚动容器加 `overflow-x:hidden` 防横向瞬时滚动条。

### 扁平化与分隔线
- 工具页内容直接落在页面背景,不用带边框/圆角/独立背景的卡片包裹;层次用 1px 顶/底边框线表达。
- 成组展示的统计项使用一个整体卡片:容器保留一圈细边框和小圆角,内部用 grid gap:1px 加边框色背景绘制分隔线;统计项本身不再带独立外框。避免用 :nth-child() 修补特定位置的边线。
- 分隔线按视觉密度取舍:标题-编辑区、编辑区-底部按钮栏之间若显紧贴,直接去掉边框,不要保留多余线条。
- 工具页标题:19px/600、贴近左上角、与左侧 sidebar 顶沿对齐;可带 10px 副标题说明(与 DESIGN.md Title 层级一致)。开关式布局(如 JSON schema)开/关状态下边距必须一致。
- 组件样式必须以组件根类和明确的元素类收敛(如 `.text-stat-grid`/`.text-stat-item`),不要用通用容器选择器、裸子元素选择器或 `:nth-child()` 表达组件结构。重复分隔线优先用 grid `gap:1px` + 容器背景实现,避免项目新增元素后意外改变边框。
- 布局和组件样式必须直接写在对应组件节点上；能直接添加 Tailwind class 时，禁止使用 `[&_*]` 等任意后代匹配器或父级选择器间接修改子组件样式。只有第三方运行时生成、无法在组件节点上设置 class 的 DOM(如 CodeMirror 内部节点)才允许使用作用域明确的选择器。

### 工具页公共布局
- 所有工具页(JSON、时间、文本、Base64 及后续新增工具)必须使用 `shared.tsx` 的 `ToolLayout`,禁止在工具组件里自行创建 `.tool-page` 外壳或重复实现 header/content/footer 布局。
- `ToolLayout` 固定为三行网格:`header auto / content minmax(0,1fr) / footer auto`;header 始终在顶部,content 必须占满所有剩余空间,footer 始终在底部。这里的“固定”是网格布局位置固定,禁止用 `position:fixed/sticky/absolute` 叠加页面内容。
- 工具对应的 `Reveal` 必须启用 `fill`,`.tool-slot` 必须占满 workspace 高度;高度链上的每一层都要有 `height:100%`/`min-height:0`,否则 `1fr` 无法正确收缩,CodeMirror 也会测量错误。
- content 默认使用自身滚动(`contentMode="scroll"`),页面 footer 不随内容滚动;CodeMirror 等必须吃满可用高度且自行管理内部滚动的工具使用 `contentMode="fixed"`。不要恢复 workspace 级工具页滚动。
- content 内需要铺满剩余高度的主编辑区继续使用 `height:100%`、`min-height:0` 与 `minmax(0,1fr)`,禁止写死编辑区像素高度。响应式切换分栏方向时同时切换 grid rows:宽屏左右分栏共用一行,窄屏上下分栏平分可用高度。
- `ToolLayout` 负责渲染唯一的语义化 footer;`ToolActionBar` 只是 footer 内的 `role="toolbar"` 操作组,禁止嵌套 `<footer>`。没有底部动作的工具也使用同一布局并保留空 footer 行。
- JSON Schema 等存在多个动作作用域时,content 仍只放编辑内容,各作用域的 `ToolActionBar` 在 `ToolLayout.footer` 中用与 content 一致的网格对齐;不要把按钮重新塞回 content。

### 工具底部操作栏
- JSON、文本、Base64 等工具的底部操作统一使用 `shared.tsx` 的 `ToolActionBar`,禁止各工具自行拼装 `.tool-actions` 或重复定义按钮尺寸、间距和对齐方式。
- 操作栏在 `ToolLayout.footer` 内整体右对齐:仅作用于单个编辑器的动作在 footer 中按对应 content 列对齐(JSON Schema 左右编辑器各自一组),页面级动作使用单组操作栏。不要为了视觉统一混淆动作作用域。
- 操作顺序固定为「dismissive/清空 → secondary → primary」,主操作位于最右侧;每个作用域最多一个 `primary`,可以没有 `primary`。窄窗口允许从右侧自然换行,不能压扁按钮。
- 语义层级统一:推进核心结果的动作使用 `primary`(如 JSON 格式化、Base64 复制结果),替代变换与普通工具动作使用 `secondary`,清空编辑内容使用 `tertiary`;只有不可恢复的破坏性操作才使用 `danger` 并二次确认。
- 操作栏保持扁平,不加卡片、独立背景或阴影;标准为按钮高 30px、间距 6px、上边距 12px、字号 11px、图标 14px,具体样式只在 `index.css` 的 `.tool-action-bar` 中维护。
- 变换类动作默认只显示文字;复制、保存、清空等通用动作使用 Phosphor duotone 图标。复制成功统一短暂切换为 `Check` +「已复制」,空内容对应动作使用 `isDisabled`,不要通过隐藏按钮造成布局跳动。

### CodeMirror 与 JSON
- CodeMirror 基础主题给聚焦编辑器 `outline:1px dotted`(虚线);统一加 `.cm-editor.cm-focused{outline:none}`,用容器 `:focus-within` 实线边框表示聚焦,否则 `overflow:visible` 的编辑器会露出虚线。
- 支持注释的 JSON:语法高亮用 `codemirror-json5`(节点名与 lezer-json 一致,折叠可用);解析前用 shared.tsx 的 `stripJsonComments`/`stripTrailingCommas`/`parseJsonLoose`(字符串感知)剥离注释与尾逗号。
- 所有展示 JSON/JSON5 结构的 CodeMirror 都必须接入统一的 `codeFolding` 扩展;对象和数组折叠占位符分别显示 key 与 items 数量,工作流输出也必须遵守,不得只接入 `json5()`。
- 带注释内容执行格式化/压缩:先弹 AlertDialog 询问(格式化:尝试保留/清除注释/取消;压缩:清除/取消);失败用 toast 提示,不静默忽略。

### 新增工具接线清单(JWT 等)

新增工具(以 JWT 为例)必须在以下位置同步接线,缺一会导致类型报错、历史记录被过滤或托盘匹配丢失:

1. `shared.tsx`:`ToolId` 联合类型加新 id。
2. 新组件 `frontend/src/components/JwtTool.tsx`:用 `ToolLayout`(contentMode="fixed")+ `ToolActionBar`;pending effect 必须校验 `pending.tool === 'jwt'`。
3. `App.tsx`:`tools` 数组(侧栏/路由)+ `tool-slot` 常驻渲染 + `paletteItems`(`open:<id>` 导航命令 + 工具动作命令,labelKey 复用界面按钮文案)。
4. `HistoryPage.tsx`:`toHistoryItem`、`HistoryIcon`、`historyTools` 三处加新 id(否则 `record('<id>')` 的历史被过滤/无图标)。
5. locale 两文件(`zh-CN.json`/`en-US.json`):`tools.<id>`、`commands.open<X>`、`<tool>Tool.*`。
6. 托盘/剪贴板自动匹配(若接入):Go `configservice.go` 的 `defaultConfig` 与 `normalizeConfig` 的 `trayTools` 列表、前端 `App.tsx` 的 `defaultSettings.trayMatchTools` 与 `analyzeClipboard` 检测链 + 检测 helper、`SettingsPage` 的 `trayTools`/`toggleTrayTool` 兜底集合,三处 id 列表保持一致。**凡是支持托盘识别的新工具默认开启**:必须同步加入 Go 默认配置、前端默认配置和设置页兜底集合;已有用户配置需通过一次性迁移加入新工具,迁移完成后用户手动关闭必须持久化且不得在下次启动被重新开启。
7. 工具专属样式内聚在组件旁(如 `JwtTool.css`,组件顶部 `import`),不写 `index.css`;`.cm-*` 覆盖必须收敛在工具根类作用域下。

### JWT 工具

- 纯前端解码,无新依赖:复用 `shared.tsx` 的 `decodeBase64`(已兼容 base64url)解 header/payload,`JSON.stringify(v,null,2)` 格式化。
- 布局:左侧可编辑输入(CodeMirror),右侧上下两栏只读 header / payload;**不展示 signature**;底部单组 `ToolActionBar`:`清空`(tertiary)→`复制 Header`(secondary)→`复制 Payload`(primary)。
- 托盘匹配判定:三段 `a.b.c`(base64url)且 header、payload 均可解为非空 JSON 对象才命中 `jwt`;检测优先级在 time 之后、base64/json/text 之前。
- 样式在 `frontend/src/components/JwtTool.css`,与组件同目录。

### 弹层(AlertDialog)
- 使用 shadcn `AlertDialog`(Radix):`<AlertDialog open onOpenChange>` + `AlertDialogContent/Header/Title/Description/Footer/Cancel/Action`;取消用 `AlertDialogCancel`,确认用 `AlertDialogAction`。
- 破坏性操作(清空历史、注释压缩等)执行前必须 AlertDialog 二次确认,确认按钮额外加 `className="bg-destructive text-destructive-foreground hover:bg-destructive/90"`。

### shadcn/ui 易踩坑
- shadcn 组件是复制进 `frontend/src/components/ui/` 的源码,通过 shadcn skill 和 CLI 安装后可直接改源码(图标已统一换成 `@phosphor-icons/react`),不要当黑盒 npm 包用；组件不存在时先用 shadcn CLI 搜索，不要直接编写重复的自定义组件。
- 遵循 shadcn skill 的组合规则：优先使用已有组件和内置 variant；表单使用 `FieldGroup`/`Field`，选项组使用 `ToggleGroup`，提示使用 `Alert`，空状态使用 `Empty`，分隔线使用 `Separator`，加载占位使用 `Skeleton`，不要用等价的手写 markup 替代。
- 使用组件前按 shadcn skill 流程运行 `npx shadcn@latest docs <component>` 获取文档和示例；不得通过 Context7 查询组件 API 或文档。
- 项目内部的语义 variant(`primary/secondary/tertiary/danger`)只在 `ToolActionBar` 等自有类型里使用,落到 shadcn `Button` 时按 `default/outline/ghost/destructive` 映射,不要直接给 shadcn 组件传 `variant="primary"`。

### 托盘与窗口、配置持久化
- 托盘附件窗口:显示时**不要**用 `tray.ShowWindow()`(会强制定位到托盘图标下并置顶),直接 `window.Show().Focus()` + `SetAlwaysOnTop(false)`,窗口才回到上次位置。
- 窗口位置/大小(`window-state.json`)与用户配置(`config.json`)都由 Go 持久化,前端不写 localStorage(上次打开页面 `devutils.lastPage` 除外);Go 退出前用 `app.OnShutdown` flush 防抖中的保存。
- Go 结构体经 `wails3 generate bindings -clean=true -ts -i` 直接生成 TS 模型与方法绑定,前端 `type Settings = Config` 直接复用;**改动 Go 结构体后必须重新生成 bindings**。

## shadcn/ui 设计原则

- **组件即源码**:shadcn 组件复制进 `frontend/src/components/ui/`,样式用 Tailwind 类 + `cn()`(cva) 组合,直接在源码里按需调整,不 fork 黑盒库。
- **变量即主题**:颜色语义只用 shadcn 变量(`--background/--foreground/--primary/--secondary/--muted/--accent/--destructive/--border/--input/--ring`),亮暗切换靠根节点 `.dark` class;shadcn 未提供的 `--success/--warning` 作为项目扩展语义色保留。
- **语义意图优于视觉风格**:项目内部仍用 `primary/secondary/tertiary/danger` 语义名(见 `ToolActionBar`),每个上下文仅一个 `primary`,`danger` 仅用于破坏性操作。
- **无障碍为基础**:组件基于 Radix(WCAG 2.1 AA),不要破坏默认 ARIA 与键盘导航;交互用 `onClick`/`onValueChange`/`onCheckedChange` 等标准 props。
- **动效走 shadcn 动画**:保留 `tw-animate-css` 提供的 `animate-in/out`、`fade-*`、`zoom-*`、`slide-*` 类;不用 framer-motion。
- **图标用 Phosphor**:shadcn 组件源码里的 lucide 图标一律替换为 `@phosphor-icons/react`,统一 `weight` 风格。

## 工具约束

- **禁止使用 Playwright**(含 `playwright-cli` 及任何浏览器自动化) 和 **Computer Use** 做测试或验证。全局配置中虽存在 **playwright** 和 **Computer Use** 相关技能,本项目一律不使用。

## 问题修复原则

- 任何问题都必须定位并修复根因:从数据流、状态边界、生命周期、架构约束或错误的业务逻辑入手,直接用正确逻辑覆盖错误实现。
- 禁止通过临时补丁、特殊分支、重复兜底、延迟执行、魔法值、选择器覆盖、异常吞掉或仅针对当前复现路径的判断来掩盖问题。
- 修复前必须确认问题的触发条件、影响范围和真实责任边界;修复后应删除不再需要的绕行逻辑,避免新旧逻辑并存或形成隐性优先级。
- 若现有设计与正确行为冲突,优先调整设计和调用链,不要在错误抽象之上叠加兼容层;只有存在明确的持久化数据、已发布行为或外部消费者时才保留必要兼容逻辑。
- 验证应覆盖根因对应的行为和相关边界,不能只验证原始复现案例;发现验证失败时继续追溯根因,不要追加补丁。
