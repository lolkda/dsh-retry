# Agent Note: 修复 retry_policy 工具在全部供应商同步时的输出校验失败

Status: implemented

## Problem

`retry_policy` 工具的四个 action 在真实宿主上全部失败：

```
tool "retry_policy" returned invalid output: "value.providers[0].reason" must be a string;
"value.providers[1].reason" must be a string; "value.providers[2].reason" must be a string
```

[src/host.js](../../../../src/host.js) 的 `readState` 对每一行 provider 写 `reason: one.pending[0]?.reason ?? null`，而声明给宿主的 `OUTPUT_SCHEMA` 里 `reason` 是 `{ type: 'string' }`：供应商同步成功时 `pending` 为空，于是必然写出 `null`。宿主在 `createSuccessResult` 里用 `validateJsonSchemaValue(tool.output.schema, …)` 校验输出，因此这不是外观问题，而是整次工具调用被判失败。供应商越同步越必然触发（本部署 cpa 等 3 个供应商均已同步）。GUI 保存走 `remote.settings.mutate`，不经过这个 schema，所以只有走工具改配置时表现为「改不了」。既有 202 项测试只覆盖未同步分支，未拦住它。

## Decision

同步成功时**省略** `reason` 键（`reason` 本来就不在 `required` 里，渲染函数也已容忍 `undefined`）。回归测试用宿主自己的校验器验证真实输出：[test/host.test.js](../../../../test/host.test.js) 从已安装的 `@deepseek-ai/dsh-tools` 取 `validateJsonSchemaValue`，对全部供应商已同步的 `list` 与 `set` 结果断言零违规 —— 修复前这两条会复现出与生产完全相同的报错文本。

## Alternatives considered

- 把 schema 放宽成 `type: ['string', 'null']`：被否。会让「没有原因」和「原因是 null」两种表示同时存在于契约里，客户端也要跟着改。
- 只在 `render` 阶段剥掉 null：被否。输出校验发生在 render 之前，无效值仍然会被拒绝。
- 改动数据源让 `pending` 总有条目：被否。那会伪造同步失败信息，等于向用户撒谎。

## Verification

修复前：`npm test` 208 项、6 失败（新增的 2 条 host 校验、3 条 UI、1 个 ui-draft 文件），失败文本与生产报错一致。修复后：218 项全绿，`npm run build`、`npm run check`、`npm run verify-notes` 通过。

## Consequences

工具的 `list`/`get`/`set`/`reset` 在供应商全部同步时恢复可用，`pending` 明细仍然只在真正未同步时出现。输出中已同步的供应商不再携带 `reason` 键；客户端 UI 自己维护的 `?? null` 视图语义不受影响。已安装的旧版本仍带此缺陷，需重装插件后才生效。
