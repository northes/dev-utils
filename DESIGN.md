# DevUtils Design System

<!-- impeccable:design-schema 1 -->

## Visual World

Quiet Instrument（静默仪器）把 DevUtils 设计为一台面向开发者和运维人员的长期使用型调试工作台。界面通过稳定的结构、低饱和色彩和细微明度差表达层次，不依赖营销式装饰、卡片堆叠或动效。

## Mode

Operate：用户应能快速定位工具、输入数据、执行动作并读取结果。

## Principles

- 低噪声优先：删除不参与决策的信息和装饰。
- 结构表达层次：优先使用布局、边界和明度，不使用阴影、渐变或玻璃效果。
- 低饱和语义色：琥珀只表示焦点和主操作，成功/警告/错误使用克制的自然色。
- 长时间可用：暖色背景、紧凑但不拥挤的密度、明确的焦点状态。
- 无动效默认：状态变化通过颜色、边框和内容本身表达。

## Colors

### Dark / Graphite

- background `#151513`
- surface `#1B1B18`
- raised `#22221E`
- border `#34342E`
- text `#E8E6DD`
- text-secondary `#A6A49A`
- text-muted `#706F67`
- accent `#D6A15C`
- success `#8EAA84`
- warning `#C9A35E`
- danger `#C47C72`

### Light / Paper

- background `#F2F0E9`
- surface `#F8F7F2`
- raised `#FFFFFF`
- border `#D4D1C6`
- text `#292923`
- text-secondary `#68675F`
- text-muted `#96948A`
- accent `#8A5824`
- success `#587250`
- warning `#92702F`
- danger `#A65349`

Semantic usage: accent is reserved for current focus and the primary action; success, warning and danger are only used for state feedback; muted text must not carry essential information alone.

## Components

- Shell: flat background, 1px separators, quiet sidebar index and native-feeling title bar.
- Navigation: compact text/icon rows; active state uses an accent-tinted surface and accent text, never a saturated full-row fill.
- Tool header: one concise title, optional controls aligned to the right, no eyebrow or marketing subtitle.
- Editor: semantic editor surface, thin border, immediate accent focus state, CodeMirror remains the source of code interaction.
- Action bar: right-aligned, 30–32px controls, one primary action at most, clear/secondary actions visually quieter.
- Overlay: raised solid surface with border and restrained shadow; no blur or translucent glass.
- Status: use semantic colors sparingly and pair color with text/icon meaning.

## Token Architecture

The visual system is split into primitives, semantic themes, foundation layout, component contracts and tool-specific layers. Components consume semantic tokens only. `frontend/src/index.css` is an import manifest; all visual and structural rules live under `frontend/src/styles/`.

## Typography

System UI font for interface copy; system monospace for code, measurements and technical values. Four levels only: title, label, body and meta.

## Shape and Motion

No gradients, glassmorphism, decorative shadows or large rounded cards. Controls use 3–7px radii; editor surfaces are square or nearly square. Transitions and authored animations are disabled; focus and state changes use immediate color/border changes.

## Surface Contract

The sidebar is a quiet index, the title bar is a native window control zone, tool pages are flat working surfaces, and action bars are aligned to their content scope. Existing tools, command palette, tray matching, history, themes, i18n and CodeMirror behavior remain unchanged.
