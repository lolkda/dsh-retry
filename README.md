# DSH 请求重试设置：全局默认 + 供应商覆盖

在 **设置 → 请求重试** 用 DSH 风格的界面编辑一套**全局默认策略**；每个供应商可以跟随全局，也可以**单独覆盖**。全局策略自动同步到所有未覆盖的供应商（包括后来新增的供应商），覆盖策略只写对应供应商的原生 `retryPolicy`。

## 使用与语义

- 点击保存才写入全局策略。尚未配置时显示 DSH 默认草稿，可直接保存以启用；未配置的插件不会写供应商配置。
- 全局策略配置后，Host 在启动、设置变化或供应商变化时自动同步。策略写进供应商原生 `retryPolicy`，仍由 DSH 内置重试器执行；没有第二套重试循环。
- `maxRetries` 不含首次请求，0 关闭普通重试；`always` 持续重试包含认证、额度等永久错误，取消仍可终止等待。
- 默认：5 次、500 ms 起步、10000 ms 上限、10% 抖动；默认错误码为 `EMPTY_RESPONSE`、`RATE_LIMIT`、`SERVER`、`TIMEOUT`、`TRANSPORT`。
- 有效服务端 Retry-After 在上限内优先；原生 normal 模式遇到超过延迟上限的建议等待时间会放弃这次普通重试。
- 页面显示同步数量和未同步条目，并在“供应商覆盖”区列出每个供应商：跟随全局或自定义，可展开编辑、保存覆盖、恢复跟随全局。
- `retry_policy` 工具不传 `provider` 时读写全局默认策略；传入 `provider` 时读写该供应商的覆盖策略。跨设置命名空间的同步不是原子事务：部分失败会保留成功部分，不伪称全部生效。同命名空间的多个供应商用一次原子路径操作列表保存。
- 新供应商同步是异步的，不保证其第一个请求之前已完成。已经开始的请求/退避继续使用捕获的旧策略，后续请求使用同步后的策略。
- 保存冲突时保留草稿；明确放弃后采用已读取的最新版本，不无条件覆盖其他编辑者。
- 恢复默认/继承会移除当前层的全局覆盖。若没有下层全局策略，停止统一同步；**不会回滚已经写入供应商的策略**。

## 视觉设计

页面壳（标题、说明与 720px 版心）沿用官方 Settings section page 的结构；表单本体按 DSH 客户端自身的视觉语言重新设计：token 驱动的设置卡片、分段控件（normal/always）、带单位输入壳、错误码芯片、状态点同步摘要，以及 Button 尺寸的主/次操作按钮。所有规则只使用公开的 `--dsw-*` 设计令牌与稳定的 `drs-` 前缀类名，CSS 位于 `src/ui-style.js`，不依赖第三方 Client 内部包的运行时导入或哈希类名，深浅色与窄屏均自适应。

早期逐字 vendor 的官方 SettingsForm CSS 快照保留在 `src/vendor/`，仅用于来源核验（见 `PROVENANCE.md`，MIT）；它不再注入页面。

## 生命周期与工具

禁用/卸载插件会停止同步并移除页面和工具，已经应用的原生策略继续有效。重新启用后按保存的全局策略同步。

`retry_policy` 支持 `list/get/set/reset`（list 为全局读取），**不再接受 provider 参数**。修改需要显式 `expectedRevision`（原生初始版本为0）以及 set 时的 policy。工具输出包含全局版本号和同步报告，沿用计划模式/只读/取消保护。

页面只保存插件自身 `policy` 字段，Host 只更改各供应商的 `retryPolicy`；不读取凭据内容，不覆盖模型列表、URL或其他设置。

## 开发与安装

兼容 DSH `0.2.0-rc.2`；使用匹配的 Schemastery Config 库，Client 复用宿主 React。

```bash
npm ci --ignore-scripts --legacy-peer-deps
npm test
npm run build
npm run check
```

使用 `plugin_manager install_bundle` 安装包目录。以返回的应用状态为准，更新已安装包可能需要重启。不要直接改写 profile 文件。`client.js` 由 `scripts/build.mjs` 生成，不手工修改。

测试包含真实 DSH Loader、Settings、配置编辑器及原生 retry executor；供应商为隔离测试夹具，不向真实模型 API 制造限流。GUI 验收另外记录在交付说明中。
