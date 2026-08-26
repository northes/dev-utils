---
name: i18n-guidance
description: 指导本项目 React i18next、多语言资源、用户可见文案和托盘文案接线。涉及 UI 文案、locale 或语言设置时使用。
user-invocable: false
---

# 国际化

本项目默认语言为简体中文 `zh-CN`，文案结构必须可扩展。用户可见文案是数据的一部分，不应散落在组件、路由、命令或托盘回调中。

## 资源与初始化

- i18n 在 `frontend/src/i18n.ts` 初始化；`frontend/src/main.tsx` 只通过 `import './i18n'` 确保初始化发生在渲染前。
- 语言资源统一放在 `frontend/src/locales/`，当前维护 `zh-CN.json` 和 `en-US.json`。
- `DEFAULT_LANGUAGE` 和 `fallbackLng` 当前均为 `zh-CN`。新增语言时同步更新 `SUPPORTED_LANGUAGES`、资源注册和设置页语言选项。
- 不把持久化 ID、工具 ID、主题 ID 或事件名直接作为用户可见文本；显示名称使用 locale key。

## 组件与文案

- React 组件、`App.tsx`、命令面板、历史记录和设置页不得硬编码用户可见字符串；使用 `useTranslation()` 或 `t()`。
- 新增工具、命令、主题、设置项或错误提示时，先定义稳定的 key，再同步更新 `zh-CN.json` 和 `en-US.json`。
- 命令面板的 `labelKey` 复用实际界面按钮文案；只有切换型命令才使用独立的 `commands.toggleXxx` key。
- locale key 按领域组织，例如 `tools.<id>`、`<tool>Tool.*`、`commands.*`、`settings.*`；不要为同一文案建立重复 key。
- 翻译缺失应在资源层修复，不在组件中增加英文、中文或默认字符串兜底分支。

## Go 托盘文案

- Go 托盘菜单不运行 React i18next；其文案必须遵循当前配置的语言分支，并保持默认中文可用。
- 修改托盘菜单或 tooltip 时同步检查中文和英文分支，避免只修改一个语言分支，也不要把前端 locale key 当作托盘显示文本。
- 托盘文案和前端对应功能使用相同的产品术语；新增菜单项必须接通实际事件，不只增加字符串。

## 验证

- 搜索新增代码中的硬编码用户可见字符串，确认它们已迁移到 locale；允许日志、错误类型、协议值和内部 ID 保持代码常量。
- 检查中英文资源的 key 结构一致、默认语言和回退语言仍为 `zh-CN`。
- 在 `frontend/` 运行 `npx tsc --noEmit` 和 `npm run build`，再按任务范围执行 `project-validation` skill。
