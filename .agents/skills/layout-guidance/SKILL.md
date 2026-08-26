---
name: layout-guidance
description: 指导本项目工具页、编辑器、浮层和滚动条的布局实现与回归。涉及布局重构、响应式调整、工具页高度链、CodeMirror 尺寸或浮层滚动时使用。
user-invocable: false
---

# 布局指导

本项目的布局优先保证数据流、尺寸链、滚动责任和状态保留，再处理视觉细节。工具页面必须遵循现有 `ToolLayout` 与 `Reveal` 结构，不创建平行布局系统。

## 工具页布局

- 所有工具页使用 `shared.tsx` 的 `ToolLayout`，不要在工具组件中自行创建 `.tool-page` 外壳。
- `ToolLayout` 固定为三行网格：`header auto / content minmax(0,1fr) / footer auto`。
- 工具对应的 `Reveal` 使用 `fill`，`.tool-slot` 占满 workspace 高度；高度链上的每层都设置 `height: 100%` 或 `min-height: 0`。
- content 默认使用自身滚动；CodeMirror 等内部管理滚动的工具使用 `contentMode="fixed"`。
- footer 只由 `ToolLayout` 渲染，`ToolActionBar` 是 footer 内的 `role="toolbar"`，禁止嵌套 `<footer>`。
- 主编辑区使用 `height: 100%`、`min-height: 0` 和 `minmax(0,1fr)`，禁止写死编辑区高度。
- 响应式切换分栏方向时同步调整 grid rows；宽屏左右分栏共用一行，窄屏上下分栏平分可用高度。
- 工具内容直接落在页面背景上，用 1px 分隔线表达层次，不使用带边框、圆角和独立背景的工具卡片。
- 页面切换使用常驻挂载：隐藏工具使用 `position:absolute; inset:0; visibility:hidden; pointer-events:none`，不要用 `display:none` 卸载编辑器。
- 工具页不要为了分组套用圆角卡片；需要表达层级时使用现有语义 token 和 1px 分隔线，按视觉密度删除多余的标题、编辑区和 footer 边线。

## 编辑器与状态

- CodeMirror 实例不因切页、Schema 开关或工具状态切换而重建；实例保留撤销历史、滚动位置和尺寸状态。
- 文本工具主输入使用 CodeMirror，不额外实现 textarea 历史或撤销拦截。
- 纯 input/textarea 的程序化变更使用共享 `useHistory`；键盘撤销需要处理 `Mod/Ctrl+Z`、重做快捷键和 IME composing 状态。
- pending action 必须先校验所属 `tool`，避免常驻挂载后多个工具抢消费同一操作。
- 切页滚动复位使用 `useLayoutEffect`；workspace 滚动容器增加 `overflow-x: hidden`。
- flex 中的图标按钮必须显式设置相等的 `width`/`min-width` 和 `flex: none`（或 `flex-shrink: 0`），必要时清除横向 padding，避免窄窗口或长输入压扁按钮。
- Wails 标题栏拖拽使用 CSS 的 `--wails-draggable: drag/no-drag` 和 `data-wails-drag`，不要用 JavaScript 监听鼠标模拟拖拽。

## 动画与浮层

- `translateY(+12px)` 的入场动画会造成底部瞬时溢出和滚动条闪烁；使用 `.tool-slot` 的 `overflow: hidden` 裁切，或改为向上移动。
- 浮层滚动分为外壳和真实滚动层：外壳负责背景、边框、圆角和 `overflow: hidden`，内部负责尺寸收缩、`overflow: auto`、滚动条和内容。
- `scrollbar-gutter` 只作用于真实滚动层；外壳和内部滚动层需要时都显式使用 `scrollbar-gutter: auto !important`。
- Popover/Select 会 Portal 到 `body`，局部父级选择器不能可靠定位；通过组件 `className` 或实际 `data-state`/`data-side` 定位。
- 浮层背景统一使用 `bg-popover`；搜索框需要覆盖组件默认暗色输入背景时显式使用 `dark:bg-transparent`。
- 圆角统一使用 shadcn 的 `--radius` 和既有组件圆角，不新增全局圆角覆盖层。

## 自绘滚动条

- 自绘滚动条以真实滚动容器为责任边界，初始化发现已有容器，DOM 增删增量注册，使用 `ResizeObserver` 跟踪尺寸。
- 横纵轴资格、布局和拖动计算必须复用同一个判定函数；`overflow-x: hidden` 不得生成横向滑块。
- 滑块长度、位置和拖动映射使用可滚范围及扣除最小滑块后的有效轨道，并钳制在容器边界内。
- 命中区尺寸统一使用 `--overlay-scrollbar-hit-size`；`OverlayScrollbar` 的几何计算和真实滚动层的预留空间必须引用同一个变量，禁止再次硬编码 `12px`。
- 新增或修改由 `OverlayScrollbar` 管理的 `ScrollableContent`（包括 `ToolLayoutScrollableContent`）时，真实滚动层必须在滚动内容边缘预留 `padding-inline-end: var(--overlay-scrollbar-hit-size)`，避免自绘滚动条覆盖文字、控件或分隔线；预留空间放在真实滚动层，不要放在 fixed overlay 外壳。
- 视觉滑块与命中区域分离；外壳 `pointer-events: none`，只有滑块接收事件，拖动绑定发起手势的 `pointerId` 并使用 pointer capture。
- `pointerup`、`pointercancel`、window blur、页面隐藏、源节点移除和组件卸载都必须进入同一个清理流程。
- fixed Overlay 不使用全局固定高 `z-index`；根据源容器层级和 Portal DOM 顺序决定 stacking context。
- 自绘滚动条必须补齐 `role="scrollbar"`、可聚焦、可访问名称、`aria-controls`、方向、`aria-valuemin/max/now`，并支持方向键、PageUp/PageDown、Home/End。

## 回归

本项目禁止使用 Playwright 或 Computer Use 验证。修改后至少运行 `npm run build` 和 `git diff --check`，并静态检查单轴/双轴、嵌套滚动、CodeMirror、隐藏页面、Popover/Select Portal、Dialog 内浮层、窗口失焦和动态内容变化。
