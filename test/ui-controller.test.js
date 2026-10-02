import test from 'node:test';
import assert from 'node:assert/strict';
import { createRetrySettingsController } from '../src/ui-controller.js';
import { DEFAULT_POLICY, GLOBAL_SETTINGS_NS, normalizePolicy } from '../src/policy.js';

const PI_AI_SCHEMA = {
  type: 'object',
  properties: {
    providers: {
      type: 'object',
      additionalProperties: { type: 'object', properties: { retryPolicy: { type: 'object' } } }
    }
  }
};

const DEEPSEEK_SCHEMA = { type: 'object', properties: { retryPolicy: { type: 'object' } } };

const GLOBAL_SCHEMA = { type: 'object', properties: { policy: { type: 'object' } } };

function namespaceView({ ns, schema, revision = 0, value = {}, user = {} }) {
  return { ns, schema, revision, value, user, autoGenerate: true, applies: 'live', secrets: [] };
}

/** Provider namespace views carrying the retry policy each provider currently stores. */
function providerNamespaces({ cpa, deepseek }) {
  return [
    namespaceView({
      ns: 'llm-pi-ai',
      schema: PI_AI_SCHEMA,
      revision: 3,
      value: { providers: { cpa: cpa === undefined ? {} : { retryPolicy: cpa } } }
    }),
    namespaceView({
      ns: 'llm-deepseek',
      schema: DEEPSEEK_SCHEMA,
      revision: 3,
      value: deepseek === undefined ? {} : { retryPolicy: deepseek }
    })
  ];
}

function directory() {
  return [
    { provider: 'cpa', displayName: 'CPA', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'cpa'] },
    { provider: 'deepseek-official', displayName: 'DeepSeek', settingsNs: 'llm-deepseek', settingsPath: [] }
  ];
}

const GLOBAL_POLICY = {
  mode: 'normal',
  maxRetries: 20,
  retryableCodes: [...DEFAULT_POLICY.retryableCodes],
  backoff: { initialDelayMs: 500, maxDelayMs: 10000, jitterRatio: 0.1 }
};

function deferred() {
  let resolve;
  const promise = new Promise(settle => { resolve = settle; });
  return { promise, resolve };
}

/** Let pending asynchronous controller work settle. */
function flush() {
  return new Promise(resolve => setImmediate(resolve));
}

/**
 * Remote double whose global namespace and provider namespaces answer together.
 * @param initial - global policy/user layer, provider policies, and mutate behaviour.
 * @returns the double with its recorded calls, counts, and mutable server state.
 */
function remote({ policy, userPolicy, cpa, deepseek, overrides, revision = 8, writable = true, serveGlobal = true, mutate } = {}) {
  const calls = [];
  const counts = { describe: 0 };
  const server = { writable, revision, policy, userPolicy, overrides };
  return {
    calls,
    counts,
    server,
    llm: { listConfigurableProviders: async () => ({ ok: true, value: directory() }) },
    settings: {
      describe: async () => {
        counts.describe += 1;
        const namespaces = providerNamespaces({ cpa, deepseek });
        if (serveGlobal) {
          namespaces.unshift(namespaceView({
            ns: GLOBAL_SETTINGS_NS,
            schema: GLOBAL_SCHEMA,
            revision: server.revision,
            value: {
              ...(server.policy === undefined ? {} : { policy: server.policy }),
              ...(server.overrides === undefined ? {} : { providers: server.overrides })
            },
            user: server.userPolicy === undefined ? {} : { policy: server.userPolicy }
          }));
        }
        return { ok: true, value: { writable: server.writable, hasDocument: false, namespaces } };
      },
      mutate: async (ns, ops, expectedRevision) => {
        calls.push([ns, ops, expectedRevision]);
        if (mutate !== undefined) return mutate(ns, ops, expectedRevision, server);
        return { ok: false, error: { code: 'settings/rejected', message: 'unexpected write' } };
      }
    }
  };
}

/** A namespace view as the native service returns it after a successful global write. */
function globalView({ revision, policy, overrides }) {
  return namespaceView({
    ns: GLOBAL_SETTINGS_NS,
    schema: GLOBAL_SCHEMA,
    revision,
    value: {
      ...(policy === undefined ? {} : { policy }),
      ...(overrides === undefined ? {} : { providers: overrides })
    },
    user: policy === undefined ? {} : { policy }
  });
}

async function loaded(fake) {
  const controller = createRetrySettingsController({ remote: fake });
  await controller.load();
  return controller;
}

function allSynced(overrides = {}) {
  return { policy: GLOBAL_POLICY, userPolicy: GLOBAL_POLICY, cpa: GLOBAL_POLICY, deepseek: GLOBAL_POLICY, ...overrides };
}

test('明确放弃外部冲突草稿后，下一次保存采用最新版本号', async () => {
  const fake = remote(allSynced({ mutate: (ns, ops, expectedRevision, server) => {
    assert.equal(expectedRevision, server.revision);
    return { ok: true, value: globalView({ revision: 10, policy: ops[0].value }) };
  } }));
  const controller = await loaded(fake);
  controller.actions.setField('maxRetries', 30);
  fake.server.revision = 9;
  fake.server.policy = normalizePolicy({ mode: 'normal', maxRetries: 40 });
  await controller.refresh();
  assert.equal(controller.store.getSnapshot().revision, 8);
  controller.actions.discard();
  assert.equal(controller.store.getSnapshot().revision, 9);
  assert.equal(controller.store.getSnapshot().draft.maxRetries, 40);
  controller.actions.setField('maxRetries', 41);
  await controller.actions.save();
  assert.equal(fake.calls[0][2], 9);
  assert.equal(controller.store.getSnapshot().failed, false);
  controller.dispose();
});

test('挂载只读取全局与供应商配置，不发出任何写入', async () => {
  const fake = remote(allSynced());
  const controller = await loaded(fake);
  const snapshot = controller.store.getSnapshot();
  assert.deepEqual(fake.calls, []);
  assert.equal(snapshot.status, 'ready');
  assert.equal(snapshot.available, true);
  assert.equal(snapshot.configured, true);
  assert.equal(snapshot.overridden, true);
  assert.equal(snapshot.dirty, false);
  assert.equal(snapshot.draft.maxRetries, 20);
  assert.deepEqual(snapshot.defaultCodes, [...DEFAULT_POLICY.retryableCodes]);
});

test('全局命名空间缺失时不可用且不产生草稿', async () => {
  const fake = remote(allSynced({ serveGlobal: false }));
  const controller = await loaded(fake);
  const snapshot = controller.store.getSnapshot();
  assert.equal(snapshot.available, false);
  assert.equal(snapshot.draft, null);
  assert.equal(snapshot.notice.kind, 'unavailable');
  assert.deepEqual(fake.calls, []);
});

test('未配置全局策略时使用原生默认草稿并标记未配置', async () => {
  const fake = remote({ cpa: { mode: 'normal', maxRetries: 9 } });
  const controller = await loaded(fake);
  const snapshot = controller.store.getSnapshot();
  assert.equal(snapshot.configured, false);
  assert.equal(snapshot.overridden, false);
  assert.equal(snapshot.notice.kind, 'unconfigured');
  assert.equal(snapshot.draft.maxRetries, DEFAULT_POLICY.maxRetries);
  assert.equal(snapshot.sync.synced, 0);
  assert.equal(snapshot.sync.total, 2);
  assert.equal(snapshot.sync.pending.length, 2);
});

test('保存只写全局 policy 路径并携带读取到的 revision', async () => {
  const fake = remote(allSynced({
    mutate: () => ({ ok: true, value: globalView({ revision: 9, policy: { mode: 'normal', maxRetries: 30 } }) })
  }));
  const controller = await loaded(fake);
  controller.actions.setField('maxRetries', 30);
  await controller.actions.save();
  assert.equal(fake.calls.length, 1);
  const [ns, ops, revision] = fake.calls[0];
  assert.equal(ns, GLOBAL_SETTINGS_NS);
  assert.equal(revision, 8);
  assert.deepEqual(ops, [{
    op: 'set',
    path: ['policy'],
    value: normalizePolicy({
      mode: 'normal',
      maxRetries: 30,
      retryableCodes: [...DEFAULT_POLICY.retryableCodes],
      backoff: { initialDelayMs: 500, maxDelayMs: 10000, jitterRatio: 0.1 }
    })
  }]);
});

test('保存成功后采纳服务器策略与 revision 并清除失败标记', async () => {
  const fake = remote(allSynced({
    mutate: () => ({ ok: true, value: globalView({ revision: 9, policy: { mode: 'normal', maxRetries: 30 } }) })
  }));
  const controller = await loaded(fake);
  controller.actions.setField('maxRetries', 30);
  await controller.actions.save();
  const snapshot = controller.store.getSnapshot();
  assert.equal(snapshot.dirty, false);
  assert.equal(snapshot.failed, false);
  assert.equal(snapshot.saving, false);
  assert.equal(snapshot.notice.kind, 'saved');
  assert.equal(snapshot.revision, 9);
  assert.equal(snapshot.draft.maxRetries, 30);
});

test('恢复继承发送 unset 全局 policy 操作', async () => {
  const fake = remote(allSynced({
    mutate: (ns, ops) => {
      assert.deepEqual(ops, [{ op: 'unset', path: ['policy'] }]);
      return { ok: true, value: globalView({ revision: 10, policy: undefined }) };
    }
  }));
  const controller = await loaded(fake);
  await controller.actions.restoreInherited();
  const snapshot = controller.store.getSnapshot();
  assert.equal(snapshot.overridden, false);
  assert.equal(snapshot.configured, false);
  assert.equal(snapshot.draft.maxRetries, DEFAULT_POLICY.maxRetries);
});

test('清空的数字输入被判非法且不写入', async () => {
  const fake = remote(allSynced());
  const controller = await loaded(fake);
  controller.actions.setField('maxRetries', null);
  await controller.actions.save();
  assert.deepEqual(fake.calls, []);
  const snapshot = controller.store.getSnapshot();
  assert.equal(snapshot.notice.kind, 'invalid');
  assert.match(snapshot.fieldErrors.maxRetries, /required/);
  assert.equal(snapshot.dirty, true);
});

test('冲突时保留草稿、标记失败并保持原 revision', async () => {
  const fake = remote(allSynced({
    mutate: () => ({ ok: false, error: { code: 'settings/conflict', message: '设置已被其他窗口或外部文件修改，未保存。' } })
  }));
  const controller = await loaded(fake);
  controller.actions.setField('maxRetries', 30);
  await controller.actions.save();
  const snapshot = controller.store.getSnapshot();
  assert.equal(snapshot.notice.kind, 'conflict');
  assert.equal(snapshot.failed, true);
  assert.equal(snapshot.dirty, true);
  assert.equal(snapshot.draft.maxRetries, 30);
  assert.equal(snapshot.revision, 8);
});

test('读取失败保留可编辑状态与草稿', async () => {
  const fake = remote(allSynced());
  const controller = await loaded(fake);
  controller.actions.setField('maxRetries', 30);
  fake.settings.describe = async () => ({ ok: false, error: { code: 'settings/failed', message: 'describe failed' } });
  await controller.refresh();
  const snapshot = controller.store.getSnapshot();
  assert.equal(snapshot.status, 'ready');
  assert.match(snapshot.error, /describe failed/);
  assert.equal(snapshot.draft.maxRetries, 30);
  assert.equal(snapshot.dirty, true);
});

test('外部变更后的脏草稿仍用原始 revision 保存并被服务器拒绝', async () => {
  const fake = remote(allSynced({
    mutate: (ns, ops, revision, server) => revision === server.revision
      ? { ok: true, value: globalView({ revision: revision + 1, policy: GLOBAL_POLICY }) }
      : { ok: false, error: { code: 'settings/conflict', message: '设置已被其他窗口或外部文件修改，未保存。' } }
  }));
  const controller = await loaded(fake);
  controller.actions.setField('maxRetries', 30);
  fake.server.revision = 12;
  fake.server.policy = { mode: 'normal', maxRetries: 40 };
  fake.server.userPolicy = { mode: 'normal', maxRetries: 40 };
  await controller.refresh();
  fake.calls.length = 0;
  await controller.actions.save();
  assert.equal(fake.calls[0][2], 8);
  const snapshot = controller.store.getSnapshot();
  assert.equal(snapshot.notice.kind, 'conflict');
  assert.equal(snapshot.draft.maxRetries, 30);
});

test('保存进行中拒绝二次提交、编辑与放弃', async () => {
  const gate = deferred();
  const fake = remote(allSynced({ mutate: () => gate.promise }));
  const controller = await loaded(fake);
  controller.actions.setField('maxRetries', 30);
  const first = controller.actions.save();
  assert.equal(controller.store.getSnapshot().saving, true);
  const writes = fake.calls.length;
  await controller.actions.save();
  controller.actions.setField('maxRetries', 99);
  controller.actions.discard();
  assert.equal(fake.calls.length, writes);
  assert.equal(controller.store.getSnapshot().draft.maxRetries, 30);
  gate.resolve({ ok: true, value: globalView({ revision: 9, policy: { mode: 'normal', maxRetries: 30 } }) });
  await first;
  const snapshot = controller.store.getSnapshot();
  assert.equal(snapshot.saving, false);
  assert.equal(snapshot.dirty, false);
});

test('保存期间收到的变更事件在保存结束后补一次读取', async () => {
  const gate = deferred();
  const fake = remote(allSynced({ mutate: () => gate.promise }));
  const controller = await loaded(fake);
  controller.actions.setField('maxRetries', 30);
  const saving = controller.actions.save();
  const before = fake.counts.describe;
  controller.refresh();
  assert.equal(fake.counts.describe, before);
  gate.resolve({ ok: true, value: globalView({ revision: 9, policy: { mode: 'normal', maxRetries: 30 } }) });
  await saving;
  await flush();
  await flush();
  assert.equal(fake.counts.describe, before + 1);
});

test('dispose 后迟到的读取结果不覆盖状态', async () => {
  const gate = deferred();
  const fake = remote(allSynced());
  const controller = createRetrySettingsController({ remote: fake });
  fake.settings.describe = () => gate.promise;
  const loading = controller.load();
  controller.dispose();
  gate.resolve({
    ok: true,
    value: { writable: true, hasDocument: false, namespaces: [globalView({ revision: 1, policy: GLOBAL_POLICY })] }
  });
  await loading;
  const snapshot = controller.store.getSnapshot();
  assert.equal(snapshot.draft, null);
  assert.equal(snapshot.revision, null);
});

test('订阅在状态变化时通知，取消订阅后停止', async () => {
  const fake = remote(allSynced());
  const controller = await loaded(fake);
  let notifications = 0;
  const unsubscribe = controller.store.subscribe(() => { notifications += 1; });
  controller.actions.setField('maxRetries', 30);
  assert.ok(notifications > 0);
  const seen = notifications;
  unsubscribe();
  controller.actions.setField('maxRetries', 31);
  assert.equal(notifications, seen);
});

test('同步摘要来自共享实现：策略一致的供应商计入已同步', async () => {
  const fake = remote(allSynced());
  const controller = await loaded(fake);
  const snapshot = controller.store.getSnapshot();
  assert.equal(snapshot.sync.total, 2);
  assert.equal(snapshot.sync.synced, 2);
  assert.deepEqual(snapshot.sync.pending, []);
});

test('同步摘要报告策略不一致的供应商', async () => {
  const different = {
    mode: 'normal',
    maxRetries: 3,
    retryableCodes: [...DEFAULT_POLICY.retryableCodes],
    backoff: { initialDelayMs: 500, maxDelayMs: 10000, jitterRatio: 0.1 }
  };
  const fake = remote(allSynced({ cpa: different }));
  const controller = await loaded(fake);
  const snapshot = controller.store.getSnapshot();
  assert.equal(snapshot.sync.total, 2);
  assert.equal(snapshot.sync.synced, 1);
  assert.equal(snapshot.sync.pending.length, 1);
  assert.equal(snapshot.sync.pending[0].provider, 'cpa');
});

test('错误码顺序不同的等值策略不误报脏', async () => {
  const reordered = {
    mode: 'normal',
    maxRetries: GLOBAL_POLICY.maxRetries,
    retryableCodes: [...GLOBAL_POLICY.retryableCodes].reverse(),
    backoff: { ...GLOBAL_POLICY.backoff }
  };
  const fake = remote(allSynced({ policy: reordered, userPolicy: reordered }));
  const controller = await loaded(fake);
  assert.equal(controller.store.getSnapshot().dirty, false);
});

test('always 模式下保存只写 mode 与 backoff', async () => {
  const fake = remote(allSynced({
    mutate: () => ({ ok: true, value: globalView({ revision: 9, policy: { mode: 'always' } }) })
  }));
  const controller = await loaded(fake);
  controller.actions.setField('mode', 'always');
  await controller.actions.save();
  const ops = fake.calls[0][1];
  assert.deepEqual(ops[0].path, ['policy']);
  assert.equal(ops[0].value.mode, 'always');
  assert.equal('maxRetries' in ops[0].value, false);
  assert.equal('retryableCodes' in ops[0].value, false);
});

test('放弃修改回到服务器状态', async () => {
  const fake = remote(allSynced());
  const controller = await loaded(fake);
  controller.actions.setField('maxRetries', 30);
  controller.actions.toggleCode('RATE_LIMIT', false);
  assert.equal(controller.store.getSnapshot().dirty, true);
  controller.actions.discard();
  const snapshot = controller.store.getSnapshot();
  assert.equal(snapshot.dirty, false);
  assert.equal(snapshot.draft.maxRetries, GLOBAL_POLICY.maxRetries);
  assert.deepEqual(snapshot.draft.retryableCodes, [...DEFAULT_POLICY.retryableCodes]);
});

test('只读部署下保存与恢复继承都不写入', async () => {
  const fake = remote(allSynced({ writable: false }));
  const controller = await loaded(fake);
  assert.equal(controller.store.getSnapshot().writable, false);
  controller.actions.setField('maxRetries', 30);
  await controller.actions.save();
  await controller.actions.restoreInherited();
  assert.deepEqual(fake.calls, []);
});

test('选择供应商后用全局有效策略初始化覆盖草稿', async () => {
  const fake = remote(allSynced());
  const controller = await loaded(fake);
  controller.actions.selectProvider('cpa');
  const snapshot = controller.store.getSnapshot();
  assert.equal(snapshot.selectedProvider, 'cpa');
  assert.equal(snapshot.providerConfigured, false);
  assert.equal(snapshot.providerDraft.maxRetries, GLOBAL_POLICY.maxRetries);
  assert.equal(snapshot.providerDirty, false);
});

test('保存供应商覆盖只写 providers.<id> 路径并带上当前 revision', async () => {
  const fake = remote(allSynced({
    mutate: (ns, ops, expectedRevision) => {
      assert.equal(expectedRevision, 8);
      return { ok: true, value: globalView({ revision: 9, policy: GLOBAL_POLICY, overrides: { cpa: ops[0].value } }) };
    }
  }));
  const controller = await loaded(fake);
  controller.actions.selectProvider('cpa');
  controller.actions.setProviderField('maxRetries', 7);
  await controller.actions.saveProviderOverride();
  const [ns, ops, expectedRevision] = fake.calls[0];
  assert.equal(ns, GLOBAL_SETTINGS_NS);
  assert.deepEqual(ops[0].path, ['providers', 'cpa']);
  assert.equal(ops[0].value.maxRetries, 7);
  assert.equal(expectedRevision, 8);
  const snapshot = controller.store.getSnapshot();
  assert.equal(snapshot.providerConfigured, true);
  assert.equal(snapshot.providerDirty, false);
  assert.equal(snapshot.providers.find(row => row.provider === 'cpa').hasOverride, true);
});

test('恢复跟随全局发送 providers.<id> unset 操作', async () => {
  const override = { ...GLOBAL_POLICY, maxRetries: 7 };
  const fake = remote(allSynced({
    overrides: { cpa: override },
    mutate: (ns, ops, expectedRevision) => {
      assert.equal(expectedRevision, 8);
      return { ok: true, value: globalView({ revision: 9, policy: GLOBAL_POLICY }) };
    }
  }));
  const controller = await loaded(fake);
  controller.actions.selectProvider('cpa');
  assert.equal(controller.store.getSnapshot().providerConfigured, true);
  await controller.actions.restoreProviderInherited();
  const [ns, ops] = fake.calls[0];
  assert.equal(ns, GLOBAL_SETTINGS_NS);
  assert.deepEqual(ops[0], { op: 'unset', path: ['providers', 'cpa'] });
});
