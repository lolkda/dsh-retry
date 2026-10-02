import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { installDom, mount } from './ui-dom.js';
import { inject, apply } from '../src/client.js';
import { DEFAULT_POLICY, GLOBAL_SETTINGS_NS } from '../src/policy.js';

installDom();

const GLOBAL_SCHEMA = { type: 'object', properties: { policy: { type: 'object' } } };

const GLOBAL_POLICY = {
  mode: 'normal',
  maxRetries: 20,
  retryableCodes: [...DEFAULT_POLICY.retryableCodes],
  backoff: { initialDelayMs: 500, maxDelayMs: 10000, jitterRatio: 0.1 }
};

function flush() {
  return new Promise(resolve => setImmediate(resolve));
}

/**
 * Build a Cordis-like client context that records registrations, subscriptions,
 * forwarded events, and effects, and answers the Remote reads the page uses.
 * @returns the context plus its captured state.
 */
function fakeCtx() {
  const state = {
    registrations: [],
    injectedSlots: [],
    remoteEvents: new Map(),
    localEvents: new Map(),
    effects: [],
    localeDictionaries: [],
    describeCalls: 0,
    mutateCalls: 0
  };
  const namespaces = [
    {
      ns: GLOBAL_SETTINGS_NS,
      schema: GLOBAL_SCHEMA,
      revision: 8,
      value: { policy: GLOBAL_POLICY },
      user: { policy: GLOBAL_POLICY },
      autoGenerate: true,
      applies: 'live',
      secrets: []
    },
    {
      ns: 'llm-pi-ai',
      schema: {
        type: 'object',
        properties: {
          providers: {
            type: 'object',
            additionalProperties: { type: 'object', properties: { retryPolicy: { type: 'object' } } }
          }
        }
      },
      revision: 3,
      value: { providers: { cpa: { retryPolicy: GLOBAL_POLICY } } },
      user: {},
      autoGenerate: true,
      applies: 'live',
      secrets: []
    }
  ];
  const ctx = {
    effect(callback, label) {
      const dispose = callback();
      state.effects.push({ label, dispose });
      return dispose;
    },
    on(name, listener) {
      state.localEvents.set(name, listener);
      return () => state.localEvents.delete(name);
    },
    locale: {
      register(ns, dictionaries) {
        state.localeDictionaries.push([ns, dictionaries]);
        return () => {};
      },
      bind(ns) {
        return key => {
          const found = state.localeDictionaries.find(entry => entry[0] === ns);
          return found?.[1]?.zh?.[key] ?? key;
        };
      }
    },
    slots: {
      inject(key, callback) {
        state.injectedSlots.push(key);
        callback();
        return () => {};
      },
      register(options, component) {
        state.registrations.push({ options, component });
        return () => {};
      }
    },
    remote: {
      $on(name, listener) {
        state.remoteEvents.set(name, listener);
        return () => state.remoteEvents.delete(name);
      },
      settings: {
        describe: async () => {
          state.describeCalls += 1;
          return { ok: true, value: { writable: true, hasDocument: false, namespaces } };
        },
        mutate: async () => {
          state.mutateCalls += 1;
          return { ok: false, error: { code: 'settings/rejected', message: 'unexpected write' } };
        }
      },
      llm: {
        listConfigurableProviders: async () => ({
          ok: true,
          value: [{ provider: 'cpa', displayName: 'CPA', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'cpa'] }]
        })
      }
    }
  };
  return { ctx, state };
}

test('客户端入口注册请求重试分区并声明所需服务', async () => {
  const { ctx, state } = fakeCtx();
  for (const required of ['slots', 'locale', 'remote', 'remote.settings', 'remote.llm']) {
    assert.ok(inject.includes(required), `missing inject entry ${required}`);
  }
  apply(ctx);
  assert.deepEqual(state.injectedSlots, ['settings.section']);
  assert.equal(state.registrations.length, 1);
  const { options, component } = state.registrations[0];
  assert.equal(options.name, 'settings.section');
  assert.equal(options.id, 'dsh-retry-settings');
  assert.equal(options.order, 12);
  assert.equal(options.label(), '请求重试');
  assert.equal(typeof component, 'function');
});

test('挂载时只读取配置，不发出任何设置写入', async () => {
  const { ctx, state } = fakeCtx();
  apply(ctx);
  await flush();
  assert.equal(state.describeCalls, 1);
  assert.equal(state.mutateCalls, 0);
});

test('挂载不注册轮询定时器', async () => {
  const { ctx } = fakeCtx();
  const original = globalThis.setInterval;
  let intervals = 0;
  globalThis.setInterval = (...args) => {
    intervals += 1;
    return original(...args);
  };
  try {
    apply(ctx);
    await flush();
  } finally {
    globalThis.setInterval = original;
  }
  assert.equal(intervals, 0);
});

test('原生设置与供应商变化触发重新读取，卸载后停止', async () => {
  const { ctx, state } = fakeCtx();
  apply(ctx);
  await flush();
  for (const event of ['settings/document-updated', 'llm/adapters-updated']) {
    assert.equal(typeof state.remoteEvents.get(event), 'function', `not subscribed to ${event}`);
  }
  assert.equal(typeof state.localEvents.get('connection/reset'), 'function');
  const before = state.describeCalls;
  state.remoteEvents.get('settings/document-updated')();
  await flush();
  assert.equal(state.describeCalls, before + 1);
  state.localEvents.get('connection/reset')();
  await flush();
  assert.equal(state.describeCalls, before + 2);
  for (const effect of state.effects) effect.dispose();
  const settled = state.describeCalls;
  state.remoteEvents.get('settings/document-updated')?.();
  await flush();
  assert.equal(state.describeCalls, settled);
});

test('页面通过注入的 hook 取得全局控制器快照', async () => {
  const { ctx, state } = fakeCtx();
  apply(ctx);
  await flush();
  const injected = state.registrations[0].options.inject();
  const snapshot = injected.hooks.snapshot.getSnapshot();
  assert.equal(snapshot.available, true);
  assert.equal(snapshot.configured, true);
  assert.equal(snapshot.draft.maxRetries, 20);
  assert.equal(snapshot.dirty, false);
  assert.equal(snapshot.sync.total, 1);
  assert.equal(snapshot.sync.synced, 1);
  assert.equal(typeof injected.hooks.snapshot.subscribe, 'function');
  assert.equal(typeof injected.controller.actions.save, 'function');
});

test('分区组件渲染 DSH 设计令牌样式与全局表单', async () => {
  const { ctx, state } = fakeCtx();
  apply(ctx);
  await flush();
  const { options, component } = state.registrations[0];
  const injected = options.inject();
  const snapshot = injected.hooks.snapshot.getSnapshot();
  const { container, unmount } = await mount(React.createElement(component, {
    controller: injected.controller,
    t: key => key,
    useSnapshot: selector => selector(snapshot)
  }));
  try {
    const style = container.querySelector('style');
    assert.ok(style !== null, 'section must install its DSH design stylesheet');
    assert.match(style.textContent, /\.drs-form/);
    assert.match(style.textContent, /\.drs-panel/);
    assert.match(style.textContent, /\.drs-segmented/);
    assert.match(style.textContent, /\.drs-chip/);
    assert.match(style.textContent, /\.drs-save/);
    assert.match(style.textContent, /--dsw-alias-label-primary/);
    assert.match(style.textContent, /--dsw-alias-settings-card-fill/);
    assert.match(container.innerHTML, /drs-form/);
    assert.equal(container.querySelector('select'), null);
  } finally {
    await unmount();
  }
});

test('中英文字典随分区注册且键集合一致', async () => {
  const { ctx, state } = fakeCtx();
  apply(ctx);
  assert.equal(state.localeDictionaries.length, 1);
  const [ns, dictionaries] = state.localeDictionaries[0];
  assert.equal(ns, 'dsh-retry-settings');
  assert.deepEqual(Object.keys(dictionaries.en).sort(), Object.keys(dictionaries.zh).sort());
  assert.equal(dictionaries.en.nav, 'Request retries');
  assert.equal(dictionaries.zh.nav, '请求重试');
});
