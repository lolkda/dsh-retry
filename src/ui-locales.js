/**
 * Locale dictionaries for the retry settings section.
 *
 * Every user-visible string of the section resolves through these dictionaries;
 * the section never renders a literal that is missing here. Copy that the native
 * settings form frame renders (`readOnly`, `unavailable`, `saveFailed`, `save`,
 * `saving`) mirrors the wording the shipped pages use.
 *
 * @module ui-locales
 */

const zh = {
  nav: '请求重试',
  globalBadge: '全局策略',
  globalTitle: '全局默认',
  unconfiguredBadge: '未配置',
  providersTitle: '供应商覆盖',
  noProviders: '当前没有可配置的供应商。',
  overrideTag: '自定义',
  followGlobalTag: '跟随全局',
  editOverride: '编辑覆盖',
  createOverride: '单独设置',
  saveOverride: '保存覆盖',
  cancel: '取消',
  restoreFollowGlobal: '恢复跟随全局',
  syncSummaryShort: '{provider}',
  intro: '设置一份全局默认重试策略；每个供应商可以跟随全局，也可以单独覆盖。保存后同步到各供应商的原生 retryPolicy。',
  loading: '正在读取配置…',
  unavailable: '该插件当前未加载，暂时无法配置。',
  readOnly: '本部署的设置为只读。',
  readFailed: '读取设置失败：',
  saveFailed: '本部署没有接受这些值，已保留供你修改。',
  saving: '保存中…',
  save: '保存',
  discard: '放弃修改',
  dirty: '有未保存的修改',
  unconfigured: '尚未配置全局策略，当前显示原生默认值。',
  saved: '已保存。',
  conflict: '设置已被其他窗口或外部文件修改，未保存。',
  rejected: '保存被拒绝：',
  invalid: '配置无效：',
  externalChanged: '全局配置已在外部修改；保存不会覆盖它，请放弃并重新读取。',
  mode: '重试模式',
  parametersTitle: '重试参数',
  modeNormal: '有限重试',
  modeAlways: '持续重试',
  alwaysNote: '持续重试没有次数上限，认证、额度等永久失败也会一直重试，直到成功或取消，可能重复计费。',
  overridden: '已覆盖',
  resetToDefault: '恢复默认',
  maxRetries: '最大重试次数',
  maxRetriesHint: '不含首次请求；0 表示关闭普通重试。',
  unitRetries: '次',
  unitMilliseconds: 'ms',
  unitPercent: '%',
  initialDelayMs: '初始延迟（毫秒）',
  maxDelayMs: '最大延迟（毫秒）',
  jitterPercent: '随机抖动（%）',
  backoffHint: '延迟按指数增长并叠加抖动，且不超过最大延迟。',
  retryableCodes: '可重试错误',
  codeDefaults: '默认错误码',
  codeCustom: '自定义错误码',
  customCode: '自定义错误码',
  customCodePlaceholder: '例如 GATEWAY_BUSY',
  add: '添加',
  removeCode: '移除错误码',
  policyHint: 'RATE_LIMIT 表示临时限流；额度或余额耗尽属于 QUOTA，默认不会重试。',
  syncTitle: '同步状态',
  syncSummary: '已同步 {synced} / {total} 个供应商',
  syncPending: '未同步 {count} 个',
  syncAll: '全部同步完成',
  syncDiffers: '供应商策略与全局策略不一致',
  syncNone: '暂无供应商',
  syncReasonSeparator: '：'
};

const en = {
  nav: 'Request retries',
  globalBadge: 'Global policy',
  globalTitle: 'Global default',
  unconfiguredBadge: 'Not configured',
  providersTitle: 'Provider overrides',
  noProviders: 'No configurable providers yet.',
  overrideTag: 'Override',
  followGlobalTag: 'Follows global',
  editOverride: 'Edit override',
  createOverride: 'Set override',
  saveOverride: 'Save override',
  cancel: 'Cancel',
  restoreFollowGlobal: 'Restore follow global',
  syncSummaryShort: '{provider}',
  intro: 'Set one global default retry policy. Each provider can follow the default or define its own override; saving synchronizes the effective policy to each provider’s native retryPolicy.',
  loading: 'Loading configuration…',
  unavailable: 'This plugin is not loaded, so it cannot be configured right now.',
  readOnly: 'This deployment stores settings read-only.',
  readFailed: 'Reading settings failed: ',
  saveFailed: 'The deployment did not accept these values; they were left for you to correct.',
  saving: 'Saving…',
  save: 'Save',
  discard: 'Discard',
  dirty: 'Unsaved changes',
  unconfigured: 'No global policy is configured yet; the native defaults are shown.',
  saved: 'Saved.',
  conflict: 'Settings changed in another window or file; nothing was saved.',
  rejected: 'Save rejected: ',
  invalid: 'Invalid configuration: ',
  externalChanged: 'The global configuration changed elsewhere; saving will not overwrite it — discard and reload instead.',
  mode: 'Retry mode',
  parametersTitle: 'Retry parameters',
  modeNormal: 'Bounded retries',
  modeAlways: 'Unlimited retries',
  alwaysNote: 'Unlimited retries keep retrying permanent failures too, such as authentication and quota errors, until success or cancellation, and may be billed repeatedly.',
  overridden: 'Overridden',
  resetToDefault: 'Reset to default',
  maxRetries: 'Max retries',
  maxRetriesHint: 'Excludes the initial request; 0 disables ordinary retries.',
  unitRetries: 'retries',
  unitMilliseconds: 'ms',
  unitPercent: '%',
  initialDelayMs: 'Initial delay (ms)',
  maxDelayMs: 'Max delay (ms)',
  jitterPercent: 'Jitter (%)',
  backoffHint: 'Delay grows exponentially with jitter and never exceeds the max delay.',
  retryableCodes: 'Retryable errors',
  codeDefaults: 'Default codes',
  codeCustom: 'Custom codes',
  customCode: 'Custom error code',
  customCodePlaceholder: 'for example GATEWAY_BUSY',
  add: 'Add',
  removeCode: 'Remove error code',
  policyHint: 'RATE_LIMIT is a transient rate limit; an exhausted quota or balance is QUOTA and is not retried by default.',
  syncTitle: 'Synchronization',
  syncSummary: '{synced} of {total} providers synchronized',
  syncPending: '{count} pending',
  syncAll: 'All synchronized',
  syncDiffers: 'Provider policy differs from the global policy',
  syncNone: 'No providers',
  syncReasonSeparator: ': '
};

/** Built-in dictionaries keyed by locale id. */
export const dictionaries = { zh, en };

/**
 * Create a translator for one locale id.
 * @param localeId - locale id such as `zh` or `en`.
 * @returns `(key, params?) => string`, falling back to `zh` and then the key.
 */
export function createTranslator(localeId) {
  const primary = dictionaries[localeId] ?? {};
  return function translate(key, params) {
    const template = primary[key] ?? zh[key] ?? key;
    if (params === undefined) return template;
    return Object.entries(params).reduce(
      (text, [name, value]) => text.replaceAll(`{${name}}`, String(value)),
      template
    );
  };
}

/** Locale dictionary keys, shared by both dictionaries. */
export const localeKeys = Object.keys(zh);
