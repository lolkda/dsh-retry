/**
 * Integration acceptance for the GLOBAL `retry_policy` tool.
 *
 * The Host half is mounted on the same real profile foundation as the other
 * integration files — real Loader, real `@deepseek-ai/dsh-config-editor`, real
 * `@deepseek-ai/dsh-settings` — so the tool's reads and writes are answered by
 * the shipped schema projection, the shipped revision check, and a real
 * `cordis.patch.yml` on disk.
 *
 * This file replaced the v0.1 provider-scoped cases after the GLOBAL revision
 * removed the provider input; the scenario count is deliberately small.
 *
 * Real: the `retry_policy` tool definition and `execute` from `src/host.js`,
 * the native Settings service, and the Host's own synchronization pass that
 * `set`/`reset` await.
 *
 * Test doubles, with their boundary: `llm.listConfigurableProviders()`
 * publishes a real-shaped directory (no adapter is mounted), `settingsController`
 * wraps the real Settings service with the shipped controller's
 * `describe()`/`mutate()` contract, and `tools` only captures the registered
 * definition. The tool body, revisions, path ops, and persistence are real.
 *
 * @module test/integration-tool
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { normalizePolicy } from '../src/policy.js';
import { FIXTURE_NS, FIXTURE_ROUTES, FIXTURE_NS_ALT, FIXTURE_ALT_ROUTE, FIXTURE_ALT_SETTINGS_PATH, createNativeSettingsProfile } from './fixtures/native-settings.js';

const HOST_MODULE = fileURLToPath(new URL('../src/host.js', import.meta.url));
/** The one namespace the plugin's Config owns; frozen by the contract. */
const GLOBAL_NS = 'dsh-retry-settings';
const NEXT_POLICY = { mode: 'normal', maxRetries: 20, backoff: { initialDelayMs: 500, maxDelayMs: 10000, jitterRatio: 0.1 } };

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

/** A calling context for a mutating tool call: an agent and a live signal. */
function callContext() {
  return { agent: { id: 'integration-agent' }, signal: new AbortController().signal };
}

/**
 * Boot the fixture with the real Host half mounted and return the tool the
 * production `apply()` registered.
 */
async function toolFixture() {
  let captured;
  const env = await createNativeSettingsProfile({
    layout: 'multi',
    global: { id: GLOBAL_NS, modulePath: HOST_MODULE },
    services: (hostCtx) => {
      hostCtx.provide('tools', {
        register(definition) {
          captured = definition;
          return () => {};
        },
      });
      hostCtx.provide('llm', { listConfigurableProviders: async () => directory() });
      hostCtx.provide('settingsController', {
        describe: () => ({ writable: true, hasDocument: true, namespaces: hostCtx.get('settings')?.describe({ redactSecrets: true }) ?? [] }),
        mutate: async (ns, operations, expectedRevision) => {
          await hostCtx.get('settings').mutate(ns, operations, expectedRevision);
          return hostCtx.get('settings').describe({ redactSecrets: true }).find((view) => view.ns === ns);
        },
      });
    },
  });

  try {
    for (let attempt = 0; attempt < 400 && captured === undefined; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 2));
    }
    assert.ok(captured, 'the host half registered the retry_policy tool');
    assert.equal(captured.name, 'retry_policy');
  } catch (error) {
    // The caller only receives `env` on success, so a failure here must not
    // leak the temporary profile.
    await env.close();
    throw error;
  }
  return { env, tool: captured };
}

test('the tool declares the global+override surface: provider optional, policy required for set', async () => {
  const { env, tool } = await toolFixture();
  try {
    const properties = tool.parameters.properties ?? {};
    assert.equal('provider' in properties, true, 'the optional provider input is present');

    // `set` must carry its own policy explicitly, and every mutation carries
    // the revision the caller last read.
    await assert.rejects(
      () => tool.execute({ action: 'set', expectedRevision: 0 }, callContext()),
      (error) => {
        assert.match(String(error.message), /policy/i);
        return true;
      },
    );
    await assert.rejects(
      () => tool.execute({ action: 'set', policy: NEXT_POLICY }, callContext()),
      (error) => {
        assert.match(String(error.message), /revision/i);
        return true;
      },
    );
  } finally {
    await env.close();
  }
});

test('the tool reads, sets, and resets the global policy through the native settings store', async () => {
  const { env, tool } = await toolFixture();
  try {
    const initial = await tool.execute({ action: 'get' }, callContext());
    assert.equal(initial.action, 'get');
    assert.equal(initial.configured, false, 'the global policy starts unset');
    assert.equal(initial.revision, 0, 'the native revision starts at 0');
    assert.equal(env.viewOf(GLOBAL_NS).user.policy, undefined);

    // `list` is the documented alias of the global get.
    const listed = await tool.execute({ action: 'list' }, callContext());
    assert.equal(listed.configured, false);
    assert.equal(listed.revision, 0);

    const written = await tool.execute({ action: 'set', policy: NEXT_POLICY, expectedRevision: 0 }, callContext());
    assert.equal(written.configured, true);
    assert.equal(written.policy.maxRetries, 20, 'the tool reports the global policy it stored');
    assert.ok(written.revision > 0, 'the tool adopts the revision the store returned');

    // Only the global namespace's `policy` key was written.
    const globalView = env.viewOf(GLOBAL_NS);
    assert.equal(globalView.user.policy.maxRetries, 20);
    assert.equal(globalView.user.providers, undefined, 'the global entry never grows provider-specific keys');

    // The awaited reconciliation reports what it actually applied.
    assert.ok(Number.isSafeInteger(written.synced), 'the tool reports a synchronization summary');
    assert.ok(written.synced >= 1, 'the configured providers received the policy');

    // A stale revision is refused rather than silently rebased.
    await assert.rejects(
      () => tool.execute({ action: 'set', policy: { mode: 'normal', maxRetries: 3 }, expectedRevision: 0 }, callContext()),
      (error) => {
        assert.match(String(error.message), /revision|changed/i);
        return true;
      },
    );
    assert.equal(env.viewOf(GLOBAL_NS).user.policy.maxRetries, 20, 'the refused write changed nothing');

    // Reset removes the global override; applied provider values are not reverted.
    const beforeReset = env.viewOf(GLOBAL_NS).revision;
    const reset = await tool.execute({ action: 'reset', expectedRevision: beforeReset }, callContext());
    assert.equal(reset.configured, false, 'reset leaves the global policy unconfigured');
    assert.equal(env.viewOf(GLOBAL_NS).user.policy, undefined, 'the global override is gone');
    assert.equal(
      env.viewOf(FIXTURE_NS).value.providers[FIXTURE_ROUTES[0]].retryPolicy.maxRetries,
      20,
      'disabling does not revert what was already applied',
    );
  } finally {
    await env.close();
  }
});

test('the tool and the UI global writer store the same policy', async () => {
  const { env, tool } = await toolFixture();
  try {
    await tool.execute({ action: 'set', policy: NEXT_POLICY, expectedRevision: 0 }, callContext());
    const storedByTool = env.viewOf(GLOBAL_NS).user.policy;

    // The Client contract's global save is one `remote.settings.mutate` on the
    // global namespace with the path op ['policy'], the draft normalized
    // through the shared `normalizePolicy`, and the baseline revision.
    // Replaying that documented write must land the same stored value, so the
    // tool and the UI surface cannot disagree. (The UI module itself is
    // converted by its own owner; this asserts the shared write contract.)
    const reset = await tool.execute({ action: 'reset', expectedRevision: env.viewOf(GLOBAL_NS).revision }, callContext());
    assert.equal(reset.configured, false);

    await env.settings.mutate(GLOBAL_NS, [{ op: 'set', path: ['policy'], value: normalizePolicy(NEXT_POLICY) }], env.viewOf(GLOBAL_NS).revision);
    const storedByUiWriter = env.viewOf(GLOBAL_NS).user.policy;

    assert.deepEqual(storedByTool, storedByUiWriter, 'tool and UI writer store the identical global policy');
  } finally {
    await env.close();
  }
});
