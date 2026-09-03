# 编解码类工具特例

仅在新增 JWT 或同类编解码工具时读取。通用接线仍以 `SKILL.md` 为准。

## JWT

- 纯前端解码，不新增依赖；复用共享 `decodeBase64` 解 header/payload。
- 使用左侧可编辑 CodeMirror，右侧上下只读 header/payload；不展示 signature。
- 底部动作顺序为“清空 → 复制 Header → 复制 Payload”，对应 tertiary、secondary、primary。
- 托盘命中要求三段 base64url JWT，且 header、payload 都能解为非空 JSON 对象。
- JWT 检测顺序在 time 之后、base64/json/text 之前。
