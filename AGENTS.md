# AGENTS.md

## 项目定位

- 本项目是 Wails v3 beta 桌面开发者工具启动器：Go 负责窗口、托盘和服务，React 19 前端是产品主体。
- 优先沿用现有数据流、组件、类型、事件和持久化机制；不要为局部需求创建平行抽象、兼容分支或第二套状态来源。

## 语言与国际化

- 始终使用简体中文与用户沟通；代码注释、报告和评审意见使用中文；Git commit subject/body 必须使用英文，并遵循 `.agents/skills/git-commit-guidance/SKILL.md`。
- 应用默认语言和回退语言为 `zh-CN`。前端用户可见文案必须通过 i18n 资源提供；原生 Go 托盘文案遵循 `.agents/skills/i18n-guidance/SKILL.md`。

## 强制 Skill 路由

### 范围判定

- 只加载直接命中当前变更边界的 skill；`project-validation` 用于实现完成后的验证，不在任务开始时展开完整验证矩阵。
- 修改现有工具的局部行为或样式，且不改变工具 ID、注册、导航、历史、托盘、配置、事件或 bindings 时，不执行新增工具的完整接线清单。
- 仅在持久化 Config、Wails 事件、托盘、Go 服务或 bindings 边界实际受影响时，才梳理前后端接线。
- 先检查直接生产者和消费者；发现跨界证据后再扩展检查范围，不做无依据的全仓扫描。

- 主题实现与接线：`.agents/skills/theme-customization/SKILL.md`
- 主题回归验证：`.agents/skills/theme-validation/SKILL.md`
- 工具页、编辑器、浮层或滚动条：`.agents/skills/layout-guidance/SKILL.md`
- 新增开发者工具及其接线：`.agents/skills/tool-development/SKILL.md`
- Wails、Go 服务、托盘、窗口、配置、事件或 bindings：`.agents/skills/wails-integration/SKILL.md`
- UI 文案、locale 或语言设置：`.agents/skills/i18n-guidance/SKILL.md`
- shadcn/Base UI 组件安装、更新、组合或样式：`.agents/skills/shadcn/SKILL.md`
- 实现完成后的命令验证：`.agents/skills/project-validation/SKILL.md`
- Git 提交、提交拆分、提交信息和提交前检查：`.agents/skills/git-commit-guidance/SKILL.md`
- 明确进行 Radix 到 Base UI 迁移时使用 `.agents/skills/migrate-radix-to-base/SKILL.md`。

## 全局不变量

- `default-light` 和 `default-dark` 是持久化配置值，不得改名、复用或删除；其他主题约束以主题 skills 为准。
- 设置页配置由 Go `ConfigService` 管理，前端不得写入设置 localStorage；唯一页面恢复 key 是 `devutils.lastPage`。
- `frontend/bindings/` 是 Wails 生成文件，永远不要手工编辑；Go 导出类型变化后必须重新生成 bindings。
- 所有项目开发、构建、打包和运行任务以根目录 `Taskfile.yml` 为准，通过 `wails3 task <name>` 执行。`main.go` 嵌入 `frontend/dist`，Go 构建前必须有前端产物。
- 不使用 Playwright、`playwright-cli`、Computer Use 或任何浏览器自动化进行测试和验证。
- 使用 shadcn/Base UI 组件时，优先直接使用组件提供的官方默认样式；局部视觉调整优先使用现有 Tailwind utility class。不得为单个控件新增局部 CSS 覆盖、专用选择器或单独样式文件，也不要通过局部 class 改写官方组件的默认外观，除非需求明确要求且无法用现有组件能力实现。

## 工程质量

- 状态由真正拥有它的边界管理，副作用集中在生命周期边界，数据流、错误传播、取消语义和可访问性先于视觉优化。
- 修复问题必须定位并覆盖根因及相关边界；禁止用特殊分支、延迟、魔法值、选择器覆盖、异常吞掉或隐式重试掩盖错误。
- 抽象只服务于已经存在的重复、耦合或稳定变化点；优先组合和清晰职责，避免不断增加布尔 props、全局状态和隐式依赖。
