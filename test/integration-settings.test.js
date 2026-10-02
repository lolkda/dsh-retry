/**
 * Integration acceptance against the real installed Settings machinery.
 *
 * These tests boot a real Cordis Loader over a temporary profile, mount the
 * installed `@deepseek-ai/dsh-config-editor` and `@deepseek-ai/dsh-settings`
 * services, and drive the plugin's own `src/policy.js` operations through the
 * genuine `settings.mutate` path. Nothing here re-implements revision
 * handling: every write, conflict, and inheritance assertion is answered by
 * the installed services writing a real `cordis.patch.yml` on disk.
 *
 * Real modules: `@deepseek-ai/dsh-app-boot` (boot/loadProfileDirectory/
 * readProfilePatches), `@deepseek-ai/dsh-config-editor`,
 * `@deepseek-ai/dsh-settings`, `@deepseek-ai/cordis`, and the real
 * `RetryPolicySchema`/`resolveRetryPolicy` from `@deepseek-ai/dsh-llm`.
 *
 * Test doubles: the provider adapter itself is a fixture plugin (see
 * `test/fixtures/`), because mounting `dsh-llm-pi-ai` would pull the pi-ai
 * transport and credential plane into a configuration test. The fixture
 * declares the *real* native retry schema under a real `.volatile()` subtree,
 * so the schema, revision, and path-op behaviour under test are the shipped
 * ones. The provider directory is a real-shaped `LlmConfigurableProvider`
 * list because no adapter is mounted to publish one.
 *
 * @module test/integration-settings
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { policyOperation, resetOperation, buildProviderRows, normalizePolicy, DEFAULT_POLICY } from '../src/policy.js';
import { createNativeSettingsProfile, FIXTURE_NS, FIXTURE_PROVIDER, FIXTURE_SETTINGS_PATH } from './fixtures/native-settings.js';

/** The real-shaped directory entry a mounted adapter would publish for the fixture route. */
const FIXTURE_DIRECTORY = [
  {
    provider: FIXTURE_PROVIDER,
    displayName: 'cpa',
    settingsNs: FIXTURE_NS,
    settingsPath: FIXTURE_SETTINGS_PATH,
  },
];

/** A native policy that differs from both the lower layer and the default. */
const CHOSEN_POLICY = {
  mode: 'normal',
  maxRetries: 2,
  backoff: { initialDelayMs: 1500, maxDelayMs: 45000, jitterRatio: 0.25 },
};

/** Read the effective retry policy the way a row projection does. */
function effectivePolicy(view) {
  return view.value.providers[FIXTURE_PROVIDER].retryPolicy;
}

test('mounting the real Settings services leaves the profile patch untouched', async () => {
  const env = await createNativeSettingsProfile({ lowerPolicy: false });
  try {
    const view = env.view();
    // A read-only mount must not fabricate a stored policy.
    assert.deepEqual(view.user, {});
    assert.equal(await env.readPatchFile(), '[]\n');
  } finally {
    await env.close();
  }
});

test('the real describe schema is the native serialized schema, not JSON Schema', async () => {
  const env = await createNativeSettingsProfile({ lowerPolicy: false });
  try {
    const view = env.view();
    // The native projection is a ref table: every node is addressed by numeric
    // id and object fields hold ids, not inline subschemas. JSON Schema has
    // neither `uid`/`refs` nor this indirection.
    assert.ok(typeof view.schema === 'object' && view.schema !== null);
    assert.ok('uid' in view.schema, 'native schema root exposes uid');
    assert.ok('refs' in view.schema, 'native schema root exposes refs');
    assert.ok(!('$schema' in view.schema), 'JSON Schema marker absent');

    const at = (ref) => {
      const node = view.schema.refs[String(ref)];
      assert.ok(node, `schema ref ${String(ref)} resolves`);
      return node;
    };

    // Walk the documented live topology:
    // object -> dict.providers -> dict.inner -> object.dict.retryPolicy -> union.
    const root = at(view.schema.uid);
    assert.equal(root.type, 'object');
    const providers = at(root.dict.providers);
    assert.equal(providers.type, 'dict');
    const provider = at(providers.inner);
    assert.equal(provider.type, 'object');
    const retryPolicy = at(provider.dict.retryPolicy);
    assert.equal(retryPolicy.type, 'union');
    assert.equal(retryPolicy.list.length, 2, 'normal and always branches');

    // The union's branches are the shipped normal/always shapes, so the
    // plugin's schema support check is reading the same schema the adapter
    // publishes.
    const branchModes = retryPolicy.list
      .map((branchRef) => at(at(branchRef).dict.mode).value)
      .sort();
    assert.deepEqual(branchModes, ['always', 'normal']);

    // The provider object also declares the secret field the write path must
    // preserve.
    assert.equal(at(provider.dict.apiKeyEnv).meta.role, 'secret');
  } finally {
    await env.close();
  }
});

test('first write succeeds at native revision 0', async () => {
  const env = await createNativeSettingsProfile({ lowerPolicy: false });
  try {
    const view = env.view();
    assert.equal(view.revision, 0, 'native revision starts at 0');

    await env.settings.mutate(FIXTURE_NS, [policyOperation(FIXTURE_SETTINGS_PATH, CHOSEN_POLICY)], view.revision);

    const after = env.view();
    assert.equal(after.revision, 1);
    assert.notEqual(await env.readPatchFile(), '[]\n', 'the write reached the profile patch');
    assert.equal(effectivePolicy(after).maxRetries, 2);
  } finally {
    await env.close();
  }
});

test('a stale revision is refused and the stored policy is preserved', async () => {
  const env = await createNativeSettingsProfile({ lowerPolicy: false });
  try {
    const first = env.view();
    await env.settings.mutate(FIXTURE_NS, [policyOperation(FIXTURE_SETTINGS_PATH, CHOSEN_POLICY)], first.revision);

    const second = env.view();
    await assert.rejects(
      () =>
        env.settings.mutate(
          FIXTURE_NS,
          [policyOperation(FIXTURE_SETTINGS_PATH, { mode: 'normal', maxRetries: 99 })],
          first.revision,
        ),
      (error) => {
        assert.equal(error.name, 'SettingsConflictError');
        assert.equal(error.code, 'SETTINGS_CONFLICT');
        assert.equal(error.expected, 0);
        assert.equal(error.actual, second.revision);
        return true;
      },
    );

    const after = env.view();
    assert.equal(after.revision, second.revision, 'the refused write did not advance the revision');
    assert.equal(effectivePolicy(after).maxRetries, 2, 'the refused write did not overwrite the stored policy');
  } finally {
    await env.close();
  }
});

test('writing retryPolicy preserves the secret reference and every unrelated provider field', async () => {
  const env = await createNativeSettingsProfile({ lowerPolicy: true });
  try {
    const before = env.view();
    const beforeProvider = before.value.providers[FIXTURE_PROVIDER];

    await env.settings.mutate(FIXTURE_NS, [policyOperation(FIXTURE_SETTINGS_PATH, CHOSEN_POLICY)], before.revision);

    const after = env.view();
    const afterProvider = after.value.providers[FIXTURE_PROVIDER];
    assert.equal(afterProvider.apiKeyEnv, beforeProvider.apiKeyEnv, 'credential reference survives the write');
    assert.equal(afterProvider.displayName, beforeProvider.displayName);
    assert.equal(afterProvider.baseURL, beforeProvider.baseURL);
    assert.equal(effectivePolicy(after).maxRetries, 2);
    // The path op addresses only retryPolicy, so the sibling policy fields the
    // caller omitted fall back to their native defaults rather than vanishing.
    assert.deepEqual(effectivePolicy(after).retryableCodes, [...DEFAULT_POLICY.retryableCodes]);
  } finally {
    await env.close();
  }
});

test('the redacted remote read never carries the secret value', async () => {
  const env = await createNativeSettingsProfile({ lowerPolicy: true });
  try {
    const redacted = env.describe({ redactSecrets: true });
    const view = redacted.find((row) => row.ns === FIXTURE_NS);
    assert.equal(view.value.providers[FIXTURE_PROVIDER].apiKeyEnv, undefined, 'secret field stripped from the wire value');
    assert.deepEqual(view.secrets, [{ path: ['providers', FIXTURE_PROVIDER, 'apiKeyEnv'], set: true }]);
  } finally {
    await env.close();
  }
});

test('restoring inherited configuration recovers the lower layer policy', async () => {
  const env = await createNativeSettingsProfile({ lowerPolicy: true });
  try {
    const lower = env.view();
    assert.equal(effectivePolicy(lower).maxRetries, 7, 'the bundle layer supplies the inherited policy');

    await env.settings.mutate(FIXTURE_NS, [policyOperation(FIXTURE_SETTINGS_PATH, CHOSEN_POLICY)], lower.revision);
    assert.equal(effectivePolicy(env.view()).maxRetries, 2);

    const overridden = env.view();
    await env.settings.mutate(FIXTURE_NS, [resetOperation(FIXTURE_SETTINGS_PATH)], overridden.revision);

    const restored = env.view();
    assert.deepEqual(restored.user, {}, 'the profile override is gone');
    assert.equal(effectivePolicy(restored).maxRetries, 7, 'the lower layer policy is effective again');
    assert.equal(await env.readPatchFile(), '[]\n', 'an all-default patch is not persisted as a config override');
  } finally {
    await env.close();
  }
});

test('restoring inherited configuration with no lower policy leaves the native default', async () => {
  const env = await createNativeSettingsProfile({ lowerPolicy: false });
  try {
    const before = env.view();
    await env.settings.mutate(FIXTURE_NS, [policyOperation(FIXTURE_SETTINGS_PATH, CHOSEN_POLICY)], before.revision);

    const overridden = env.view();
    await env.settings.mutate(FIXTURE_NS, [resetOperation(FIXTURE_SETTINGS_PATH)], overridden.revision);

    const restored = env.view();
    assert.equal(
      effectivePolicy(restored),
      undefined,
      'without a lower layer the field is absent, so the adapter falls back to its native default',
    );
  } finally {
    await env.close();
  }
});

test('a custom retryable code round-trips through the real settings store unmodified', async () => {
  const env = await createNativeSettingsProfile({ lowerPolicy: false });
  try {
    const view = env.view();
    const policy = { mode: 'normal', maxRetries: 1, retryableCodes: ['RATE_LIMIT', 'MY_GATEWAY_BUSY'] };
    await env.settings.mutate(FIXTURE_NS, [policyOperation(FIXTURE_SETTINGS_PATH, policy)], view.revision);

    const stored = effectivePolicy(env.view());
    assert.deepEqual(stored.retryableCodes, ['RATE_LIMIT', 'MY_GATEWAY_BUSY']);
    assert.deepEqual(
      normalizePolicy(stored),
      { mode: 'normal', maxRetries: 1, retryableCodes: ['RATE_LIMIT', 'MY_GATEWAY_BUSY'], backoff: { ...DEFAULT_POLICY.backoff } },
      'what the plugin reads back equals what it wrote',
    );
  } finally {
    await env.close();
  }
});

test('always mode persists as mode plus backoff only', async () => {
  const env = await createNativeSettingsProfile({ lowerPolicy: false });
  try {
    const view = env.view();
    const policy = { mode: 'always', backoff: { initialDelayMs: 1000, maxDelayMs: 30000, jitterRatio: 0 } };
    await env.settings.mutate(FIXTURE_NS, [policyOperation(FIXTURE_SETTINGS_PATH, policy)], view.revision);

    const stored = effectivePolicy(env.view());
    assert.equal(stored.mode, 'always');
    assert.deepEqual(Object.keys(stored).sort(), ['backoff', 'mode']);
  } finally {
    await env.close();
  }
});

test('buildProviderRows projects the real namespace views into an editable row', async () => {
  const env = await createNativeSettingsProfile({ lowerPolicy: true });
  try {
    const rows = buildProviderRows(FIXTURE_DIRECTORY, env.describe());
    assert.equal(rows.length, 1);
    const [row] = rows;
    assert.equal(row.provider, FIXTURE_PROVIDER);
    assert.equal(row.ns, FIXTURE_NS);
    assert.deepEqual(row.settingsPath, FIXTURE_SETTINGS_PATH);
    assert.equal(row.revision, env.view().revision, 'the row carries the live native revision');
    assert.equal(row.editable, true);
    assert.equal(row.overridden, false);
    assert.equal(row.policy.maxRetries, 7, 'the row shows the effective inherited policy');
    assert.equal(JSON.stringify(row).includes('CPA_API_KEY'), false, 'rows never carry credential values');

    const view = env.view();
    await env.settings.mutate(FIXTURE_NS, [policyOperation(FIXTURE_SETTINGS_PATH, CHOSEN_POLICY)], view.revision);

    const [afterWrite] = buildProviderRows(FIXTURE_DIRECTORY, env.describe());
    assert.equal(afterWrite.overridden, true, 'the row reports the profile override once stored');
    assert.equal(afterWrite.policy.maxRetries, 2);
  } finally {
    await env.close();
  }
});

test('two writers holding the same revision cannot silently overwrite each other', async () => {
  const env = await createNativeSettingsProfile({ lowerPolicy: false });
  try {
    const shared = env.view();
    await env.settings.mutate(FIXTURE_NS, [policyOperation(FIXTURE_SETTINGS_PATH, { mode: 'normal', maxRetries: 3 })], shared.revision);

    // A second client that still holds the pre-write revision must be refused,
    // which is what keeps a stale draft from overwriting an external update.
    await assert.rejects(
      () => env.settings.mutate(FIXTURE_NS, [policyOperation(FIXTURE_SETTINGS_PATH, { mode: 'normal', maxRetries: 4 })], shared.revision),
      (error) => error.code === 'SETTINGS_CONFLICT',
    );
    assert.equal(effectivePolicy(env.view()).maxRetries, 3);
  } finally {
    await env.close();
  }
});
