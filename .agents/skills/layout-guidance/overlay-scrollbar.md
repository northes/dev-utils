# OverlayScrollbar

仅在修改 `OverlayScrollbar`、`ScrollableContent` 或 `ToolLayoutScrollableContent` 时使用。本项目不要把这些容器改成 `ScrollArea`。

## 规则

- 自绘滚动条以真实滚动容器为责任边界，初始化发现已有容器，DOM 增删增量注册，使用 `ResizeObserver` 跟踪尺寸。
- 横纵轴资格、布局和拖动计算必须复用同一个判定函数；`overflow-x: hidden` 不得生成横向滑块。
- 滑块长度、位置和拖动映射使用可滚范围及扣除最小滑块后的有效轨道，并钳制在容器边界内。
- 命中区尺寸统一使用 `--overlay-scrollbar-hit-size`；`OverlayScrollbar` 的几何计算和真实滚动层的预留空间必须引用同一个变量，禁止再次硬编码 `12px`。
- 新增或修改由 `OverlayScrollbar` 管理的 `ScrollableContent`（包括 `ToolLayoutScrollableContent`）时，真实滚动层必须在滚动内容边缘预留 `padding-inline-end: var(--overlay-scrollbar-hit-size)`，避免自绘滚动条覆盖文字、控件或分隔线；预留空间放在真实滚动层，不要放在 fixed overlay 外壳。
- 视觉滑块与命中区域分离；外壳 `pointer-events: none`，只有滑块接收事件，拖动绑定发起手势的 `pointerId` 并使用 pointer capture。
- `pointerup`、`pointercancel`、window blur、页面隐藏、源节点移除和组件卸载都必须进入同一个清理流程。
- fixed Overlay 不使用全局固定高 `z-index`；根据源容器层级和 Portal DOM 顺序决定 stacking context。
- 自绘滚动条必须补齐 `role="scrollbar"`、可聚焦、可访问名称、`aria-controls`、方向、`aria-valuemin/max/now`，并支持方向键、PageUp/PageDown、Home/End。

## 静态检查

- 横纵轴资格、嵌套滚动、动态内容/尺寸变化、失焦清理。
- 可访问性和命中区预留。
- 未重新引入硬编码命中区尺寸。
