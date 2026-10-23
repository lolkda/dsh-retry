# Agent Note: 让「重试间隔」成为表单里可直接设置的数值

Status: implemented

## Problem

用户在 GUI 里看到 `正在重试模型请求（10/∞） · 重试延迟：10000 毫秒`，据此判断插件改不了这个重试间隔。该会话的运行事件（`llm/retry`，provider `cpa`，`policyKey ["always",500,10000,0.1]`，`retry:10`，`delayMs:10000`）证明这个数字正是插件同步进 provider 的退避策略算出来的：第 10 次已经顶到 `maxDelayMs`，起步延迟 `initialDelayMs = 500` 在这一次上完全不可见。表单此前只并列暴露三个原生字段，既没有说明用户看到的那个数字归哪个字段管，也没有恒定间隔的写法，于是出现了「能改但看不出来」的实际结果。

## Decision

「重试参数」区新增**退避方式**分段控件：`指数退避` / `固定间隔`。

- 固定间隔只编辑一个数值，保存时投影为 `{initialDelayMs: N, maxDelayMs: N, jitterRatio: 0}`（[src/ui-draft.js](../../../../src/ui-draft.js) 的 `policyFromDraft` / `constantBackoff`）；读取时由 `initialDelayMs === maxDelayMs && jitterRatio === 0` 反推形状（`draftFromPolicy`）。**不新增配置字段**，不改 native `RetryPolicy` Schema，不改 `dsh-llm-retry`，也不引入第二套重试循环。
- `backoffPreview(draft)` 复用与 `dsh-llm-retry` 相同的 `min(initialDelayMs × 2^(retry-1), maxDelayMs)` 公式（不含随机抖动）算出逐次等待，视图渲染为「退避预览：500 ms → 1000 ms → … · 第 6 次起封顶 10000 ms · 含 ±10% 随机抖动」。有限重试只列到 `maxRetries`，`always` 列到 6 条上限，因此不会虚报不会发生的重试。
- 抖动是随机量，预览只报基准值与幅度，不假装知道那一次的随机结果。
- 供应商覆盖编辑器复用同一套控件与预览，`retry_policy` 工具的 `backoff` 字段描述补充固定间隔的写法。
- 新增文案进 [src/ui-locales.js](../../../../src/ui-locales.js) 的 zh/en 两份字典（既有测试要求两份键集一致）。

## Alternatives considered

- 给 native 策略加一个「固定间隔」字段：被否。native Schema、每个 provider 的配置、catalog schema 都要跟着多一份状态，并产生「两个字段谁生效」的歧义；现有三个字段已足以表达恒定间隔。
- 只改文案，说明「第 10 次看到的是上限」：被否。用户要的是能改这个数值，文案也做不到让用户在保存前确认结果。
- 预览给出含抖动的具体数值：被否。抖动由 `Math.random` 决定，给出确定值等于撒谎。

## Verification

新增 [test/ui-draft.test.js](../../../../test/ui-draft.test.js)（形状识别、固定间隔投影、旧草稿兼容、字段级报错、脏检查、预览语义）与 3 条 UI 渲染测试；[test/integration-retry-executor.test.js](../../../../test/integration-retry-executor.test.js) 追加两条端到端用例，用真实安装的 `@deepseek-ai/dsh-llm-retry` 证明固定间隔草稿投影出的策略让三次重试的 `delayMs` 全为同一值（`[2,2,2]`），而同上限的指数退避仍是 `[2,4,8]`。`npm test` 220 项全绿（改动前 202 项），`npm run build`、`npm run check`、`npm run verify-notes` 通过。测试使用 DSH 安装内的真实 schema、真实重试执行器与 DOM 夹具，不向真实模型 API 制造限流。

## Consequences

- 固定间隔与指数退避是同一组原生字段的两种写法：把三个字段手填成 `500/500/0` 保存后，重新读取会显示为「固定间隔」，这是归一化而不是数据丢失。
- 预览是配置观测，不是运行中请求的证据：已经开始的退避仍使用捕获时的旧策略，`policyKey` 变化还会让计数从 1 重新开始。
- 改动只在本仓库生效，需要重新构建 `client.js` 并重装插件后 GUI 才会显示新控件。
