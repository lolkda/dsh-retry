import test from 'node:test';
import assert from 'node:assert/strict';

import { createProviderSync } from '../src/global-sync.js';

const DEFAULT_CODES = ['EMPTY_RESPONSE', 'RATE_LIMIT', 'SERVER', 'TIMEOUT', 'TRANSPORT'];

/** The desired policy in the exact native raw shape a write carries. */
const DESIRED = {
  mode: 'normal',
  maxRetries: 20,
  retryableCodes: DEFAULT_CODES,
  backoff: { initialDelayMs: 500, maxDelayMs: 10000, jitterRatio: 0.1 },
};

/** Real Settings wire schema: a provider dictionary (llm-pi-ai shape). */
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

/** Real Settings wire schema: a whole-section provider (llm-deepseek shape). */
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

function applyOps(view, ops) {
  for (const op of ops) {
    if (op.op === 'set') {
      setAtPath(view.value, op.path, op.value);
      setAtPath(view.user, op.path, op.value);
    } else {
      let node = view.value;
      for (const key of op.path.slice(0, -1)) node = node?.[key];
      if (node !== undefined && node !== null) delete node[op.path.at(-1)];
    }
  }
}

/**
 * A settings store that behaves like the native service: revision-guarded
 * mutations, real path ops, and per-namespace failures under test control.
 */
function createStore({ directory, namespaces, writable = true }) {
  const state = new Map(namespaces.map((view) => [view.ns, structuredClone(view)]));
  const mutateCalls = [];
  const describeCalls = [];
  const fail = new Map();

  return {
    mutateCalls,
    describeCalls,
    state,
    directory,
    failOnce(ns, code, message = `forced ${code}`) {
      fail.set(ns, { code, message, remaining: 1 });
    },
    controller: {
      async describe() {
        describeCalls.push(true);
        return { writable, hasDocument: true, namespaces: [...state.values()].map((view) => structuredClone(view)) };
      },
      async mutate(ns, ops, expectedRevision) {
        mutateCalls.push({ ns, ops, expectedRevision });
        const view = state.get(ns);
        if (view === undefined) throw settingsError('settings/rejected', `unknown namespace ${ns}`);
        const forced = fail.get(ns);
        if (forced !== undefined && forced.remaining > 0) {
          forced.remaining -= 1;
          if (forced.remaining === 0) fail.delete(ns);
          throw settingsError(forced.code, forced.message);
        }
        if (expectedRevision !== view.revision) {
          throw settingsError('settings/conflict', `settings namespace "${ns}" changed since it was read (expected revision ${expectedRevision}, now ${view.revision})`);
        }
        applyOps(view, ops);
        view.revision += 1;
        return structuredClone(view);
      },
    },
    llm: { async listConfigurableProviders() { return directory; } },
  };
}

function namespaceView(ns, schema, value = {}, revision = 0) {
  return { ns, schema, value, user: {}, base: {}, revision, applies: 'live', autoGenerate: true };
}

function defaultStore() {
  return createStore({
    directory: structuredClone(DIRECTORY),
    namespaces: [
      namespaceView('llm-pi-ai', WIRE_DICT, { providers: { cpa: { baseURL: 'https://cpa.example/v1' }, openai: {} } }, 4),
      namespaceView('llm-deepseek', WIRE_SECTION, {}, 2),
    ],
  });
}

function contextFor(store) {
  return {
    get(name) {
      if (name === 'llm') return store.llm;
      if (name === 'settingsController') return store.controller;
      return undefined;
    },
  };
}

function policyAt(store, ns, path) {
  const view = store.state.get(ns);
  let node = view?.value;
  for (const key of path) {
    if (node === null || typeof node !== 'object') return undefined;
    node = node[key];
  }
  return node;
}

/** Let the factory's chained promises settle. */
async function flush(times = 4) {
  for (let index = 0; index < times; index += 1) await new Promise((resolve) => setTimeout(resolve, 0));
}

// ---------------------------------------------------------------------------
// unconfigured
// ---------------------------------------------------------------------------

test('no global policy writes nothing and reads nothing', async () => {
  const store = defaultStore();
  const sync = createProviderSync(contextFor(store), { readDesiredPolicy: () => undefined });
  const report = await sync.reconcile('mount');
  assert.equal(report.configured, false);
  assert.equal(report.written, 0);
  assert.deepEqual(store.mutateCalls, []);
  assert.deepEqual(store.describeCalls, []);
  await sync.dispose();
});

test('a global policy deleted again stops writing', async () => {
  const store = defaultStore();
  let desired = DESIRED;
  const sync = createProviderSync(contextFor(store), { readDesiredPolicy: () => desired });
  await sync.reconcile('mount');
  const afterFirst = store.mutateCalls.length;
  desired = undefined;
  const report = await sync.reconcile('removed');
  assert.equal(report.configured, false);
  assert.equal(store.mutateCalls.length, afterFirst);
  await sync.dispose();
});

// ---------------------------------------------------------------------------
// applying the policy
// ---------------------------------------------------------------------------

test('one reconcile applies the global policy to providers in several namespaces', async () => {
  const store = defaultStore();
  const sync = createProviderSync(contextFor(store), { readDesiredPolicy: () => DESIRED });
  const report = await sync.reconcile('mount');
  assert.equal(report.configured, true);
  assert.deepEqual(store.mutateCalls.map((call) => call.ns), ['llm-pi-ai', 'llm-deepseek']);
  assert.deepEqual(policyAt(store, 'llm-pi-ai', ['providers', 'cpa', 'retryPolicy']), DESIRED);
  assert.deepEqual(policyAt(store, 'llm-pi-ai', ['providers', 'openai', 'retryPolicy']), DESIRED);
  assert.deepEqual(policyAt(store, 'llm-deepseek', ['retryPolicy']), DESIRED);
  assert.equal(report.synced, 3);
  assert.equal(report.written, 3);
  await sync.dispose();
});

test('two providers in one namespace are written in a single mutation with one revision', async () => {
  const store = defaultStore();
  const sync = createProviderSync(contextFor(store), { readDesiredPolicy: () => DESIRED });
  await sync.reconcile('mount');
  const piAi = store.mutateCalls.filter((call) => call.ns === 'llm-pi-ai');
  assert.equal(piAi.length, 1);
  assert.equal(piAi[0].expectedRevision, 4);
  assert.deepEqual(piAi[0].ops.map((op) => op.path), [
    ['providers', 'cpa', 'retryPolicy'],
    ['providers', 'openai', 'retryPolicy'],
  ]);
  await sync.dispose();
});

test('only the retryPolicy path is ever written', async () => {
  const store = defaultStore();
  const sync = createProviderSync(contextFor(store), { readDesiredPolicy: () => DESIRED });
  await sync.reconcile('mount');
  for (const call of store.mutateCalls) {
    for (const op of call.ops) {
      assert.equal(op.path.at(-1), 'retryPolicy');
      assert.equal(op.op, 'set');
    }
  }
  assert.deepEqual(policyAt(store, 'llm-pi-ai', ['providers', 'cpa', 'baseURL']), 'https://cpa.example/v1');
  await sync.dispose();
});

test('a reconcile after convergence writes nothing', async () => {
  const store = defaultStore();
  const sync = createProviderSync(contextFor(store), { readDesiredPolicy: () => DESIRED });
  await sync.reconcile('mount');
  const settled = store.mutateCalls.length;
  const report = await sync.reconcile('again');
  assert.equal(store.mutateCalls.length, settled);
  assert.equal(report.written, 0);
  assert.equal(report.synced, 3);
  await sync.dispose();
});

test('a provider that already matches is left out of the operations', async () => {
  const store = defaultStore();
  store.state.get('llm-pi-ai').value.providers.cpa.retryPolicy = DESIRED;
  const sync = createProviderSync(contextFor(store), { readDesiredPolicy: () => DESIRED });
  await sync.reconcile('mount');
  const piAi = store.mutateCalls.find((call) => call.ns === 'llm-pi-ai');
  assert.deepEqual(piAi.ops.map((op) => op.path), [['providers', 'openai', 'retryPolicy']]);
  await sync.dispose();
});

// ---------------------------------------------------------------------------
// future providers and events
// ---------------------------------------------------------------------------

test('a provider added later receives the policy on the next reconcile', async () => {
  const store = defaultStore();
  const sync = createProviderSync(contextFor(store), { readDesiredPolicy: () => DESIRED });
  await sync.reconcile('mount');
  const before = store.mutateCalls.length;
  store.directory.push({ provider: 'moonshotai', displayName: 'Moonshot', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'moonshotai'] });
  store.state.get('llm-pi-ai').value.providers.moonshotai = {};
  sync.notifyChange('adapters-updated');
  await flush();
  assert.ok(store.mutateCalls.length > before, 'the new provider must be written');
  assert.deepEqual(policyAt(store, 'llm-pi-ai', ['providers', 'moonshotai', 'retryPolicy']), DESIRED);
  await sync.dispose();
});

test('notifications raised while a reconcile is running are coalesced into one follow-up', async () => {
  const store = defaultStore();
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  let gated = true;
  const controller = store.controller;
  store.controller = {
    async describe() {
      if (gated) { gated = false; await gate; }
      return controller.describe();
    },
    mutate: controller.mutate,
  };
  const sync = createProviderSync(contextFor(store), { readDesiredPolicy: () => DESIRED });
  sync.notifyChange('mount');
  sync.notifyChange('burst-1');
  sync.notifyChange('burst-2');
  sync.notifyChange('burst-3');
  release();
  await flush(8);
  assert.equal(store.describeCalls.length, 1, 'four notifications must collapse into one pass');
  await sync.dispose();
});

test('a self-generated event after a write settles without rewriting', async () => {
  const store = defaultStore();
  const sync = createProviderSync(contextFor(store), { readDesiredPolicy: () => DESIRED });
  await sync.reconcile('mount');
  const settled = store.mutateCalls.length;
  sync.notifyChange('settings/document-updated');
  await flush();
  sync.notifyChange('settings/document-updated');
  await flush();
  assert.equal(store.mutateCalls.length, settled);
  await sync.dispose();
});

test('repeated reconciles do not grow without bound', async () => {
  const store = defaultStore();
  const sync = createProviderSync(contextFor(store), { readDesiredPolicy: () => DESIRED });
  for (let index = 0; index < 5; index += 1) await sync.reconcile(`pass-${index}`);
  assert.ok(store.mutateCalls.length <= 2, `expected at most the two namespace writes, got ${store.mutateCalls.length}`);
  await sync.dispose();
});

// ---------------------------------------------------------------------------
// failure handling
// ---------------------------------------------------------------------------

test('a namespace failure keeps the success of the other namespace', async () => {
  const store = defaultStore();
  store.failOnce('llm-deepseek', 'settings/rejected', 'Config field "retryPolicy" is not volatile');
  const sync = createProviderSync(contextFor(store), { readDesiredPolicy: () => DESIRED });
  const report = await sync.reconcile('mount');
  assert.deepEqual(policyAt(store, 'llm-pi-ai', ['providers', 'cpa', 'retryPolicy']), DESIRED);
  const deepseek = report.namespaces.find((entry) => entry.ns === 'llm-deepseek');
  assert.equal(deepseek.status, 'failed');
  assert.match(deepseek.error, /not volatile/);
  const piAi = report.namespaces.find((entry) => entry.ns === 'llm-pi-ai');
  assert.equal(piAi.status, 'applied');
  assert.equal(report.synced, 2);
  assert.deepEqual(report.pending.map((entry) => entry.provider), ['deepseek-official']);
  await sync.dispose();
});

test('a stale revision is retried once against the fresh revision', async () => {
  const store = defaultStore();
  store.failOnce('llm-pi-ai', 'settings/conflict');
  const sync = createProviderSync(contextFor(store), { readDesiredPolicy: () => DESIRED });
  const report = await sync.reconcile('mount');
  assert.equal(store.mutateCalls.filter((call) => call.ns === 'llm-pi-ai').length, 2);
  assert.deepEqual(policyAt(store, 'llm-pi-ai', ['providers', 'cpa', 'retryPolicy']), DESIRED);
  assert.equal(report.namespaces.find((entry) => entry.ns === 'llm-pi-ai').status, 'applied');
  await sync.dispose();
});

test('a persistent conflict is reported without looping forever', async () => {
  const store = defaultStore();
  store.controller.mutate = async (ns, ops, expectedRevision) => {
    store.mutateCalls.push({ ns, ops, expectedRevision });
    throw settingsError('settings/conflict', 'still changing');
  };
  const sync = createProviderSync(contextFor(store), { readDesiredPolicy: () => DESIRED });
  const report = await sync.reconcile('mount');
  assert.ok(store.mutateCalls.length <= 4, `conflict retries must stay bounded, got ${store.mutateCalls.length}`);
  assert.equal(report.namespaces.every((entry) => entry.status === 'failed'), true);
  await sync.dispose();
});

test('an uneditable provider is reported and never claimed applied', async () => {
  const store = defaultStore();
  store.state.get('llm-deepseek').schema = { uid: 1, refs: { 1: { type: 'object', dict: {}, meta: {} } } };
  const sync = createProviderSync(contextFor(store), { readDesiredPolicy: () => DESIRED });
  const report = await sync.reconcile('mount');
  assert.equal(store.mutateCalls.some((call) => call.ns === 'llm-deepseek'), false);
  assert.deepEqual(report.pending.map((entry) => entry.provider), ['deepseek-official']);
  assert.match(report.pending[0].reason, /retry/i);
  await sync.dispose();
});

test('an invalid global policy is refused instead of propagated', async () => {
  const store = defaultStore();
  const sync = createProviderSync(contextFor(store), { readDesiredPolicy: () => ({ mode: 'normal', maxRetries: -3 }) });
  const report = await sync.reconcile('mount');
  assert.equal(report.configured, false);
  assert.equal(report.written, 0);
  assert.deepEqual(store.mutateCalls, []);
  assert.match(report.error, /maxRetries/);
  await sync.dispose();
});

test('a missing settings service is reported without writing', async () => {
  const store = defaultStore();
  const sync = createProviderSync({ get: () => undefined }, { readDesiredPolicy: () => DESIRED });
  const report = await sync.reconcile('mount');
  assert.equal(report.written, 0);
  assert.match(report.error, /settings/i);
  assert.deepEqual(store.mutateCalls, []);
  await sync.dispose();
});

// ---------------------------------------------------------------------------
// lifecycle
// ---------------------------------------------------------------------------

test('dispose stops any further write and drains the pass in flight', async () => {
  const store = defaultStore();
  const sync = createProviderSync(contextFor(store), { readDesiredPolicy: () => DESIRED });
  await sync.dispose();
  const report = await sync.reconcile('after-dispose');
  assert.equal(report.written, 0);
  assert.deepEqual(store.mutateCalls, []);
});

test('a notification after dispose does nothing', async () => {
  const store = defaultStore();
  const sync = createProviderSync(contextFor(store), { readDesiredPolicy: () => DESIRED });
  await sync.dispose();
  sync.notifyChange('after-dispose');
  await flush();
  assert.deepEqual(store.mutateCalls, []);
});

test('a provider override wins over the global default while other providers follow it', async () => {
  const store = defaultStore();
  const override = { ...DESIRED, maxRetries: 7 };
  const sync = createProviderSync(contextFor(store), {
    readDesiredPolicy: () => DESIRED,
    readProviderOverrides: () => ({ cpa: override }),
  });
  const report = await sync.reconcile('mount');
  assert.equal(report.total, 3);
  assert.equal(report.synced, 3);
  assert.equal(policyAt(store, 'llm-pi-ai', ['providers', 'cpa', 'retryPolicy']).maxRetries, 7);
  assert.deepEqual(policyAt(store, 'llm-pi-ai', ['providers', 'openai', 'retryPolicy']), DESIRED);
  assert.deepEqual(policyAt(store, 'llm-deepseek', ['retryPolicy']), DESIRED);
  await sync.dispose();
});

test('an override works even while no global default is configured', async () => {
  const store = defaultStore();
  const override = { ...DESIRED, maxRetries: 11 };
  const sync = createProviderSync(contextFor(store), {
    readDesiredPolicy: () => undefined,
    readProviderOverrides: () => ({ cpa: override }),
  });
  const report = await sync.reconcile('mount');
  assert.equal(report.configured, false);
  assert.equal(policyAt(store, 'llm-pi-ai', ['providers', 'cpa', 'retryPolicy']).maxRetries, 11);
  assert.equal(policyAt(store, 'llm-pi-ai', ['providers', 'openai', 'retryPolicy']), undefined);
  assert.equal(policyAt(store, 'llm-deepseek', ['retryPolicy']), undefined);
  await sync.dispose();
});

test('re-enabling writes the configured global policy again', async () => {
  const store = defaultStore();
  const first = createProviderSync(contextFor(store), { readDesiredPolicy: () => DESIRED });
  await first.reconcile('mount');
  await first.dispose();
  store.state.get('llm-pi-ai').value.providers.cpa.retryPolicy = { mode: 'normal', maxRetries: 5 };
  const second = createProviderSync(contextFor(store), { readDesiredPolicy: () => DESIRED });
  await second.reconcile('remount');
  assert.deepEqual(policyAt(store, 'llm-pi-ai', ['providers', 'cpa', 'retryPolicy']), DESIRED);
  await second.dispose();
});

// ---------------------------------------------------------------------------
// stale operations must be recomputed, not replayed
// ---------------------------------------------------------------------------

test('a conflicting write re-reads the directory and never rewrites a provider that disappeared', async () => {
  const store = defaultStore();
  const openaiIndex = store.directory.findIndex((entry) => entry.provider === 'openai');
  let removed = false;
  const original = store.controller.mutate;
  store.controller.mutate = async (ns, ops, expectedRevision) => {
    if (ns === 'llm-pi-ai' && !removed) {
      removed = true;
      // The route disappears, and someone else writes, while our attempt is in flight.
      store.directory.splice(openaiIndex, 1);
      delete store.state.get('llm-pi-ai').value.providers.openai;
      store.state.get('llm-pi-ai').revision += 1;
      store.mutateCalls.push({ ns, ops, expectedRevision });
      throw settingsError('settings/conflict', 'settings changed while writing');
    }
    return original.call(store.controller, ns, ops, expectedRevision);
  };
  const sync = createProviderSync(contextFor(store), { readDesiredPolicy: () => DESIRED });
  await sync.reconcile('mount');
  const attempts = store.mutateCalls.filter((call) => call.ns === 'llm-pi-ai');
  assert.equal(attempts.length, 2, 'the stale attempt must be retried exactly once');
  assert.deepEqual(attempts.at(-1).ops.map((op) => op.path), [['providers', 'cpa', 'retryPolicy']]);
  // The first attempt legitimately carried the route: it was collected before the deletion
  // and was rejected. Every attempt after the conflict was observed must exclude it.
  assert.equal(
    attempts.slice(1).some((call) => call.ops.some((op) => op.path.includes('openai'))),
    false,
    'a provider that disappeared must never be written once the conflict is observed',
  );
  assert.equal(policyAt(store, 'llm-pi-ai', ['providers', 'openai', 'retryPolicy']), undefined);
  assert.deepEqual(policyAt(store, 'llm-pi-ai', ['providers', 'cpa', 'retryPolicy']), DESIRED);
  await sync.dispose();
});

test('a provider added while a conflicting write is retried is picked up by the retry', async () => {
  const store = defaultStore();
  let added = false;
  const original = store.controller.mutate;
  store.controller.mutate = async (ns, ops, expectedRevision) => {
    if (ns === 'llm-pi-ai' && !added) {
      added = true;
      store.directory.push({ provider: 'moonshotai', displayName: 'Moonshot', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'moonshotai'] });
      store.state.get('llm-pi-ai').value.providers.moonshotai = {};
      store.state.get('llm-pi-ai').revision += 1;
      store.mutateCalls.push({ ns, ops, expectedRevision });
      throw settingsError('settings/conflict', 'settings changed while writing');
    }
    return original.call(store.controller, ns, ops, expectedRevision);
  };
  const sync = createProviderSync(contextFor(store), { readDesiredPolicy: () => DESIRED });
  await sync.reconcile('mount');
  assert.deepEqual(policyAt(store, 'llm-pi-ai', ['providers', 'moonshotai', 'retryPolicy']), DESIRED);
  await sync.dispose();
});

test('a global policy cleared mid-pass stops further namespace writes', async () => {
  const store = defaultStore();
  let reads = 0;
  const sync = createProviderSync(contextFor(store), { readDesiredPolicy: () => (reads++ < 2 ? DESIRED : undefined) });
  await sync.reconcile('mount');
  assert.deepEqual(store.mutateCalls.map((call) => call.ns), ['llm-pi-ai']);
  await sync.dispose();
});
