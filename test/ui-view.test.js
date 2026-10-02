import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { installDom, mount, interact, byLabel, button, type } from './ui-dom.js';
import { RetrySettingsView } from '../src/ui-view.js';
import { createTranslator } from '../src/ui-locales.js';

installDom();

const h = React.createElement;
const t = createTranslator('zh');

const DEFAULT_CODES = ['EMPTY_RESPONSE', 'RATE_LIMIT', 'SERVER', 'TIMEOUT', 'TRANSPORT'];

function draft(overrides = {}) {
  return {
    mode: 'normal',
    maxRetries: 5,
    initialDelayMs: 500,
    maxDelayMs: 10000,
    jitterPercent: 10,
    retryableCodes: [...DEFAULT_CODES],
    ...overrides
  };
}

function snapshot(overrides = {}) {
  return {
    status: 'ready',
    error: null,
    notice: null,
    available: true,
    writable: true,
    configured: true,
    saving: false,
    dirty: false,
    failed: false,
    revision: 8,
    fieldErrors: {},
    sync: { total: 2, synced: 2, pending: [] },
    defaultCodes: [...DEFAULT_CODES],
    draft: draft(),
    ...overrides
  };
}

function actions(overrides = {}) {
  const calls = [];
  const record = name => (...args) => calls.push([name, ...args]);
  return {
    calls,
    value: {
      setField: record('setField'),
      toggleCode: record('toggleCode'),
      addCustomCode: record('addCustomCode'),
      removeCustomCode: record('removeCustomCode'),
      save: record('save'),
      discard: record('discard'),
      restoreInherited: record('restoreInherited'),
      ...overrides
    }
  };
}

async function render(state, recorder = actions()) {
  return mount(h(RetrySettingsView, { snapshot: state, actions: recorder.value, t }));
}

function classes(container) {
  return [...container.querySelectorAll('*')].map(node => node.getAttribute('class')).filter(Boolean).join(' ');
}

test('未配置时可以直接显式保存默认策略，不要求先制造脏草稿', async () => {
  const recorder = actions();
  const { container, unmount } = await render(snapshot({ configured: false, dirty: false }), recorder);
  try {
    const save = button(container, '保存');
    assert.equal(save.disabled, false);
    await interact(() => save.click());
    assert.deepEqual(recorder.calls, [['save']]);
  } finally {
    await unmount();
  }
});

test('全局页不提供任何供应商选择控件', async () => {
  const { container, unmount } = await render(snapshot());
  try {
    assert.equal(container.querySelector('select'), null);
    assert.equal(container.querySelector('[aria-label="供应商"]'), null);
    assert.match(container.textContent, /全局/);
  } finally {
    await unmount();
  }
});

test('页面自行绘制标题并标记全局作用域，不从说明文字起头', async () => {
  const { container, unmount } = await render(snapshot());
  try {
    const section = container.querySelector('section.drs-section');
    assert.ok(section !== null, 'section page must render the official section element');
    const title = section.querySelector('h2.drs-title');
    assert.equal(title.textContent, '请求重试');
    const intro = section.querySelector('.drs-intro');
    assert.equal(intro.textContent, '设置一份全局默认重试策略；每个供应商可以跟随全局，也可以单独覆盖。保存后同步到各供应商的原生 retryPolicy。');
    assert.equal(container.querySelectorAll('h2').length, 1);
    const badge = [...container.querySelectorAll('.drs-tag')].find(node => node.textContent.trim() === '全局策略');
    assert.ok(badge !== null);
    assert.equal(badge.getAttribute('data-tone'), 'outline');
  } finally {
    await unmount();
  }
});

test('命名空间不可用时仍保留原生标题', async () => {
  const { container, unmount } = await render(snapshot({ available: false, draft: null }));
  try {
    assert.equal(container.querySelector('h2.drs-title').textContent, '请求重试');
    assert.equal(container.querySelector('[class*="drs-form"]'), null);
  } finally {
    await unmount();
  }
});

test('表单采用 DSH 设计语言：卡片、分段控件、输入壳与芯片', async () => {
  const { container, unmount } = await render(snapshot());
  try {
    const css = classes(container);
    for (const name of ['drs-section', 'drs-title', 'drs-intro', 'drs-form', 'drs-panel', 'drs-panelSection', 'drs-numberGrid', 'drs-field', 'drs-head', 'drs-label', 'drs-input', 'drs-hint', 'drs-chipList', 'drs-providerSummary', 'drs-footer', 'drs-save', 'drs-secondaryButton']) {
      assert.ok(css.includes(name), `missing redesigned class ${name}`);
    }
    const save = button(container, '保存');
    assert.ok(save.getAttribute('class').includes('drs-save'));
    const retries = byLabel(container, '最大重试次数');
    assert.ok(retries.getAttribute('class').includes('drs-input'));
    assert.equal(retries.type, 'text');
    assert.equal(retries.getAttribute('inputmode'), 'numeric');
    assert.ok(container.querySelectorAll('[class*="drs-field"]').length >= 4);
    const segmented = container.querySelector('[role="tablist"].drs-segmented');
    assert.ok(segmented !== null);
    assert.equal(segmented.style.getPropertyValue('--drs-segment-count'), '2');
    assert.equal(segmented.style.getPropertyValue('--drs-segment-index'), '0');
    assert.equal(segmented.querySelector('[role="tab"][aria-selected="true"]').textContent, '有限重试');
    assert.ok(container.querySelector('.drs-segmentedIndicator') !== null);
    assert.equal(container.querySelectorAll('.drs-chip[data-checked="true"]').length, DEFAULT_CODES.length);
  } finally {
    await unmount();
  }
});

test('命名空间不可用时只显示 native 的不可用状态行', async () => {
  const { container, unmount } = await render(snapshot({ available: false, draft: null }));
  try {
    const status = container.querySelector('[role="status"]');
    assert.ok(status !== null);
    assert.ok(status.getAttribute('class').includes('drs-unavailable'));
    assert.match(container.textContent, /未加载|不可用/);
    assert.equal(container.querySelector('[class*="drs-form"]'), null);
  } finally {
    await unmount();
  }
});

test('只读部署显示 native 只读状态行并禁用输入', async () => {
  const { container, unmount } = await render(snapshot({ writable: false, dirty: true }));
  try {
    const readOnly = container.querySelector('[class*="drs-readOnly"]');
    assert.ok(readOnly !== null);
    assert.equal(readOnly.getAttribute('role'), 'status');
    assert.equal(byLabel(container, '最大重试次数').disabled, true);
    assert.equal(button(container, '保存').disabled, true);
  } finally {
    await unmount();
  }
});

test('保存按钮遵循原生状态：脏且合法才可点，保存中显示保存中', async () => {
  const clean = await render(snapshot({ dirty: false }));
  try {
    assert.equal(button(clean.container, '保存').disabled, true);
  } finally {
    await clean.unmount();
  }
  const invalid = await render(snapshot({ dirty: true, fieldErrors: { maxRetries: 'policy.maxRetries is required' } }));
  try {
    assert.equal(button(invalid.container, '保存').disabled, true);
    const input = byLabel(invalid.container, '最大重试次数');
    assert.equal(input.getAttribute('aria-invalid'), 'true');
    assert.match(invalid.container.querySelector('[class*="drs-invalid"]').textContent, /required/);
  } finally {
    await invalid.unmount();
  }
  const saving = await render(snapshot({ dirty: true, saving: true }));
  try {
    const save = button(saving.container, '保存中…');
    assert.equal(save.disabled, true);
    assert.ok(save.getAttribute('class').includes('drs-save'));
  } finally {
    await saving.unmount();
  }
});

test('保存失败显示原生 failed 行且草稿保留', async () => {
  const { container, unmount } = await render(snapshot({ dirty: true, failed: true, draft: draft({ maxRetries: 12 }) }));
  try {
    const failed = container.querySelector('[class*="drs-failed"]');
    assert.ok(failed !== null);
    assert.equal(failed.getAttribute('role'), 'status');
    assert.equal(byLabel(container, '最大重试次数').value, '12');
  } finally {
    await unmount();
  }
});

test('normal 模式显示次数、延迟、抖动与错误码；always 保留延迟', async () => {
  const normal = await render(snapshot({ draft: draft({ maxRetries: 7, initialDelayMs: 1500, jitterPercent: 25 }) }));
  try {
    assert.equal(byLabel(normal.container, '最大重试次数').value, '7');
    assert.equal(byLabel(normal.container, '初始延迟（毫秒）').value, '1500');
    assert.equal(byLabel(normal.container, '随机抖动（%）').value, '25');
    assert.equal(byLabel(normal.container, '可重试错误').querySelectorAll('input').length, DEFAULT_CODES.length);
  } finally {
    await normal.unmount();
  }
  const always = await render(snapshot({ draft: draft({ mode: 'always', initialDelayMs: 3000, jitterPercent: 5 }) }));
  try {
    assert.equal(always.container.querySelector('[aria-label="最大重试次数"]'), null);
    assert.equal(always.container.querySelector('[aria-label="可重试错误"]'), null);
    assert.equal(byLabel(always.container, '初始延迟（毫秒）').value, '3000');
    assert.equal(byLabel(always.container, '随机抖动（%）').value, '5');
    assert.match(always.container.textContent, /永久/);
  } finally {
    await always.unmount();
  }
});

test('错误码勾选与自定义错误码按目标状态上报', async () => {
  const recorder = actions();
  const state = snapshot({ draft: draft({ retryableCodes: ['RATE_LIMIT', 'MY_GATEWAY_CODE'] }) });
  const { container, unmount } = await render(state, recorder);
  try {
    await interact(() => byLabel(container, '可重试错误').querySelector('input[value="SERVER"]').click());
    await interact(() => byLabel(container, '可重试错误').querySelector('input[value="RATE_LIMIT"]').click());
    await interact(() => type(byLabel(container, '自定义错误码'), 'EXTRA_CODE'));
    await interact(() => button(container, '添加').click());
    assert.deepEqual(recorder.calls, [
      ['toggleCode', 'SERVER', true],
      ['toggleCode', 'RATE_LIMIT', false],
      ['addCustomCode', 'EXTRA_CODE']
    ]);
    assert.match(container.textContent, /MY_GATEWAY_CODE/);
  } finally {
    await unmount();
  }
});

test('显式保存、放弃与恢复继承分别触发动作', async () => {
  const recorder = actions();
  const { container, unmount } = await render(snapshot({ dirty: true, configured: true }), recorder);
  try {
    await interact(() => button(container, '保存').click());
    await interact(() => button(container, '放弃修改').click());
    await interact(() => button(container, '恢复默认').click());
    assert.deepEqual(recorder.calls, [['save'], ['discard'], ['restoreInherited']]);
  } finally {
    await unmount();
  }
});

test('未配置全局策略时显示未配置提示与原生默认草稿', async () => {
  const { container, unmount } = await render(snapshot({ configured: false, notice: { kind: 'unconfigured' } }));
  try {
    assert.match(container.textContent, /未配置/);
    assert.equal(byLabel(container, '最大重试次数').value, '5');
    assert.equal([...container.querySelectorAll('button')].some(node => node.textContent.trim() === '恢复默认'), false);
  } finally {
    await unmount();
  }
});

test('已覆盖时显示 DSH 徽标与恢复默认控件', async () => {
  const recorder = actions();
  const { container, unmount } = await render(snapshot({ configured: true }), recorder);
  try {
    const badge = [...container.querySelectorAll('.drs-tag')].find(node => node.textContent.trim() === '已覆盖');
    assert.ok(badge !== null);
    assert.equal(badge.getAttribute('data-tone'), 'neutral');
    assert.ok(badge.closest('[class*="drs-badges"]') !== null);
    assert.ok(button(container, '恢复默认').getAttribute('class').includes('drs-reset'));
    await interact(() => button(container, '恢复默认').click());
    assert.deepEqual(recorder.calls, [['restoreInherited']]);
  } finally {
    await unmount();
  }
});

test('同步摘要诚实显示已同步与未同步数量及明细', async () => {
  const state = snapshot({
    sync: { total: 3, synced: 2, pending: [{ provider: 'cpa', reason: 'provider "cpa" stores an invalid retryPolicy' }] }
  });
  const { container, unmount } = await render(state);
  try {
    const text = container.textContent;
    assert.match(text, /3/);
    assert.match(text, /2/);
    assert.match(text, /cpa/);
    assert.match(text, /invalid retryPolicy/);
    assert.match(text, /未同步/);
  } finally {
    await unmount();
  }
});

test('常见同步差异原因按界面语言显示', async () => {
  const state = snapshot({
    sync: { total: 2, synced: 1, pending: [{ provider: 'cpa', reason: 'the provider policy differs from the global policy' }] }
  });
  const { container, unmount } = await render(state);
  try {
    assert.match(container.textContent, /cpa/);
    assert.match(container.textContent, /供应商策略与全局策略不一致/);
    assert.doesNotMatch(container.textContent, /provider policy differs/);
  } finally {
    await unmount();
  }
});

test('同步全部完成时不显示未同步明细', async () => {
  const { container, unmount } = await render(snapshot({ sync: { total: 2, synced: 2, pending: [] } }));
  try {
    assert.match(container.textContent, /2/);
    assert.equal(/未同步/.test(container.textContent), false);
  } finally {
    await unmount();
  }
});

test('冲突提示可见且草稿值保留', async () => {
  const state = snapshot({ dirty: true, draft: draft({ maxRetries: 12 }), notice: { kind: 'conflict', message: '设置已被其他窗口修改' } });
  const { container, unmount } = await render(state);
  try {
    assert.match(container.querySelector('[role="alert"]').textContent, /设置已被其他窗口修改/);
    assert.equal(byLabel(container, '最大重试次数').value, '12');
  } finally {
    await unmount();
  }
});

test('字段编辑与分段控件切换按字段名上报', async () => {
  const recorder = actions();
  const { container, unmount } = await render(snapshot({ dirty: true }), recorder);
  try {
    await interact(() => type(byLabel(container, '最大重试次数'), '9'));
    await interact(() => button(container, '持续重试').click());
    assert.deepEqual(recorder.calls, [['setField', 'maxRetries', 9], ['setField', 'mode', 'always']]);
  } finally {
    await unmount();
  }
});

test('供应商列表展示全局跟随状态与单独设置入口', async () => {
  const state = snapshot({
    providers: [{
      provider: 'cpa',
      displayName: 'CPA',
      editable: true,
      hasOverride: false,
      synced: true,
      reason: null,
      policy: draft({ maxRetries: 5 })
    }]
  });
  const { container, unmount } = await render(state);
  try {
    assert.match(container.textContent, /CPA/);
    assert.match(container.textContent, /cpa/);
    assert.match(container.textContent, /跟随全局/);
    assert.ok(button(container, '单独设置') !== null);
  } finally {
    await unmount();
  }
});

test('选中供应商后展开覆盖编辑器并显示保存覆盖', async () => {
  const state = snapshot({
    selectedProvider: 'cpa',
    providerDraft: draft({ maxRetries: 7 }),
    providerFieldErrors: {},
    providerDirty: true,
    providerConfigured: false,
    providers: [{
      provider: 'cpa',
      displayName: 'CPA',
      editable: true,
      hasOverride: false,
      synced: true,
      reason: null,
      policy: draft({ maxRetries: 5 })
    }]
  });
  const { container, unmount } = await render(state);
  try {
    assert.ok(button(container, '保存覆盖') !== null);
    const providerInput = container.querySelector('#drs-provider-cpa-maxRetries');
    assert.ok(providerInput !== null);
    assert.equal(providerInput.value, '7');
  } finally {
    await unmount();
  }
});
