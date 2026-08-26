---
name: git-commit-guidance
description: 指导本项目 Git 提交的范围控制、变更审查、验证、提交信息编写和提交后确认。准备或创建 commit 时使用。
user-invocable: false
---

# Git 提交

提交是对一组完整、可验证变更的记录，不是把当前工作区一次性打包。除非用户明确要求，否则不要创建 commit、amend 或 push。

## 提交前

- 先运行 `git status --short`、`git diff --stat`、`git diff` 和 `git log --oneline -10`，确认工作区状态、变更边界和项目现有提交风格。
- 区分本次任务和用户或其他 agent 已有的修改。不要重置、恢复、覆盖或清理不属于本次任务的变更。
- 只暂存属于同一意图且相互依赖的文件；不要使用无选择的 `git add .`，不要暂存密钥、环境文件、构建产物或无关格式化结果。
- 按 `project-validation` skill 执行与变更范围匹配的验证。至少运行 `git diff --check`。

## 提交信息

- commit subject 和 body 必须使用英文；代码注释、报告和用户沟通仍遵循项目的中文语言规则。
- 优先遵循项目现有的 Conventional Commits 格式：`type(scope): imperative subject`。
- subject 使用祈使语气、描述用户可观察的结果、首字母小写且不以句号结尾；保持简洁，通常不超过 72 个字符。
- 使用 `feat`、`fix`、`refactor`、`docs`、`style`、`test`、`chore`、`build` 或 `ci` 等与变更相符的 type，不要用模糊的 `update` 或 `changes`。
- 只有在原因、约束或迁移影响无法从 subject 明确得出时才添加 body；body 说明 why 和重要影响，不重复文件清单。
- 不在提交信息中声称未执行的测试、验证或行为。

示例：

```text
docs(skills): add Git commit guidance
fix(config): preserve the default theme identifiers
refactor(layout): compose tool page regions
```

## 创建与确认

- 暂存后检查 `git diff --cached` 和 `git diff --cached --check`，确认没有遗漏、无关文件或敏感内容。
- 使用明确的 `git commit -m "..."` 创建提交；需要 body 时使用额外的 `-m`，并确保所有段落均为英文。
- 不跳过 hooks，不使用 `--no-verify`，不 amend 已有提交，除非用户明确要求。
- 提交后运行 `git status --short`，并检查 `git show --stat --oneline HEAD`，确认提交范围和工作区状态符合预期。
