/**
 * Integration acceptance for the GLOBAL retry policy and provider synchronization.
 *
 * Same foundation as `integration-settings.test.js`: a real Cordis Loader boots
 * a throwaway profile, the installed `@deepseek-ai/dsh-config-editor` and
 * `@deepseek-ai/dsh-settings` services answer every read and write, and the
 * profile patch on disk is the only durable state. On top of that this file
 * drives the Host's real `createProviderSync` factory from `src/global-sync.js`
 * and the real `summarizeProviderSync` from `src/policy.js`.
 *
 * Real modules: `@deepseek-ai/dsh-app-boot`, `@deepseek-ai/dsh-config-editor`,
 * `@deepseek-ai/dsh-settings`, `@deepseek-ai/cordis`, plus the plugin's
 * `src/global-sync.js` and `src/policy.js`.
 *
 * Test doubles, with their exact boundary:
 * - `llm.listConfigurableProviders()` returns real-shaped
 *   `LlmConfigurableProvider` entries. No adapter is mounted, so there is no
 *   directory to publish; the synchronizer consumes nothing else from `llm`.
 * - `settingsController` wraps the real Settings service with the shipped
 *   controller's `describe()`/`mutate()` contract, and records each call so a
 *   test can prove batching and idempotence by call count. Revisions,
 *   volatility, path ops, and persistence are the real ones.
 * - `tools` only captures the registered definition; the tool's own `execute`
 *   is the production function.
 *
 * @module test/integration-global
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { FIXTURE_NS, FIXTURE_NS_ALT, FIXTURE_ROUTES, FIXTURE_ALT_ROUTE, FIXTURE_ALT_SETTINGS_PATH, createNativeSettingsProfile } from './fixtures/native-settings.js';

const HOST_MODULE = fileURLToPath(new URL('../src/host.js', import.meta.url));
/** The one namespace the plugin's own Config owns. */
const GLOBAL_NS = 'dsh-retry-settings';
/** The user's actual policy: it must survive as the effective value. */
const USER_POLICY = {
  mode: 'normal',
  maxRetries: 20,
  backoff: { initialDelayMs: 500, maxDelayMs: 10000, jitterRatio: 0.1 },
};

/** The real-shaped provider directory, matching the fixture's two namespaces. */
function directory() {
  return [
    ...FIXTURE_ROUTES.map((route) => ({
      provider: route,
      displayName: route,
      settingsNs: FIXTURE_NS,
      settingsPath: ['providers', route],
    })),
    {
      provider: FIXTURE_ALT_ROUTE,
      displayName: FIXTURE_ALT_ROUTE,
      settingsNs: FIXTURE_NS_ALT,
      settingsPath: FIXTURE_ALT_SETTINGS_PATH,
    },
  ];
}

/**
 * Wrap the real Settings service in the shipped controller's contract while
 * recording calls, so a test can assert batching by counting mutations.
 * @param env - a profile from `createNativeSettingsProfile`.
 * @param options - `failNs` makes that namespace's mutation reject.
 */
function recordingController(env, { failNs } = {}) {
  const calls = [];
  return {
    calls,
    describe: () => ({ writable: true, hasDocument: true, namespaces: env.settings.describe({ redactSecrets: true }) }),
    mutate: async (ns, operations, expectedRevision) => {
      calls.push({ ns, operations: [...operations], expectedRevision });
      if (ns === failNs) throw new Error(`synthetic failure for ${ns}`);
      await env.settings.mutate(ns, operations, expectedRevision);
      return env.settings.describe({ redactSecrets: true }).find((view) => view.ns === ns);
    },
  };
}

/**
 * Boot the multi-namespace fixture and construct the Host's real synchronizer.
 * @returns the fixture, the recorded controller, a mutable desired-policy cell, and the synchronizer.
 */
async function syncFixture({ failNs } = {}) {
  // The lower bundle layer stores a policy per provider, which is what makes
  // "the inherited value is untouched" and "reset keeps the applied value"
  // observable rather than indistinguishable from an absent field.
  const env = await createNativeSettingsProfile({ layout: 'multi', lowerPolicy: true });
  try {
    const controller = recordingController(env, { failNs });
    let entries = directory();
    env.ctx.provide('llm', { listConfigurableProviders: async () => entries });
    env.ctx.provide('settingsController', controller);

    const { createProviderSync } = await import('../src/global-sync.js');
    let desired;
    const sync = createProviderSync(env.ctx, { readDesiredPolicy: () => desired });

    return {
      env,
      controller,
      sync,
      setDesired: (policy) => {
        desired = policy;
      },
      /** Add a route to the directory the way a newly configured provider appears. */
      addProvider: (entry) => {
        entries = [...entries, entry];
      },
      async close() {
        await sync.dispose();
        await env.close();
      },
    };
  } catch (error) {
    // The caller only receives the fixture on success, so a failure while
    // wiring the synchronizer must not leak the temporary profile.
    await env.close();
    throw error;
  }
}

/** Read one provider's stored policy out of its namespace view. */
function storedPolicy(env, ns, route) {
  return env.viewOf(ns).value.providers[route]?.retryPolicy;
}

test('an unconfigured global policy writes nothing', async () => {
  const fx = await syncFixture();
  try {
    fx.setDesired(undefined);
    const report = await fx.sync.reconcile('initial');

    assert.equal(report.configured, false);
    assert.equal(report.written, 0);
    assert.equal(fx.controller.calls.length, 0, 'no mutation is attempted while the global policy is unset');
    assert.equal(await fx.env.readPatchFile(), '[]\n', 'the profile patch stays empty');
    assert.equal(storedPolicy(fx.env, FIXTURE_NS, FIXTURE_ROUTES[0]).maxRetries, 7, 'the inherited policy is untouched');
  } finally {
    await fx.close();
  }
});

test('setting a global policy reaches every configured provider', async () => {
  const fx = await syncFixture();
  try {
    fx.setDesired(USER_POLICY);
    const report = await fx.sync.reconcile('global set');

    assert.equal(report.configured, true);
    assert.equal(report.total, 3);
    assert.equal(report.synced, 3);
    assert.deepEqual(report.pending, []);
    assert.ok(report.written > 0);

    for (const route of FIXTURE_ROUTES) {
      const stored = storedPolicy(fx.env, FIXTURE_NS, route);
      assert.equal(stored.maxRetries, 20, `${route} received the global policy`);
      assert.deepEqual(stored.backoff, USER_POLICY.backoff);
    }
    assert.equal(storedPolicy(fx.env, FIXTURE_NS_ALT, FIXTURE_ALT_ROUTE).maxRetries, 20);

    // Success is reported per namespace, so a partial outcome is always visible.
    const statuses = Object.fromEntries(report.namespaces.map((entry) => [entry.ns, entry.status]));
    assert.equal(statuses[FIXTURE_NS], 'applied');
    assert.equal(statuses[FIXTURE_NS_ALT], 'applied');
  } finally {
    await fx.close();
  }
});

test('providers sharing a namespace are written in one mutation with one revision', async () => {
  const fx = await syncFixture();
  try {
    fx.setDesired(USER_POLICY);
    await fx.sync.reconcile('global set');

    const primaryCalls = fx.controller.calls.filter((call) => call.ns === FIXTURE_NS);
    assert.equal(primaryCalls.length, 1, 'both routes of one namespace travel in a single batch');
    assert.equal(primaryCalls[0].operations.length, 2, 'one path op per differing provider');
    assert.deepEqual(
      primaryCalls[0].operations.map((operation) => operation.path.join('.')).sort(),
      FIXTURE_ROUTES.map((route) => `providers.${route}.retryPolicy`).sort(),
    );
    assert.ok(Number.isSafeInteger(primaryCalls[0].expectedRevision), 'the batch carries one expected revision');
    assert.equal(new Set(fx.controller.calls.map((call) => call.ns)).size, 2, 'one mutation per namespace');
  } finally {
    await fx.close();
  }
});

test('writing the global policy changes only retryPolicy', async () => {
  const fx = await syncFixture();
  try {
    const before = fx.env.viewOf(FIXTURE_NS).value.providers[FIXTURE_ROUTES[0]];
    fx.setDesired(USER_POLICY);
    await fx.sync.reconcile('global set');

    const after = fx.env.viewOf(FIXTURE_NS).value.providers[FIXTURE_ROUTES[0]];
    assert.equal(after.apiKeyEnv, before.apiKeyEnv, 'the credential reference survives');
    assert.equal(after.displayName, before.displayName);
    assert.equal(after.baseURL, before.baseURL);
  } finally {
    await fx.close();
  }
});

test('a second reconciliation of an unchanged policy performs no writes', async () => {
  const fx = await syncFixture();
  try {
    fx.setDesired(USER_POLICY);
    await fx.sync.reconcile('global set');
    const afterFirst = fx.controller.calls.length;

    const second = await fx.sync.reconcile('self event');
    assert.equal(fx.controller.calls.length, afterFirst, 'equal providers produce no operations');
    assert.equal(second.written, 0);
    assert.equal(second.synced, second.total);
    assert.deepEqual(second.pending, []);
  } finally {
    await fx.close();
  }
});

test('a provider that appears later receives the global policy', async () => {
  const fx = await syncFixture();
  try {
    fx.setDesired(USER_POLICY);
    await fx.sync.reconcile('global set');
    assert.equal(storedPolicy(fx.env, FIXTURE_NS, FIXTURE_ROUTES[0]).maxRetries, 20);

    // A genuinely new route: it is configured into the provider namespace the
    // way a user adding a second route would configure it, and the adapter
    // directory then publishes it.
    const view = fx.env.viewOf(FIXTURE_NS);
    await fx.env.settings.mutate(
      FIXTURE_NS,
      [{ op: 'set', path: ['providers', 'cpa-c'], value: { displayName: 'cpa-c', apiKeyEnv: 'CPA_C_API_KEY', baseURL: 'http://192.168.1.100:8317/v1' } }],
      view.revision,
    );
    assert.equal(storedPolicy(fx.env, FIXTURE_NS, 'cpa-c'), undefined, 'the new route starts without a policy');

    fx.addProvider({ provider: 'cpa-c', displayName: 'cpa-c', settingsNs: FIXTURE_NS, settingsPath: ['providers', 'cpa-c'] });
    const report = await fx.sync.reconcile('provider added');

    assert.equal(storedPolicy(fx.env, FIXTURE_NS, 'cpa-c').maxRetries, 20, 'the new provider received the global policy');
    assert.equal(report.synced, report.total);
    assert.deepEqual(report.pending, []);
  } finally {
    await fx.close();
  }
});

test('a namespace failure is reported while the other namespace keeps its success', async () => {
  const fx = await syncFixture({ failNs: FIXTURE_NS_ALT });
  try {
    fx.setDesired(USER_POLICY);
    const report = await fx.sync.reconcile('global set');

    const failed = report.namespaces.find((entry) => entry.ns === FIXTURE_NS_ALT);
    assert.equal(failed.status, 'failed');
    assert.ok(typeof failed.error === 'string' && failed.error.length > 0, 'the failure carries its reason');

    assert.equal(storedPolicy(fx.env, FIXTURE_NS, FIXTURE_ROUTES[0]).maxRetries, 20, 'the healthy namespace applied');
    assert.equal(storedPolicy(fx.env, FIXTURE_NS_ALT, FIXTURE_ALT_ROUTE).maxRetries, 7, 'the failed namespace kept its old value');
    assert.notEqual(report.synced, report.total, 'partial application is never reported as full success');
    assert.ok(report.pending.length > 0, 'the unsynchronized provider is listed');
  } finally {
    await fx.close();
  }
});

test('disposing the synchronizer stops further writes', async () => {
  const fx = await syncFixture();
  try {
    fx.setDesired(USER_POLICY);
    await fx.sync.reconcile('global set');
    const afterFirst = fx.controller.calls.length;

    await fx.sync.dispose();
    fx.setDesired({ mode: 'normal', maxRetries: 3 });
    const afterDispose = await fx.sync.reconcile('after dispose');

    assert.equal(fx.controller.calls.length, afterFirst, 'no mutation is attempted after disposal');
    assert.equal(afterDispose.written, 0);
    assert.equal(storedPolicy(fx.env, FIXTURE_NS, FIXTURE_ROUTES[0]).maxRetries, 20, 'applied values are not reverted');
  } finally {
    await fx.close();
  }
});

test('reset of the global policy leaves applied provider values in place', async () => {
  const fx = await syncFixture();
  try {
    fx.setDesired(USER_POLICY);
    await fx.sync.reconcile('global set');
    assert.equal(storedPolicy(fx.env, FIXTURE_NS, FIXTURE_ROUTES[0]).maxRetries, 20);

    // Clearing the global policy makes the plugin unconfigured again; the
    // contract says disabling/unsetting must not revert what was applied.
    fx.setDesired(undefined);
    const report = await fx.sync.reconcile('global reset');
    assert.equal(report.configured, false);
    assert.equal(report.written, 0);
    assert.equal(storedPolicy(fx.env, FIXTURE_NS, FIXTURE_ROUTES[0]).maxRetries, 20, 'provider values are not reverted');
  } finally {
    await fx.close();
  }
});

test('the frozen global interface is exported with the agreed values', async () => {
  const policy = await import('../src/policy.js');
  assert.equal(policy.GLOBAL_SETTINGS_NS, GLOBAL_NS, 'the global namespace id is the frozen one');
  assert.equal(typeof policy.summarizeProviderSync, 'function');
  assert.equal(typeof policy.normalizePolicy, 'function');
  assert.equal(typeof policy.buildProviderRows, 'function');
});

test('summarizeProviderSync reports equality by behaviour, not by code order', async () => {
  const { summarizeProviderSync } = await import('../src/policy.js');
  const rows = [
    {
      provider: 'cpa',
      editable: true,
      policy: { mode: 'normal', maxRetries: 20, retryableCodes: ['RATE_LIMIT', 'SERVER', 'TIMEOUT', 'TRANSPORT', 'EMPTY_RESPONSE'], backoff: { initialDelayMs: 500, maxDelayMs: 10000, jitterRatio: 0.1 } },
    },
    {
      provider: 'alt',
      editable: true,
      policy: { mode: 'normal', maxRetries: 5, backoff: { initialDelayMs: 500, maxDelayMs: 10000, jitterRatio: 0.1 } },
    },
  ];
  const summary = summarizeProviderSync(USER_POLICY, rows);

  assert.equal(summary.total, 2);
  assert.equal(summary.synced, 1, 'the code-set order difference does not count as a difference');
  assert.equal(summary.pending.length, 1);
  assert.equal(summary.pending[0].provider, 'alt');
});

test('summarizeProviderSync keeps an unsupported provider pending with its reason', async () => {
  const { summarizeProviderSync } = await import('../src/policy.js');
  const reason = 'provider "alt" declares no native retryPolicy at providers.alt';
  const rows = [
    { provider: 'cpa', editable: true, policy: { mode: 'normal', maxRetries: 20, backoff: { initialDelayMs: 500, maxDelayMs: 10000, jitterRatio: 0.1 } } },
    { provider: 'alt', editable: false, reason, policy: { mode: 'normal', maxRetries: 20, backoff: { initialDelayMs: 500, maxDelayMs: 10000, jitterRatio: 0.1 } } },
  ];
  const summary = summarizeProviderSync(USER_POLICY, rows);

  assert.equal(summary.total, 2);
  assert.equal(summary.synced, 1);
  assert.deepEqual(summary.pending, [{ provider: 'alt', reason }]);
});

test('summarizeProviderSync never throws on an invalid stored policy', async () => {
  const { summarizeProviderSync } = await import('../src/policy.js');
  const rows = [{ provider: 'cpa', editable: true, policy: { mode: 'nonsense' } }];
  const summary = summarizeProviderSync(USER_POLICY, rows);

  assert.equal(summary.total, 1);
  assert.equal(summary.synced, 0);
  assert.equal(summary.pending.length, 1);
  assert.equal(summary.pending[0].provider, 'cpa');
  assert.ok(typeof summary.pending[0].reason === 'string' && summary.pending[0].reason.length > 0);
});

test('mounting the plugin with no global policy leaves every provider untouched', async () => {
  const env = await createNativeSettingsProfile({
    layout: 'multi',
    lowerPolicy: true,
    global: { id: GLOBAL_NS, modulePath: HOST_MODULE },
    services: (hostCtx) => {
      hostCtx.provide('tools', { register: () => () => {} });
      hostCtx.provide('llm', { listConfigurableProviders: async () => directory() });
      hostCtx.provide('settingsController', {
        describe: () => ({ writable: true, hasDocument: true, namespaces: hostCtx.get('settings')?.describe({ redactSecrets: true }) ?? [] }),
        mutate: async (ns, operations, expectedRevision) => hostCtx.get('settings').mutate(ns, operations, expectedRevision),
      });
    },
  });
  try {
    const view = env.viewOf(GLOBAL_NS);
    assert.equal(view.value.policy, undefined, 'the global policy is absent, so the plugin is unconfigured');
    assert.equal(view.revision, 0);

    // Mount-time reconciliation must not write any provider.
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(await env.readPatchFile(), '[]\n', 'no provider or global policy was written at mount');
    assert.equal(storedPolicy(env, FIXTURE_NS, FIXTURE_ROUTES[0]).maxRetries, 7, 'the inherited provider value is intact');
  } finally {
    await env.close();
  }
});
