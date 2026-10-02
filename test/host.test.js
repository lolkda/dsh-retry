import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

import { apply as applyHost, Config, inject, name } from '../src/host.js';
import { GLOBAL_SETTINGS_NS } from '../src/policy.js';

/**
 * The installed Harness owns the tool-definition subset this plugin must satisfy.
 * Resolving it here keeps the check honest without hardcoding it in production code.
 */
const runtimeRequire = createRequire('/usr/local/lib/node_modules/@deepseek-ai/dsh/package.json');
const { assertSupportedJsonSchema, assertObjectJsonSchema } = runtimeRequire('@deepseek-ai/dsh-tools');

const DEFAULT_CODES = ['EMPTY_RESPONSE', 'RATE_LIMIT', 'SERVER', 'TIMEOUT', 'TRANSPORT'];
const DESIRED = { mode: 'normal', maxRetries: 20, retryableCodes: DEFAULT_CODES, backoff: { initialDelayMs: 500, maxDelayMs: 10000, jitterRatio: 0.1 } };
const GLOBAL_POLICY_PATH = ['policy'];

const WIRE_DICT = {
  uid: 1,
  refs: {
    1: { type: 'object', dict: { providers: 2 }, meta: { default: {} } },
    2: { type: 'dict', inner: 3, meta: { default: {} } },
    3: { type: 'object', dict: { retryPolicy: 4 }, meta: { default: {} } },
    4: { type: 'union', list: [5, 6], meta: {} },
    5: { type: 'object', dict: { mode: 7 }, meta: {} },
    6: { type: 'object', dict: { mode: 8 }, meta: {} },
    7: { type: 'const', value: 'normal' },
    8: { type: 'const', value: 'always' },
  },
};

const WIRE_SECTION = {
  uid: 1,
  refs: {
    1: { type: 'object', dict: { retryPolicy: 2 }, meta: { default: {} } },
    2: { type: 'union', list: [3, 4], meta: {} },
    3: { type: 'object', dict: { mode: 5 }, meta: {} },
    4: { type: 'object', dict: { mode: 6 }, meta: {} },
    5: { type: 'const', value: 'normal' },
    6: { type: 'const', value: 'always' },
  },
};

/** The plugin's own Config form schema already carries a volatile `policy` field. */
const WIRE_GLOBAL = {
  uid: 1,
  refs: {
    1: { type: 'object', dict: { policy: 2 }, meta: {} },
    2: { type: 'union', list: [3, 4], meta: {} },
    3: { type: 'object', dict: { mode: 5 }, meta: {} },
    4: { type: 'object', dict: { mode: 6 }, meta: {} },
    5: { type: 'const', value: 'normal' },
    6: { type: 'const', value: 'always' },
  },
};

const DIRECTORY = [
  { provider: 'cpa', displayName: 'CPA', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'cpa'] },
  { provider: 'openai', displayName: 'OpenAI', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'openai'] },
  { provider: 'deepseek-official', displayName: 'DeepSeek', settingsNs: 'llm-deepseek', settingsPath: [] },
];

function settingsError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function setAtPath(target, path, value) {
  let node = target;
  for (const key of path.slice(0, -1)) {
    if (typeof node[key] !== 'object' || node[key] === null) node[key] = {};
    node = node[key];
  }
  node[path.at(-1)] = value;
}

function unsetAtPath(target, path) {
  let node = target;
  for (const key of path.slice(0, -1)) {
    if (typeof node[key] !== 'object' || node[key] === null) return;
    node = node[key];
  }
  delete node[path.at(-1)];
}

function namespaceView(ns, schema, value = {}, revision = 0) {
  return { ns, schema, value: structuredClone(value), user: {}, base: {}, revision, applies: 'live', autoGenerate: true };
}

function createStore({ globalPolicy, globalRevision = 0, writable = true, globalNamespace = true } = {}) {
  const namespaces = [
    namespaceView('llm-pi-ai', WIRE_DICT, { providers: { cpa: { baseURL: 'https://cpa.example/v1' }, openai: {} } }, 4),
    namespaceView('llm-deepseek', WIRE_SECTION, {}, 2),
  ];
  if (globalNamespace) {
    namespaces.push(namespaceView(GLOBAL_SETTINGS_NS, WIRE_GLOBAL, globalPolicy === undefined ? {} : { policy: globalPolicy }, globalRevision));
  }

  const state = new Map(namespaces.map((view) => [view.ns, view]));
  const mutateCalls = [];
  const describeCalls = [];
  let forcedFailure;

  /**
   * Stands in for the Loader's in-place volatile update: the plugin's live Config
   * field reflects whatever the global namespace currently stores.
   */
  const policyHandle = {
    get() {
      const view = state.get(GLOBAL_SETTINGS_NS);
      return view === undefined ? undefined : view.value.policy;
    },
  };

  const providersHandle = {
    get() {
      const view = state.get(GLOBAL_SETTINGS_NS);
      return view === undefined ? {} : (view.value.providers ?? {});
    },
  };

  return {
    state,
    mutateCalls,
    describeCalls,
    policyHandle,
    providersHandle,
    directory: structuredClone(DIRECTORY),
    failNext(error) { forcedFailure = error; },
    controller: {
      async describe() {
        describeCalls.push(true);
        return { writable, hasDocument: true, namespaces: [...state.values()].map((view) => structuredClone(view)) };
      },
      async mutate(ns, ops, expectedRevision) {
        mutateCalls.push({ ns, ops, expectedRevision });
        if (forcedFailure !== undefined) {
          const error = forcedFailure;
          forcedFailure = undefined;
          throw error;
        }
        const view = state.get(ns);
        if (view === undefined) throw settingsError('settings/rejected', `unknown namespace ${ns}`);
        if (expectedRevision !== view.revision) {
          throw settingsError('settings/conflict', `settings namespace "${ns}" changed since it was read (expected revision ${expectedRevision}, now ${view.revision})`);
        }
        for (const op of ops) {
          if (op.op === 'set') {
            setAtPath(view.value, op.path, op.value);
            setAtPath(view.user, op.path, op.value);
          } else {
            unsetAtPath(view.value, op.path);
            unsetAtPath(view.user, op.path);
          }
        }
        view.revision += 1;
        return structuredClone(view);
      },
    },
    llm: {
      directory: structuredClone(DIRECTORY),
      async listConfigurableProviders() { return this.directory; },
    },
  };
}

function createContext(store, options = {}) {
  const { sandboxMode = 'danger-full-access', agentPlanMode, withAgentPresets = true, withSandboxPolicy = true } = options;
  const registered = new Map();
  const listeners = new Map();
  const serviceForCalls = [];
  const planModeService = agentPlanMode === undefined ? undefined : { get: () => ({ active: agentPlanMode.active }) };

  const ctx = {
    tools: {
      register(definition) {
        registered.set(definition.name, definition);
        return () => registered.delete(definition.name);
      },
    },
    llm: store.llm,
    settingsController: store.controller,
    get(serviceName) {
      if (serviceName === 'tools') return this.tools;
      if (serviceName === 'llm') return store.llm;
      if (serviceName === 'settingsController') return store.controller;
      if (serviceName === 'agentPresets') {
        if (!withAgentPresets) return undefined;
        return { serviceFor(agent, requested) { serviceForCalls.push({ agent, name: requested }); return planModeService; } };
      }
      if (serviceName === 'sandboxPolicy') {
        return withSandboxPolicy ? { resolve: () => ({ mode: sandboxMode, workspaceRoot: '/workspace' }) } : undefined;
      }
      return undefined;
    },
    inject(dependencies, callback) {
      for (const dependency of dependencies) if (this.get(dependency) === undefined) return () => {};
      return callback(this);
    },
    effect(callback) {
      const dispose = callback();
      return typeof dispose === 'function' ? dispose : () => {};
    },
    on(eventName, listener) {
      if (!listeners.has(eventName)) listeners.set(eventName, []);
      listeners.get(eventName).push(listener);
      return () => {
        const list = listeners.get(eventName) ?? [];
        const index = list.indexOf(listener);
        if (index >= 0) list.splice(index, 1);
      };
    },
  };

  return { ctx, registered, listeners, serviceForCalls, store };
}

function toolOf(harness) {
  const definition = harness.registered.get('retry_policy');
  assert.ok(definition, 'the retry_policy tool must be registered');
  return definition;
}

function agentExec(overrides = {}) {
  return { agent: { id: 'session-1', session: { id: 'session-1' } }, signal: new AbortController().signal, ...overrides };
}

function call(harness, args, exec = agentExec()) {
  return toolOf(harness).execute(args, exec);
}

async function flush(times = 6) {
  for (let index = 0; index < times; index += 1) await new Promise((resolve) => setTimeout(resolve, 0));
}

// ---------------------------------------------------------------------------
// registration and Config
// ---------------------------------------------------------------------------

test('the host plugin exports its name, inject list, and a schemastery Config', () => {
  assert.equal(name, 'dsh-retry-settings');
  assert.deepEqual(inject, ['tools']);
  const wire = Config.toJSON();
  const root = wire.refs[wire.uid];
  assert.equal(typeof root.dict?.policy, 'number');
  const policyNode = wire.refs[root.dict.policy];
  assert.equal(policyNode.meta?.volatile, true);
  assert.equal(policyNode.meta?.required, undefined, 'the global policy must stay optional');
});

test('apply registers one retry_policy tool and subscribes to settings and provider changes', () => {
  const store = createStore();
  const harness = createContext(store);
  applyHost(harness.ctx, { policy: store.policyHandle });
  assert.deepEqual([...harness.registered.keys()], ['retry_policy']);
  assert.deepEqual([...harness.listeners.keys()].sort(), ['llm/adapters-updated', 'settings/document-updated']);
});

test('the registered tool satisfies the installed runtime schema subset', () => {
  const store = createStore();
  const harness = createContext(store);
  applyHost(harness.ctx, { policy: store.policyHandle });
  const definition = toolOf(harness);
  assert.doesNotThrow(() => assertObjectJsonSchema(definition.parameters));
  assert.doesNotThrow(() => assertSupportedJsonSchema(definition.output.schema));
  assert.equal(typeof definition.parameters.properties.provider?.type, 'string', 'the tool must accept an optional provider argument');
  assert.match(definition.description, /per-provider overrides/i);
});

test('an unconfigured plugin writes nothing at mount', async () => {
  const store = createStore();
  const harness = createContext(store);
  applyHost(harness.ctx, { policy: store.policyHandle });
  await flush();
  assert.deepEqual(store.mutateCalls, []);
  assert.deepEqual(store.describeCalls, [], 'an unconfigured plugin must not even read settings');
});

test('a configured plugin applies the policy to every provider at mount', async () => {
  const store = createStore({ globalPolicy: DESIRED, globalRevision: 1 });
  const harness = createContext(store);
  applyHost(harness.ctx, { policy: store.policyHandle });
  await flush();
  assert.deepEqual(store.mutateCalls.map((entry) => entry.ns), ['llm-pi-ai', 'llm-deepseek']);
  assert.deepEqual(store.state.get('llm-pi-ai').value.providers.cpa.retryPolicy, DESIRED);
});

test('a raw config value is read as the desired policy too', async () => {
  const store = createStore();
  const harness = createContext(store);
  applyHost(harness.ctx, { policy: DESIRED });
  await flush();
  assert.deepEqual(store.mutateCalls.map((entry) => entry.ns), ['llm-pi-ai', 'llm-deepseek']);
});

// ---------------------------------------------------------------------------
// read actions
// ---------------------------------------------------------------------------

test('list reports the global policy, its revision, and the provider sync summary', async () => {
  const store = createStore({ globalPolicy: DESIRED, globalRevision: 6 });
  const harness = createContext(store);
  applyHost(harness.ctx, { policy: store.policyHandle });
  await flush();
  const result = await call(harness, { action: 'list' });
  assert.equal(result.action, 'list');
  assert.equal(result.configured, true);
  assert.equal(result.writable, true);
  assert.equal(result.revision, 6);
  assert.deepEqual(result.policy, DESIRED);
  assert.equal(result.total, 3);
  assert.equal(result.synced, 3);
  assert.deepEqual(result.pending, []);
});

test('list reports an unconfigured policy without claiming providers are in sync', async () => {
  const store = createStore();
  const harness = createContext(store);
  applyHost(harness.ctx, { policy: store.policyHandle });
  const result = await call(harness, { action: 'list' });
  assert.equal(result.configured, false);
  assert.equal(result.synced, 0);
  assert.deepEqual(result.pending.map((entry) => entry.provider), ['cpa', 'openai', 'deepseek-official']);
  assert.match(result.pending[0].reason, /no global policy/i);
});

// ---------------------------------------------------------------------------
// set / reset
// ---------------------------------------------------------------------------

test('set writes only the global policy path and applies it to every provider', async () => {
  const store = createStore({ globalRevision: 3 });
  const harness = createContext(store);
  applyHost(harness.ctx, { policy: store.policyHandle });
  const result = await call(harness, { action: 'set', expectedRevision: 3, policy: { mode: 'normal', maxRetries: 20, backoff: { initialDelayMs: 500, maxDelayMs: 10000, jitterRatio: 0.1 } } });
  const globalWrite = store.mutateCalls.find((entry) => entry.ns === GLOBAL_SETTINGS_NS);
  assert.deepEqual(globalWrite.ops, [{ op: 'set', path: GLOBAL_POLICY_PATH, value: DESIRED }]);
  assert.equal(globalWrite.expectedRevision, 3);
  assert.deepEqual(store.state.get('llm-pi-ai').value.providers.cpa.retryPolicy, DESIRED);
  assert.deepEqual(store.state.get('llm-deepseek').value.retryPolicy, DESIRED);
  assert.equal(result.configured, true);
  assert.equal(result.revision, 4);
  assert.equal(result.applied.written, 3);
  assert.deepEqual(result.pending, []);
});

test('reset unsets only the global policy path and never reverts provider values', async () => {
  const store = createStore({ globalPolicy: DESIRED, globalRevision: 7 });
  const harness = createContext(store);
  applyHost(harness.ctx, { policy: store.policyHandle });
  await flush();
  const afterMount = store.mutateCalls.length;
  const result = await call(harness, { action: 'reset', expectedRevision: 7 });
  const globalWrite = store.mutateCalls.find((entry) => entry.ns === GLOBAL_SETTINGS_NS);
  assert.deepEqual(globalWrite.ops, [{ op: 'unset', path: GLOBAL_POLICY_PATH }]);
  assert.equal(result.configured, false);
  assert.equal(store.mutateCalls.length, afterMount + 1, 'reset itself writes only the global policy');
  assert.deepEqual(store.state.get('llm-pi-ai').value.providers.cpa.retryPolicy, DESIRED);
});

test('set reports the namespaces it applied', async () => {
  const store = createStore({ globalRevision: 1 });
  const harness = createContext(store);
  applyHost(harness.ctx, { policy: store.policyHandle });
  const result = await call(harness, { action: 'set', expectedRevision: 1, policy: DESIRED });
  assert.deepEqual(result.applied.namespaces.map((entry) => entry.ns), ['llm-pi-ai', 'llm-deepseek']);
  assert.equal(result.applied.namespaces.every((entry) => entry.status === 'applied'), true);
});

test('a partially failing sync is reported while the successful namespace is retained', async () => {
  const store = createStore({ globalRevision: 1 });
  const harness = createContext(store);
  applyHost(harness.ctx, { policy: store.policyHandle });
  const original = store.controller.mutate;
  let firstProviderWrite = true;
  store.controller.mutate = async (ns, ops, expectedRevision) => {
    if (ns === 'llm-deepseek' && firstProviderWrite) {
      firstProviderWrite = false;
      store.mutateCalls.push({ ns, ops, expectedRevision });
      throw settingsError('settings/rejected', 'Config field "retryPolicy" is not volatile');
    }
    return original.call(store.controller, ns, ops, expectedRevision);
  };
  const result = await call(harness, { action: 'set', expectedRevision: 1, policy: DESIRED });
  assert.deepEqual(store.state.get('llm-pi-ai').value.providers.cpa.retryPolicy, DESIRED);
  const failed = result.applied.namespaces.find((entry) => entry.ns === 'llm-deepseek');
  assert.equal(failed.status, 'failed');
  assert.match(failed.error, /not volatile/);
  assert.deepEqual(result.pending.map((entry) => entry.provider), ['deepseek-official']);
});

test('set refuses a missing policy and a policy without mode', async () => {
  const store = createStore({ globalRevision: 0 });
  const harness = createContext(store);
  applyHost(harness.ctx, { policy: store.policyHandle });
  await assert.rejects(() => call(harness, { action: 'set', expectedRevision: 0 }), /set requires an explicit policy/i);
  await assert.rejects(() => call(harness, { action: 'set', expectedRevision: 0, policy: { maxRetries: 4 } }), /mode/);
  await assert.rejects(() => call(harness, { action: 'set', expectedRevision: 0, policy: { mode: 'normal', maxRetries: -1 } }), /maxRetries/);
  assert.deepEqual(store.mutateCalls, []);
});

test('set and reset refuse a missing or invalid expectedRevision', async () => {
  const store = createStore({ globalRevision: 0 });
  const harness = createContext(store);
  applyHost(harness.ctx, { policy: store.policyHandle });
  for (const expectedRevision of [undefined, null, -1, 1.5, '3']) {
    await assert.rejects(() => call(harness, { action: 'set', expectedRevision, policy: DESIRED }), /expectedRevision/);
    await assert.rejects(() => call(harness, { action: 'reset', expectedRevision }), /expectedRevision/);
  }
  assert.deepEqual(store.mutateCalls, []);
});

test('the tool sets and resets one provider override through the plugin namespace', async () => {
  const store = createStore({ globalPolicy: DESIRED, globalRevision: 1 });
  const harness = createContext(store);
  applyHost(harness.ctx, { policy: store.policyHandle, providers: store.providersHandle });
  await flush();

  const override = { ...DESIRED, maxRetries: 7 };
  const result = await call(harness, { action: 'set', provider: 'cpa', expectedRevision: 1, policy: override });
  assert.equal(result.providers.find((row) => row.provider === 'cpa').override, true);
  assert.equal(store.state.get(GLOBAL_SETTINGS_NS).value.providers.cpa.maxRetries, 7);

  await call(harness, { action: 'reset', provider: 'cpa', expectedRevision: 2 });
  assert.equal(store.state.get(GLOBAL_SETTINGS_NS).value.providers.cpa, undefined);
  const pluginWrite = store.mutateCalls.find((call) => call.ns === GLOBAL_SETTINGS_NS);
  assert.equal(pluginWrite.ops[0].path.join('.'), 'providers.cpa');
});

test('a stale global revision is refused without a silent overwrite', async () => {
  const store = createStore({ globalRevision: 5 });
  const harness = createContext(store);
  applyHost(harness.ctx, { policy: store.policyHandle });
  await assert.rejects(
    () => call(harness, { action: 'set', expectedRevision: 4, policy: DESIRED }),
    /changed since revision 4/i,
  );
  assert.equal(store.state.get(GLOBAL_SETTINGS_NS).value.policy, undefined);
});

// ---------------------------------------------------------------------------
// permission guards
// ---------------------------------------------------------------------------

test('set refuses against a read-only settings document', async () => {
  const store = createStore({ writable: false, globalRevision: 0 });
  const harness = createContext(store);
  applyHost(harness.ctx, { policy: store.policyHandle });
  await assert.rejects(() => call(harness, { action: 'set', expectedRevision: 0, policy: DESIRED }), /read-only/i);
  assert.deepEqual(store.mutateCalls, []);
});

test('set refuses in a read-only session even when the deployment is writable', async () => {
  const store = createStore({ writable: true, globalRevision: 0 });
  const harness = createContext(store, { sandboxMode: 'read-only' });
  applyHost(harness.ctx, { policy: store.policyHandle });
  await assert.rejects(() => call(harness, { action: 'set', expectedRevision: 0, policy: DESIRED }), /read-only/i);
  assert.deepEqual(store.mutateCalls, []);
});

test('set refuses while plan mode is active, resolved through the agent preset mount', async () => {
  const store = createStore({ globalRevision: 0 });
  const harness = createContext(store, { agentPlanMode: { active: true } });
  applyHost(harness.ctx, { policy: store.policyHandle });
  await assert.rejects(() => call(harness, { action: 'set', expectedRevision: 0, policy: DESIRED }), /plan mode/i);
  assert.equal(harness.serviceForCalls[0].name, 'planMode');
  assert.deepEqual(store.mutateCalls, []);
});

test('an agent whose preset mounts no plan mode is not blocked', async () => {
  const store = createStore({ globalRevision: 0 });
  const harness = createContext(store, { agentPlanMode: undefined });
  applyHost(harness.ctx, { policy: store.policyHandle });
  await call(harness, { action: 'set', expectedRevision: 0, policy: DESIRED });
  assert.ok(store.mutateCalls.some((entry) => entry.ns === GLOBAL_SETTINGS_NS));
});

test('set refuses without a calling agent', async () => {
  const store = createStore({ globalRevision: 0 });
  const harness = createContext(store);
  applyHost(harness.ctx, { policy: store.policyHandle });
  await assert.rejects(
    () => call(harness, { action: 'set', expectedRevision: 0, policy: DESIRED }, { signal: new AbortController().signal }),
    /agent/i,
  );
  assert.deepEqual(store.mutateCalls, []);
});

test('a cancelled call writes nothing, while a cancelled read still reports', async () => {
  const store = createStore({ globalRevision: 0 });
  const harness = createContext(store);
  applyHost(harness.ctx, { policy: store.policyHandle });
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    () => call(harness, { action: 'set', expectedRevision: 0, policy: DESIRED }, agentExec({ signal: controller.signal })),
    /cancel/i,
  );
  assert.deepEqual(store.mutateCalls, []);
  const result = await call(harness, { action: 'list' }, agentExec({ signal: controller.signal }));
  assert.equal(result.action, 'list');
});

test('set refuses when the plugin namespace is unavailable', async () => {
  const store = createStore({ globalNamespace: false });
  const harness = createContext(store);
  applyHost(harness.ctx, { policy: store.policyHandle });
  await assert.rejects(
    () => call(harness, { action: 'set', expectedRevision: 0, policy: DESIRED }),
    /namespace is unavailable/i,
  );
  assert.deepEqual(store.mutateCalls, []);
});

// ---------------------------------------------------------------------------
// rendering
// ---------------------------------------------------------------------------

test('render describes the global policy and the sync outcome', async () => {
  const store = createStore({ globalPolicy: DESIRED, globalRevision: 6 });
  const harness = createContext(store);
  applyHost(harness.ctx, { policy: store.policyHandle });
  await flush();
  const definition = toolOf(harness);
  const value = await definition.execute({ action: 'list' }, agentExec());
  const blocks = definition.output.render({ action: 'list' }, value);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].type, 'text');
  assert.match(blocks[0].text, /maxRetries 20/);
  assert.match(blocks[0].text, /Providers in sync: 3\/3/);
});

test('render says so when no global policy is configured', async () => {
  const store = createStore();
  const harness = createContext(store);
  applyHost(harness.ctx, { policy: store.policyHandle });
  const definition = toolOf(harness);
  const value = await definition.execute({ action: 'list' }, agentExec());
  const blocks = definition.output.render({ action: 'list' }, value);
  assert.match(blocks[0].text, /No global retry policy is configured/);
});

test('render exposes the global revision that the next write must quote', async () => {
  const store = createStore({ globalPolicy: DESIRED, globalRevision: 6 });
  const harness = createContext(store);
  applyHost(harness.ctx, { policy: store.policyHandle });
  await flush();
  const definition = toolOf(harness);
  for (const action of ['list', 'get']) {
    const value = await definition.execute({ action }, agentExec());
    assert.equal(value.revision, 6);
    const blocks = definition.output.render({ action }, value);
    assert.match(blocks[0].text, /Global settings revision: 6/, `the ${action} text must carry the revision`);
  }
});

test('render exposes the revision even while no global policy is configured', async () => {
  const store = createStore({ globalRevision: 0 });
  const harness = createContext(store);
  applyHost(harness.ctx, { policy: store.policyHandle });
  const definition = toolOf(harness);
  const value = await definition.execute({ action: 'get' }, agentExec());
  const blocks = definition.output.render({ action: 'get' }, value);
  assert.match(blocks[0].text, /No global retry policy is configured/);
  assert.match(blocks[0].text, /Global settings revision: 0/);
});

test('render exposes the revision a completed write left behind', async () => {
  const store = createStore({ globalRevision: 3 });
  const harness = createContext(store);
  applyHost(harness.ctx, { policy: store.policyHandle });
  const definition = toolOf(harness);
  const value = await definition.execute({ action: 'set', expectedRevision: 3, policy: DESIRED }, agentExec());
  const blocks = definition.output.render({ action: 'set' }, value);
  assert.match(blocks[0].text, /Global settings revision: 4/);
});

test('listing never applies the configured policy', async () => {
  const store = createStore();
  const harness = createContext(store);
  applyHost(harness.ctx, { policy: store.policyHandle });
  await flush();
  assert.deepEqual(store.mutateCalls, [], 'the mount pass ran while unconfigured');
  const globalView = store.state.get(GLOBAL_SETTINGS_NS);
  globalView.value.policy = DESIRED;
  globalView.revision += 1;
  const result = await call(harness, { action: 'list' });
  assert.equal(result.configured, true);
  assert.equal(result.total, 3);
  assert.deepEqual(store.mutateCalls, [], 'a read must not trigger a reconciliation write');
});
