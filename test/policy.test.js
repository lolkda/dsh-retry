import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_POLICY,
  GLOBAL_SETTINGS_NS,
  normalizePolicy,
  getPath,
  policyOperation,
  resetOperation,
  buildProviderRows,
  summarizeProviderSync,
} from '../src/policy.js';

const DEFAULT_CODES = ['EMPTY_RESPONSE', 'RATE_LIMIT', 'SERVER', 'TIMEOUT', 'TRANSPORT'];

/** Native Settings form schema for a whole-section provider (llm-deepseek shape). */
function wholeSectionSchema() {
  return {
    type: 'object',
    $defs: { loaderExpression: { type: 'object', properties: { __jsExpr: { type: 'string' } } } },
    properties: {
      retryPolicy: { anyOf: [{ anyOf: [normalBranch(), alwaysBranch()] }, { $ref: '#/$defs/loaderExpression' }] },
      models: { type: 'array', items: { type: 'object' } },
    },
  };
}

/** Native Settings form schema for a per-route provider dictionary (llm-pi-ai shape). */
function providerDictSchema() {
  return {
    type: 'object',
    $defs: { loaderExpression: { type: 'object', properties: { __jsExpr: { type: 'string' } } } },
    properties: {
      providers: {
        type: ['object', 'null'],
        additionalProperties: {
          anyOf: [
            {
              type: 'object',
              properties: {
                baseURL: { type: ['string', 'null'] },
                retryPolicy: { anyOf: [{ anyOf: [normalBranch(), alwaysBranch()] }, { $ref: '#/$defs/loaderExpression' }] },
              },
            },
            { $ref: '#/$defs/loaderExpression' },
          ],
        },
      },
    },
  };
}

/** Native Settings form schema for a provider whose profile has no retryPolicy field. */
function schemaWithoutRetryPolicy() {
  return {
    type: 'object',
    properties: {
      providers: {
        type: ['object', 'null'],
        additionalProperties: { type: 'object', properties: { baseURL: { type: ['string', 'null'] } } },
      },
    },
  };
}

function normalBranch() {
  return {
    type: 'object',
    required: ['mode'],
    properties: {
      mode: { const: 'normal' },
      maxRetries: { type: ['integer', 'null'], default: 5 },
      retryableCodes: { type: ['array', 'null'], items: { type: ['string', 'null'] }, default: DEFAULT_CODES },
      backoff: {
        type: ['object', 'null'],
        properties: {
          initialDelayMs: { type: ['number', 'null'], default: 500 },
          maxDelayMs: { type: ['number', 'null'], default: 10000 },
          jitterRatio: { type: ['number', 'null'], default: 0.1 },
        },
      },
    },
  };
}

function alwaysBranch() {
  return {
    type: 'object',
    required: ['mode'],
    properties: {
      mode: { const: 'always' },
      backoff: {
        type: ['object', 'null'],
        properties: {
          initialDelayMs: { type: ['number', 'null'], default: 500 },
          maxDelayMs: { type: ['number', 'null'], default: 10000 },
          jitterRatio: { type: ['number', 'null'], default: 0.1 },
        },
      },
    },
  };
}

function namespaceView(ns, schema, { value, base, user, revision = 0 } = {}) {
  return { ns, schema, value: value ?? {}, base: base ?? {}, user: user ?? {}, revision, applies: 'live', autoGenerate: true };
}

/**
 * The real Settings wire schema for `llm-pi-ai` captured from `/api/settings/describe`.
 * The Settings service publishes Schemastery's own serialization — `{uid, refs}` with
 * numeric references — not a JSON Schema document.
 */
const CAPTURED_WIRE_SCHEMA = {
  uid: 1,
  refs: {
    1: { type: 'object', dict: { providers: 2 }, meta: { default: {} } },
    2: { type: 'dict', inner: 3, meta: { default: {} } },
    3: { type: 'object', dict: { retryPolicy: 4 }, meta: { default: {} } },
    4: { type: 'union', list: [5, 6], meta: {} },
    5: { type: 'object', dict: { mode: 7, maxRetries: 8, backoff: 9 }, meta: {} },
    6: { type: 'object', dict: { mode: 10, backoff: 9 }, meta: {} },
    7: { type: 'const', value: 'normal' },
    10: { type: 'const', value: 'always' },
  },
};

const WIRE_WHOLE_SECTION_SCHEMA = {
  uid: 1,
  refs: {
    1: { type: 'object', dict: { retryPolicy: 2 }, meta: { default: {} } },
    2: { type: 'union', list: [3, 4], meta: {} },
    3: { type: 'object', dict: { mode: 5, maxRetries: 6 }, meta: {} },
    4: { type: 'object', dict: { mode: 7 }, meta: {} },
    5: { type: 'const', value: 'normal' },
    7: { type: 'const', value: 'always' },
  },
};

const WIRE_WITHOUT_RETRY_SCHEMA = {
  uid: 1,
  refs: {
    1: { type: 'object', dict: { providers: 2 }, meta: { default: {} } },
    2: { type: 'dict', inner: 3, meta: { default: {} } },
    3: { type: 'object', dict: { baseURL: 4 }, meta: { default: {} } },
    4: { type: 'string', meta: {} },
  },
};

// ---------------------------------------------------------------------------
// DEFAULT_POLICY
// ---------------------------------------------------------------------------

test('DEFAULT_POLICY carries the native normal defaults and is frozen', () => {
  assert.equal(DEFAULT_POLICY.mode, 'normal');
  assert.equal(DEFAULT_POLICY.maxRetries, 5);
  assert.deepEqual(DEFAULT_POLICY.retryableCodes, DEFAULT_CODES);
  assert.deepEqual(DEFAULT_POLICY.backoff, { initialDelayMs: 500, maxDelayMs: 10000, jitterRatio: 0.1 });
  assert.equal(Object.isFrozen(DEFAULT_POLICY), true);
  assert.equal(Object.isFrozen(DEFAULT_POLICY.backoff), true);
});

// ---------------------------------------------------------------------------
// normalizePolicy
// ---------------------------------------------------------------------------

test('normalizePolicy turns undefined into a detached clone of the native defaults', () => {
  const policy = normalizePolicy(undefined);
  assert.deepEqual(policy, {
    mode: 'normal',
    maxRetries: 5,
    retryableCodes: DEFAULT_CODES,
    backoff: { initialDelayMs: 500, maxDelayMs: 10000, jitterRatio: 0.1 },
  });
  assert.notEqual(policy, DEFAULT_POLICY);
  assert.notEqual(policy.retryableCodes, DEFAULT_POLICY.retryableCodes);
  policy.retryableCodes.push('MUTATED');
  assert.deepEqual(DEFAULT_POLICY.retryableCodes, DEFAULT_CODES);
});

test('normalizePolicy resolves missing optional fields of a partial normal policy', () => {
  const policy = normalizePolicy({ mode: 'normal' });
  assert.equal(policy.maxRetries, 5);
  assert.deepEqual(policy.retryableCodes, DEFAULT_CODES);
  assert.deepEqual(policy.backoff, { initialDelayMs: 500, maxDelayMs: 10000, jitterRatio: 0.1 });
});

test('normalizePolicy keeps maxRetries 0, which disables ordinary retries', () => {
  assert.equal(normalizePolicy({ mode: 'normal', maxRetries: 0 }).maxRetries, 0);
});

test('normalizePolicy rejects an unknown mode', () => {
  assert.throws(() => normalizePolicy({ mode: 'sometimes' }), /mode must be "normal" or "always"/);
});

test('normalizePolicy rejects a missing, negative, or fractional maxRetries', () => {
  assert.throws(() => normalizePolicy({ mode: 'normal', maxRetries: -1 }), /maxRetries/);
  assert.throws(() => normalizePolicy({ mode: 'normal', maxRetries: 1.5 }), /maxRetries/);
  assert.throws(() => normalizePolicy({ mode: 'normal', maxRetries: '3' }), /maxRetries/);
});

test('normalizePolicy rejects delays that are non-finite, non-positive, or above the timer ceiling', () => {
  const bad = [0, -1, Number.NaN, Number.POSITIVE_INFINITY, 2147483648];
  for (const initialDelayMs of bad) {
    assert.throws(() => normalizePolicy({ mode: 'normal', backoff: { initialDelayMs } }), /initialDelayMs/, `initialDelayMs=${initialDelayMs}`);
  }
  for (const maxDelayMs of bad) {
    assert.throws(() => normalizePolicy({ mode: 'normal', backoff: { maxDelayMs } }), /maxDelayMs/, `maxDelayMs=${maxDelayMs}`);
  }
});

test('normalizePolicy rejects an initial delay above the maximum delay', () => {
  assert.throws(
    () => normalizePolicy({ mode: 'normal', backoff: { initialDelayMs: 3000, maxDelayMs: 2000 } }),
    /initialDelayMs must be less than or equal to maxDelayMs/,
  );
});

test('normalizePolicy rejects a jitter ratio outside 0..1', () => {
  assert.throws(() => normalizePolicy({ mode: 'normal', backoff: { jitterRatio: 1.5 } }), /jitterRatio/);
  assert.throws(() => normalizePolicy({ mode: 'normal', backoff: { jitterRatio: -0.1 } }), /jitterRatio/);
});

test('normalizePolicy rejects an empty or blank retryable code list', () => {
  assert.throws(() => normalizePolicy({ mode: 'normal', retryableCodes: [] }), /retryableCodes must not be empty/);
  assert.throws(() => normalizePolicy({ mode: 'normal', retryableCodes: ['  '] }), /retryableCodes/);
  assert.throws(() => normalizePolicy({ mode: 'normal', retryableCodes: [''] }), /retryableCodes/);
});

test('normalizePolicy rejects duplicate retryable codes', () => {
  assert.throws(() => normalizePolicy({ mode: 'normal', retryableCodes: ['RATE_LIMIT', 'RATE_LIMIT'] }), /duplicates/);
});

test('normalizePolicy preserves custom and unknown codes verbatim instead of rewriting or dropping them', () => {
  const policy = normalizePolicy({ mode: 'normal', retryableCodes: ['RATE_LIMIT', 'my_custom_code', 'Quota'] });
  assert.deepEqual(policy.retryableCodes, ['RATE_LIMIT', 'my_custom_code', 'Quota']);
});

test('normalizePolicy returns only mode and backoff for always mode', () => {
  const policy = normalizePolicy({ mode: 'always', backoff: { initialDelayMs: 2000, maxDelayMs: 60000, jitterRatio: 0.2 } });
  assert.deepEqual(policy, { mode: 'always', backoff: { initialDelayMs: 2000, maxDelayMs: 60000, jitterRatio: 0.2 } });
  assert.equal('maxRetries' in policy, false);
  assert.equal('retryableCodes' in policy, false);
});

test('normalizePolicy ignores retries and codes supplied alongside always mode', () => {
  const policy = normalizePolicy({ mode: 'always', maxRetries: 9, retryableCodes: ['RATE_LIMIT'] });
  assert.deepEqual(policy, { mode: 'always', backoff: { initialDelayMs: 500, maxDelayMs: 10000, jitterRatio: 0.1 } });
});

test('normalizePolicy rejects unknown keys instead of silently persisting them', () => {
  assert.throws(() => normalizePolicy({ mode: 'normal', maxRetry: 3 }), /unknown key "maxRetry"/);
  assert.throws(() => normalizePolicy({ mode: 'normal', backoff: { initialDelay: 3 } }), /unknown key "initialDelay"/);
});

test('normalizePolicy rejects non-object input', () => {
  assert.throws(() => normalizePolicy('normal'), /must be an object/);
  assert.throws(() => normalizePolicy(null), /must be an object/);
  assert.throws(() => normalizePolicy([]), /must be an object/);
});

// ---------------------------------------------------------------------------
// getPath
// ---------------------------------------------------------------------------

test('getPath reads own properties along a path', () => {
  assert.equal(getPath({ a: { b: { c: 7 } } }, ['a', 'b', 'c']), 7);
  assert.deepEqual(getPath({ a: 1 }, []), { a: 1 });
});

test('getPath returns undefined for an absent path and never traverses the prototype', () => {
  assert.equal(getPath({ a: {} }, ['a', 'b']), undefined);
  assert.equal(getPath({}, ['toString']), undefined);
  assert.equal(getPath({ a: {} }, ['a', 'constructor']), undefined);
  assert.equal(getPath(undefined, ['a']), undefined);
});

// ---------------------------------------------------------------------------
// path operations
// ---------------------------------------------------------------------------

test('policyOperation addresses only retryPolicy beneath the provider settings path', () => {
  const operation = policyOperation(['providers', 'cpa'], { mode: 'normal', maxRetries: 3 });
  assert.deepEqual(operation.path, ['providers', 'cpa', 'retryPolicy']);
  assert.equal(operation.op, 'set');
  assert.equal(operation.value.maxRetries, 3);
  assert.deepEqual(operation.value.retryableCodes, DEFAULT_CODES);
});

test('policyOperation normalizes the policy it carries', () => {
  assert.throws(() => policyOperation([], { mode: 'normal', maxRetries: -2 }), /maxRetries/);
});

test('resetOperation unsets only the retryPolicy field', () => {
  assert.deepEqual(resetOperation(['providers', 'cpa']), { op: 'unset', path: ['providers', 'cpa', 'retryPolicy'] });
  assert.deepEqual(resetOperation([]), { op: 'unset', path: ['retryPolicy'] });
});

// ---------------------------------------------------------------------------
// buildProviderRows
// ---------------------------------------------------------------------------

const DIRECTORY = [
  { provider: 'cpa', displayName: 'CPA', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'cpa'] },
  { provider: 'openai', displayName: 'OpenAI', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'openai'] },
  { provider: 'dormant', displayName: 'Dormant', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'dormant'] },
  { provider: 'deepseek-official', displayName: 'DeepSeek', settingsNs: 'llm-deepseek', settingsPath: [] },
];

test('buildProviderRows returns configured routes using the native namespace and path', () => {
  const namespaces = [
    namespaceView('llm-pi-ai', providerDictSchema(), {
      value: { providers: { cpa: { baseURL: 'https://gateway.example/v1' } } },
      revision: 4,
    }),
    namespaceView('llm-deepseek', wholeSectionSchema(), { value: {}, revision: 2 }),
  ];
  const rows = buildProviderRows(DIRECTORY, namespaces);
  const cpa = rows.find((row) => row.provider === 'cpa');
  assert.equal(cpa.ns, 'llm-pi-ai');
  assert.deepEqual(cpa.settingsPath, ['providers', 'cpa']);
  assert.equal(cpa.revision, 4);
  assert.equal(cpa.editable, true);
  assert.equal(cpa.overridden, false);
  assert.deepEqual(cpa.policy, {
    mode: 'normal',
    maxRetries: 5,
    retryableCodes: DEFAULT_CODES,
    backoff: { initialDelayMs: 500, maxDelayMs: 10000, jitterRatio: 0.1 },
  });
});

test('buildProviderRows includes a whole-section provider whose settings path is empty', () => {
  const rows = buildProviderRows(
    DIRECTORY,
    [namespaceView('llm-deepseek', wholeSectionSchema(), { value: {}, revision: 2 })],
  );
  const row = rows.find((candidate) => candidate.provider === 'deepseek-official');
  assert.equal(row.editable, true);
  assert.deepEqual(row.settingsPath, []);
  assert.equal(row.revision, 2);
});

test('buildProviderRows omits routes that are not configured', () => {
  const rows = buildProviderRows(
    DIRECTORY,
    [namespaceView('llm-pi-ai', providerDictSchema(), { value: { providers: { cpa: {} } } })],
  );
  assert.deepEqual(rows.map((row) => row.provider), ['cpa']);
});

test('buildProviderRows omits a provider whose namespace is missing', () => {
  const rows = buildProviderRows(DIRECTORY, []);
  assert.deepEqual(rows, []);
});

test('buildProviderRows reports the effective user policy and marks it overridden', () => {
  const namespaces = [
    namespaceView('llm-pi-ai', providerDictSchema(), {
      value: { providers: { cpa: { retryPolicy: { mode: 'normal', maxRetries: 20, backoff: { initialDelayMs: 2000, maxDelayMs: 60000 } } } } },
      user: { providers: { cpa: { retryPolicy: { mode: 'normal', maxRetries: 20 } } } },
    }),
  ];
  const row = buildProviderRows(DIRECTORY, namespaces).find((candidate) => candidate.provider === 'cpa');
  assert.equal(row.overridden, true);
  assert.equal(row.policy.maxRetries, 20);
  assert.deepEqual(row.policy.backoff, { initialDelayMs: 2000, maxDelayMs: 60000, jitterRatio: 0.1 });
});

test('buildProviderRows never reports a route without native retry schema support as editable', () => {
  const namespaces = [
    namespaceView('llm-pi-ai', schemaWithoutRetryPolicy(), { value: { providers: { cpa: { baseURL: 'https://x.example' } } } }),
  ];
  const row = buildProviderRows(DIRECTORY, namespaces).find((candidate) => candidate.provider === 'cpa');
  assert.equal(row.editable, false);
  assert.match(row.reason, /retry/i);
});

test('buildProviderRows turns an invalid stored policy into a reason instead of throwing', () => {
  const namespaces = [
    namespaceView('llm-pi-ai', providerDictSchema(), {
      value: { providers: { cpa: { retryPolicy: { mode: 'normal', maxRetries: -5 } } } },
    }),
  ];
  const row = buildProviderRows(DIRECTORY, namespaces).find((candidate) => candidate.provider === 'cpa');
  assert.equal(row.editable, false);
  assert.match(row.reason, /maxRetries/);
});

test('buildProviderRows exposes no credential, header, or unrelated config values', () => {
  const namespaces = [
    namespaceView('llm-pi-ai', providerDictSchema(), {
      value: {
        providers: {
          cpa: {
            retryPolicy: { mode: 'normal', maxRetries: 7 },
            apiKeyEnv: 'CPA_API_KEY',
            headers: { 'X-Secret': 'super-secret-value' },
            models: [{ id: 'secret-model' }],
          },
        },
      },
    }),
  ];
  const row = buildProviderRows(DIRECTORY, namespaces).find((candidate) => candidate.provider === 'cpa');
  const serialized = JSON.stringify(row);
  assert.equal(serialized.includes('super-secret-value'), false);
  assert.equal(serialized.includes('CPA_API_KEY'), false);
  assert.equal(serialized.includes('secret-model'), false);
  assert.deepEqual(Object.keys(row).sort(), ['displayName', 'editable', 'ns', 'overridden', 'policy', 'provider', 'revision', 'settingsPath'].sort());
});

test('buildProviderRows accepts namespace views keyed by namespace as well as a list', () => {
  const view = namespaceView('llm-pi-ai', providerDictSchema(), { value: { providers: { cpa: {} } }, revision: 9 });
  const fromMap = buildProviderRows(DIRECTORY, new Map([['llm-pi-ai', view]]));
  const fromList = buildProviderRows(DIRECTORY, [view]);
  assert.deepEqual(fromMap, fromList);
  assert.equal(fromMap[0].revision, 9);
});

test('buildProviderRows defaults a directory entry without an explicit settings path to the section root', () => {
  const rows = buildProviderRows(
    [{ provider: 'deepseek-official', displayName: 'DeepSeek', settingsNs: 'llm-deepseek' }],
    [namespaceView('llm-deepseek', wholeSectionSchema(), { value: {}, revision: 1 })],
  );
  assert.deepEqual(rows[0].settingsPath, []);
});

// ---------------------------------------------------------------------------
// Settings wire schema (Schemastery `{uid, refs}`)
// ---------------------------------------------------------------------------

test('buildProviderRows reads the captured Settings wire schema for a provider dictionary', () => {
  const namespaces = [
    namespaceView('llm-pi-ai', CAPTURED_WIRE_SCHEMA, { value: { providers: { cpa: { baseURL: 'https://cpa.example/v1' } } }, revision: 7 }),
  ];
  const rows = buildProviderRows(DIRECTORY, namespaces);
  const cpa = rows.find((row) => row.provider === 'cpa');
  assert.equal(cpa.editable, true);
  assert.equal(cpa.reason, undefined);
  assert.equal(cpa.revision, 7);
  assert.equal(cpa.overridden, false);
  assert.deepEqual(cpa.policy, {
    mode: 'normal',
    maxRetries: 5,
    retryableCodes: DEFAULT_CODES,
    backoff: { initialDelayMs: 500, maxDelayMs: 10000, jitterRatio: 0.1 },
  });
});

test('buildProviderRows reads an overridden policy through the captured wire schema', () => {
  const namespaces = [
    namespaceView('llm-pi-ai', CAPTURED_WIRE_SCHEMA, {
      value: { providers: { cpa: { retryPolicy: { mode: 'always' } } } },
      user: { providers: { cpa: { retryPolicy: { mode: 'always' } } } },
    }),
  ];
  const row = buildProviderRows(DIRECTORY, namespaces).find((candidate) => candidate.provider === 'cpa');
  assert.equal(row.editable, true);
  assert.equal(row.overridden, true);
  assert.equal(row.policy.mode, 'always');
});

test('buildProviderRows reads a whole-section provider through a wire schema', () => {
  const rows = buildProviderRows(
    [{ provider: 'deepseek-official', displayName: 'DeepSeek', settingsNs: 'llm-deepseek' }],
    [namespaceView('llm-deepseek', WIRE_WHOLE_SECTION_SCHEMA, { value: {}, revision: 4 })],
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].editable, true);
  assert.equal(rows[0].revision, 4);
});

test('buildProviderRows still omits an unconfigured route read through a wire schema', () => {
  const namespaces = [namespaceView('llm-pi-ai', CAPTURED_WIRE_SCHEMA, { value: { providers: { cpa: {} } } })];
  assert.deepEqual(buildProviderRows(DIRECTORY, namespaces).map((row) => row.provider), ['cpa']);
});

test('buildProviderRows refuses to call a wire schema editable when it declares no retryPolicy', () => {
  const namespaces = [
    namespaceView('llm-pi-ai', WIRE_WITHOUT_RETRY_SCHEMA, { value: { providers: { cpa: { baseURL: 'https://cpa.example/v1' } } } }),
  ];
  const row = buildProviderRows(DIRECTORY, namespaces).find((candidate) => candidate.provider === 'cpa');
  assert.equal(row.editable, false);
  assert.match(row.reason, /retry/i);
});

test('buildProviderRows refuses a wire schema whose settings path does not resolve', () => {
  const namespaces = [
    namespaceView('llm-pi-ai', CAPTURED_WIRE_SCHEMA, { value: { providers: { cpa: {} }, wrong: { cpa: {} } } }),
  ];
  const rows = buildProviderRows(
    [{ provider: 'cpa', displayName: 'CPA', settingsNs: 'llm-pi-ai', settingsPath: ['wrong', 'cpa'] }],
    namespaces,
  );
  assert.equal(rows[0].editable, false);
  assert.match(rows[0].reason, /retry/i);
});

// ---------------------------------------------------------------------------
// global namespace and provider-sync summary
// ---------------------------------------------------------------------------

const GLOBAL_POLICY = { mode: 'normal', maxRetries: 20, backoff: { initialDelayMs: 500, maxDelayMs: 10000, jitterRatio: 0.1 } };

/** One provider row shaped exactly like `buildProviderRows` output. */
function syncRow(provider, policy, extra = {}) {
  return {
    provider,
    displayName: provider,
    ns: 'llm-pi-ai',
    settingsPath: ['providers', provider],
    revision: 0,
    policy: normalizePolicy(policy),
    overridden: false,
    editable: true,
    ...extra,
  };
}

test('GLOBAL_SETTINGS_NS names the plugin-owned settings namespace', () => {
  assert.equal(GLOBAL_SETTINGS_NS, 'dsh-retry-settings');
});

test('summarizeProviderSync reports every provider pending while no global policy is configured', () => {
  const rows = [syncRow('cpa', undefined), syncRow('openai', undefined)];
  const summary = summarizeProviderSync(undefined, rows);
  assert.equal(summary.total, 2);
  assert.equal(summary.synced, 0);
  assert.deepEqual(summary.pending.map((entry) => entry.provider), ['cpa', 'openai']);
  assert.match(summary.pending[0].reason, /no global policy/i);
});

test('summarizeProviderSync treats an explicit null policy as unconfigured', () => {
  const summary = summarizeProviderSync(null, [syncRow('cpa', undefined)]);
  assert.equal(summary.synced, 0);
  assert.match(summary.pending[0].reason, /no global policy/i);
});

test('summarizeProviderSync counts providers already carrying the global policy', () => {
  const rows = [syncRow('cpa', GLOBAL_POLICY), syncRow('openai', GLOBAL_POLICY)];
  const summary = summarizeProviderSync(GLOBAL_POLICY, rows);
  assert.equal(summary.total, 2);
  assert.equal(summary.synced, 2);
  assert.deepEqual(summary.pending, []);
});

test('summarizeProviderSync ignores retryable-code order when comparing', () => {
  const reordered = { ...GLOBAL_POLICY, retryableCodes: [...DEFAULT_CODES].reverse() };
  const summary = summarizeProviderSync(GLOBAL_POLICY, [syncRow('cpa', reordered)]);
  assert.equal(summary.synced, 1);
});

test('summarizeProviderSync lists only the providers that differ', () => {
  const rows = [syncRow('cpa', GLOBAL_POLICY), syncRow('openai', { mode: 'normal', maxRetries: 3 })];
  const summary = summarizeProviderSync(GLOBAL_POLICY, rows);
  assert.equal(summary.synced, 1);
  assert.deepEqual(summary.pending.map((entry) => entry.provider), ['openai']);
  assert.match(summary.pending[0].reason, /differs/i);
});

test('summarizeProviderSync compares always mode without retry fields', () => {
  const rows = [syncRow('cpa', { mode: 'always' }), syncRow('openai', { mode: 'normal' })];
  const summary = summarizeProviderSync({ mode: 'always' }, rows);
  assert.equal(summary.synced, 1);
  assert.deepEqual(summary.pending.map((entry) => entry.provider), ['openai']);
});

test('summarizeProviderSync reports unsupported providers with their own reason', () => {
  const rows = [
    syncRow('cpa', GLOBAL_POLICY),
    syncRow('openai', GLOBAL_POLICY, { editable: false, reason: 'provider "openai" declares no native retryPolicy' }),
  ];
  const summary = summarizeProviderSync(GLOBAL_POLICY, rows);
  assert.equal(summary.synced, 1);
  assert.deepEqual(summary.pending, [{ provider: 'openai', reason: 'provider "openai" declares no native retryPolicy' }]);
});

test('summarizeProviderSync reports an invalid global policy instead of throwing', () => {
  const summary = summarizeProviderSync({ mode: 'normal', maxRetries: -1 }, [syncRow('cpa', GLOBAL_POLICY)]);
  assert.equal(summary.synced, 0);
  assert.equal(summary.total, 1);
  assert.match(summary.pending[0].reason, /maxRetries/);
});

test('summarizeProviderSync handles an empty provider list', () => {
  assert.deepEqual(summarizeProviderSync(GLOBAL_POLICY, []), { total: 0, synced: 0, pending: [] });
  assert.deepEqual(summarizeProviderSync(undefined, []), { total: 0, synced: 0, pending: [] });
});

test('summarizeProviderSync applies a provider override before the global default', () => {
  const override = { mode: 'normal', maxRetries: 7, backoff: { initialDelayMs: 500, maxDelayMs: 10000, jitterRatio: 0.1 } };
  const rows = [syncRow('cpa', override), syncRow('openai', GLOBAL_POLICY)];
  const summary = summarizeProviderSync(GLOBAL_POLICY, rows, { cpa: override });
  assert.equal(summary.total, 2);
  assert.equal(summary.synced, 2);
  assert.deepEqual(summary.pending, []);
});

test('summarizeProviderSync leaves an overridden provider pending when it does not match its override', () => {
  const override = { mode: 'normal', maxRetries: 7, backoff: { initialDelayMs: 500, maxDelayMs: 10000, jitterRatio: 0.1 } };
  const rows = [syncRow('cpa', GLOBAL_POLICY), syncRow('openai', GLOBAL_POLICY)];
  const summary = summarizeProviderSync(GLOBAL_POLICY, rows, { cpa: override });
  assert.equal(summary.synced, 1);
  assert.deepEqual(summary.pending.map((entry) => entry.provider), ['cpa']);
  assert.match(summary.pending[0].reason, /override/);
});

