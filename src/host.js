/**
 * Host half of the retry-settings plugin: one global desired policy, its native
 * Config field, automatic provider synchronization, and the `retry_policy` tool.
 *
 * The plugin owns exactly one setting. Every provider's own native `retryPolicy`
 * is derived state that the synchronizer writes through the native settings
 * service; the native retry executor is never replaced.
 *
 * @module dsh-retry-settings/host
 */

import z from '@deepseek-ai/schemastery';

import {
  GLOBAL_SETTINGS_NS,
  buildProviderRows,
  effectivePolicyFor,
  getPath,
  hasProviderOverride,
  normalizePolicy,
  summarizeProviderSync,
} from './policy.js';
import { createProviderSync } from './global-sync.js';

/** Loader plugin name. */
export const name = 'dsh-retry-settings';

/** The tool registry is the only hard dependency; other services are optional. */
export const inject = ['tools'];

const TOOL_NAME = 'retry_policy';
const ACTIONS = ['list', 'get', 'set', 'reset'];
const MUTATING_ACTIONS = new Set(['set', 'reset']);
const ARGUMENT_KEYS = new Set(['action', 'expectedRevision', 'policy', 'provider']);

/** Largest delay the native policy schema admits. */
const MAX_TIMER_DELAY_MS = 2147483647;

const DEFAULT_RETRYABLE_CODES = ['EMPTY_RESPONSE', 'RATE_LIMIT', 'SERVER', 'TIMEOUT', 'TRANSPORT'];

const backoffSchema = z.object({
  initialDelayMs: z.number().max(MAX_TIMER_DELAY_MS).default(500),
  maxDelayMs: z.number().max(MAX_TIMER_DELAY_MS).default(10000),
  jitterRatio: z.number().min(0).max(1).default(0.1),
});

/** Mirror of the native retry-policy shape, so this Config validates like a provider's. */
const retryPolicySchema = z.union([
  z.object({
    mode: z.const('normal').required(),
    maxRetries: z.number().step(1).min(0).max(Number.MAX_SAFE_INTEGER).default(5),
    retryableCodes: z.array(z.string()).default(DEFAULT_RETRYABLE_CODES),
    backoff: backoffSchema,
  }),
  z.object({
    mode: z.const('always').required(),
    backoff: backoffSchema,
  }),
]);

/**
 * The one user-owned setting. Left optional and volatile: absent means inactive,
 * and the value stays readable live through `.get()` without remounting.
 */
export const Config = z.object({
  policy: retryPolicySchema.volatile(),
  providers: z.dict(retryPolicySchema).volatile(),
});

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

const POLICY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    mode: { type: 'string', enum: ['normal', 'always'], description: '"normal" retries a bounded set of eligible failures; "always" retries every failure until success, cancellation, or unload.' },
    maxRetries: { type: 'integer', description: 'Retries after the initial request; 0 disables ordinary retries. Ignored by always mode.' },
    retryableCodes: { type: 'array', items: { type: 'string' }, description: 'The complete set of failure codes to retry, replacing the defaults (EMPTY_RESPONSE, RATE_LIMIT, SERVER, TIMEOUT, TRANSPORT). Ignored by always mode.' },
    backoff: {
      type: 'object',
      additionalProperties: false,
      properties: {
        initialDelayMs: { type: 'number', description: 'Delay before the first retry, in milliseconds.' },
        maxDelayMs: { type: 'number', description: 'Upper bound on the exponential backoff, in milliseconds.' },
        jitterRatio: { type: 'number', description: 'Symmetric jitter as a fraction of the delay, from 0 to 1.' },
      },
    },
  },
};

const PENDING_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['provider', 'reason'],
  properties: { provider: { type: 'string' }, reason: { type: 'string' } },
};

const APPLIED_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['written', 'namespaces'],
  properties: {
    written: { type: 'integer' },
    namespaces: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['ns', 'status'],
        properties: {
          ns: { type: 'string' },
          status: { type: 'string' },
          changed: { type: 'integer' },
          error: { type: 'string' },
        },
      },
    },
  },
};

const PARAMETERS = {
  type: 'object',
  additionalProperties: false,
  required: ['action'],
  properties: {
    action: { type: 'string', enum: ACTIONS, description: 'list the effective retry policies and sync state, get them, set a policy, or reset a policy to the inherited value.' },
    expectedRevision: { type: 'integer', description: 'The revision `list` or `get` reported. Required for set and reset; a write is refused when the settings changed since that read.' },
    provider: { type: 'string', description: 'Optional provider id. When supplied, set/reset addresses only that provider override; when omitted, set/reset addresses the global default every provider follows unless overridden.' },
    policy: { ...clone(POLICY_SCHEMA), required: ['mode'], description: 'The next retry policy. `mode` is required.' },
  },
};

const PROVIDER_STATE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['provider', 'displayName', 'override', 'editable', 'synced', 'policy'],
  properties: {
    provider: { type: 'string' },
    displayName: { type: 'string' },
    override: { type: 'boolean' },
    editable: { type: 'boolean' },
    synced: { type: 'boolean' },
    reason: { type: 'string' },
    policy: clone(POLICY_SCHEMA),
  },
};

const OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['action'],
  properties: {
    action: { type: 'string' },
    configured: { type: 'boolean' },
    writable: { type: 'boolean' },
    revision: { type: 'integer' },
    policy: clone(POLICY_SCHEMA),
    providers: { type: 'array', items: clone(PROVIDER_STATE_SCHEMA) },
    total: { type: 'integer' },
    synced: { type: 'integer' },
    pending: { type: 'array', items: clone(PENDING_SCHEMA) },
    applied: clone(APPLIED_SCHEMA),
  },
};

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function messageOf(error) {
  return error instanceof Error ? error.message : String(error);
}

function codeOf(error) {
  if (error === null || typeof error !== 'object') return undefined;
  return typeof error.code === 'string' ? error.code : undefined;
}

/** Read the live desired policy from the volatile Config field. */
function readLivePolicy(config) {
  const field = config?.policy;
  if (field === null || field === undefined) return undefined;
  return typeof field.get === 'function' ? field.get() : field;
}

/** Read the live per-provider overrides from the volatile Config field. */
function readLiveOverrides(config) {
  const field = config?.providers;
  if (field === null || field === undefined) return {};
  const value = typeof field.get === 'function' ? field.get() : field;
  return value === null || value === undefined ? {} : value;
}

function viewOf(described, ns) {
  const views = Array.isArray(described?.namespaces) ? described.namespaces : [];
  return views.find((view) => view?.ns === ns);
}

function readAction(args) {
  if (!isPlainObject(args)) throw new Error(`${TOOL_NAME}: arguments must be an object`);
  for (const key of Object.keys(args)) {
    if (!ARGUMENT_KEYS.has(key)) {
      throw new Error(`${TOOL_NAME}: unsupported argument ${JSON.stringify(key)}`);
    }
  }
  const action = args.action;
  if (typeof action !== 'string' || !ACTIONS.includes(action)) {
    throw new Error(`${TOOL_NAME}: action must be one of ${ACTIONS.join(', ')}`);
  }
  return action;
}

function requireExpectedRevision(args) {
  const expectedRevision = args.expectedRevision;
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
    throw new Error(`${TOOL_NAME}: expectedRevision is required and must be the non-negative integer returned by the latest ${TOOL_NAME} read`);
  }
  return expectedRevision;
}

/** The plugin-owned Config fields. Provider native paths use `policyOperation` instead. */
const GLOBAL_POLICY_PATH = ['policy'];

/** Validate the optional provider argument naming one override entry. */
function readProvider(args) {
  const provider = args.provider;
  if (provider === undefined) return undefined;
  if (typeof provider !== 'string' || provider.trim() === '' || provider.includes('\0')) {
    throw new Error(`${TOOL_NAME}: provider must be a non-empty string when supplied`);
  }
  return provider.trim();
}

/**
 * Build the write operation against this plugin's own Config.
 *
 * `set` must carry its own policy: an omitted policy would otherwise normalize to
 * the native defaults and silently replace the desired policy. Use `reset` to
 * remove the desired policy deliberately. A provider argument addresses that
 * provider's override; without it the operation addresses the global default.
 */
function desiredOperation(args) {
  const provider = readProvider(args);
  const path = provider === undefined ? [...GLOBAL_POLICY_PATH] : ['providers', provider];
  if (args.action === 'reset') return { op: 'unset', path };
  if (args.policy === undefined) {
    throw new Error(`${TOOL_NAME}: set requires an explicit policy object; use reset to remove the ${provider === undefined ? 'global policy' : `override for provider "${provider}"`}`);
  }
  return { op: 'set', path, value: normalizePolicy(args.policy) };
}

/**
 * The calling session's own sandbox mode, which is separate from whether this
 * deployment's settings document is writable.
 */
function sessionSandboxMode(ctx, agent) {
  const sandboxPolicy = ctx.get('sandboxPolicy');
  if (typeof sandboxPolicy?.resolve !== 'function') return undefined;
  return sandboxPolicy.resolve(agent?.session === undefined ? {} : { session: agent.session })?.mode;
}

function assertNotCancelled(exec) {
  if (exec?.signal?.aborted === true) {
    throw new Error(`${TOOL_NAME}: the call was cancelled, so no policy was written`);
  }
}

/**
 * Whether plan mode currently governs the calling agent.
 *
 * Plan mode is agent-scoped: a service mounted on the host plane throws when
 * asked about an agent whose own composition never mounted it. Resolving through
 * the agent's preset mount is therefore authoritative, and `undefined` there is a
 * positive answer — this agent mounts no plan mode, which must not block a write.
 * The host plane is only consulted when no preset registry is mounted at all, and
 * that lookup is deliberately not caught: an unknown scope must fail closed.
 */
function isPlanning(ctx, agent) {
  const presets = ctx.get('agentPresets');
  if (typeof presets?.serviceFor === 'function') {
    const scoped = presets.serviceFor(agent, 'planMode');
    return scoped === undefined ? false : scoped.get(agent)?.active === true;
  }
  const host = ctx.get('planMode');
  if (host === undefined) return false;
  return host.get(agent)?.active === true;
}

function guardMutation(ctx, exec, described, args) {
  assertNotCancelled(exec);
  const expectedRevision = requireExpectedRevision(args);
  const operation = desiredOperation(args);
  if (viewOf(described, GLOBAL_SETTINGS_NS) === undefined) {
    throw new Error(`${TOOL_NAME}: this plugin's own settings namespace is unavailable, so the global policy cannot be written`);
  }
  if (described?.writable !== true) {
    throw new Error(`${TOOL_NAME}: this deployment serves a read-only settings document, so the global policy cannot be written`);
  }
  const agent = exec?.agent;
  if (agent === undefined) {
    throw new Error(`${TOOL_NAME}: a calling agent is required to change configuration`);
  }
  if (sessionSandboxMode(ctx, agent) === 'read-only') {
    throw new Error(`${TOOL_NAME}: this session runs in read-only sandbox mode, so configuration cannot be changed`);
  }
  if (isPlanning(ctx, agent)) {
    throw new Error(`${TOOL_NAME}: plan mode is active for this session, so configuration cannot be changed; present the plan first`);
  }
  // This guard is synchronous, so this is the last point before the write at which
  // an already-cancelled call can be refused.
  assertNotCancelled(exec);
  return { expectedRevision, operation };
}

function mutationFailure(expectedRevision, error) {
  if (codeOf(error) === 'settings/conflict') {
    return new Error(`${TOOL_NAME}: the global policy was not written because the settings changed since revision ${expectedRevision}. Run ${TOOL_NAME} list again and retry with the new revision.`);
  }
  return new Error(`${TOOL_NAME}: the global policy was rejected: ${messageOf(error)}`);
}

function summarizeApplied(report) {
  return {
    written: report.written,
    namespaces: (Array.isArray(report.namespaces) ? report.namespaces : []).map((entry) => ({
      ns: entry.ns,
      status: entry.status,
      ...entry.changed === undefined ? {} : { changed: entry.changed },
      ...entry.error === undefined ? {} : { error: entry.error },
    })),
  };
}

/** Read the global policy, overrides, and the derived provider-sync state. */
function readState(described, rows) {
  const globalView = viewOf(described, GLOBAL_SETTINGS_NS);
  const effective = getPath(globalView?.value, ['policy']);
  const overrides = getPath(globalView?.value, ['providers']) ?? {};
  const summary = summarizeProviderSync(effective, rows, overrides);
  const providers = (Array.isArray(rows) ? rows : []).map((row) => {
    const desired = effectivePolicyFor(effective, overrides, row.provider);
    const one = summarizeProviderSync(desired, [row]);
    return {
      provider: row.provider,
      displayName: row.displayName,
      override: hasProviderOverride(overrides, row.provider),
      editable: row.editable === true,
      synced: one.synced === 1,
      reason: one.pending[0]?.reason ?? null,
      policy: normalizePolicy(desired),
    };
  });
  return {
    configured: effective !== undefined,
    writable: described?.writable === true,
    revision: Number.isSafeInteger(globalView?.revision) ? globalView.revision : 0,
    policy: normalizePolicy(effective),
    providers,
    total: summary.total,
    synced: summary.synced,
    pending: summary.pending,
  };
}

async function execute(ctx, sync, args, exec) {
  const action = readAction(args);
  const described = await ctx.settingsController.describe();
  if (!MUTATING_ACTIONS.has(action)) {
    const directory = await ctx.llm.listConfigurableProviders();
    const rows = buildProviderRows(directory, described?.namespaces);
    return { action, ...readState(described, rows) };
  }
  // The settings read above awaited; a cancellation during it must still write nothing.
  assertNotCancelled(exec);
  const { expectedRevision, operation } = guardMutation(ctx, exec, described, args);
  let written;
  try {
    written = await ctx.settingsController.mutate(GLOBAL_SETTINGS_NS, [operation], expectedRevision);
  } catch (error) {
    throw mutationFailure(expectedRevision, error);
  }
  // The settings write resolves only after Loader reconciliation, so the live
  // Config field already carries the new value and this pass applies it.
  const report = await sync.reconcile();
  const directory = await ctx.llm.listConfigurableProviders();
  const describedAfter = await ctx.settingsController.describe();
  const rows = buildProviderRows(directory, describedAfter?.namespaces);
  return {
    action,
    ...readState(describedAfter, rows),
    revision: Number.isSafeInteger(written?.revision) ? written.revision : expectedRevision,
    applied: summarizeApplied(report),
  };
}

function describePolicy(policy) {
  if (!isPlainObject(policy)) return 'unknown policy';
  const backoff = `${policy.backoff?.initialDelayMs ?? 'default'}ms..${policy.backoff?.maxDelayMs ?? 'default'}ms`;
  if (policy.mode === 'always') return `always retry, backoff ${backoff}`;
  return `normal retry, maxRetries ${policy.maxRetries}, codes [${(policy.retryableCodes ?? []).join(', ')}], backoff ${backoff}`;
}

function renderResult(_args, value) {
  if (!isPlainObject(value)) return [{ type: 'text', text: 'No retry-policy result.' }];
  const lines = [value.configured === true ? `Global retry policy: ${describePolicy(value.policy)}` : 'No global retry policy is configured.'];
  // The revision is what the next write must quote, so a read has to report it too.
  if (Number.isSafeInteger(value.revision)) lines.push(`Global settings revision: ${value.revision}`);
  for (const entry of value.providers ?? []) {
    lines.push(`- ${entry.displayName} (${entry.provider}): ${entry.override === true ? 'override' : 'global'}, ${entry.synced === true ? 'synced' : 'pending'}${entry.reason === null || entry.reason === undefined ? '' : ` (${entry.reason})`}, ${describePolicy(entry.policy)}`);
  }
  if (Number.isSafeInteger(value.total)) {
    lines.push(`Providers in sync: ${value.synced}/${value.total}.`);
    for (const entry of value.pending ?? []) lines.push(`- ${entry.provider}: ${entry.reason}`);
  }
  if (value.applied !== undefined) {
    lines.push(`Applied to ${value.applied.written} provider path(s).`);
    for (const entry of value.applied.namespaces ?? []) {
      lines.push(`- ${entry.ns}: ${entry.status}${entry.error === undefined ? '' : ` (${entry.error})`}`);
    }
  }
  return [{ type: 'text', text: lines.join('\n') }];
}

function createRetryPolicyTool(ctx, sync) {
  return {
    name: TOOL_NAME,
    description: 'Read and change the global default retry policy and optional per-provider overrides. Without `provider`, `set`/`reset` address the global default that every provider follows unless overridden. With `provider`, they address only that provider override; providers without an override follow the global default. New providers receive the global default when one is configured.',
    parameters: PARAMETERS,
    output: { schema: OUTPUT_SCHEMA, render: renderResult },
    // Reads may overlap; a write is exclusive because it targets shared configuration.
    isConcurrencySafe: (args) => args?.action === 'list' || args?.action === 'get',
    execute: (args, exec) => execute(ctx, sync, args, exec),
  };
}

/**
 * Register the `retry_policy` tool and the provider synchronizer.
 *
 * Synchronization is inert until a global policy is configured: an unconfigured
 * plugin performs no settings read and no provider write. Once configured, the
 * same coalesced pass runs at mount, on settings changes, and on provider
 * topology changes, which is how a provider added later receives the policy.
 *
 * @param ctx - the plugin's context.
 * @param config - validated plugin Config; `config.policy` carries the global default and
 *   `config.providers` carries optional per-provider overrides.
 */
export function apply(ctx, config = {}) {
  const sync = createProviderSync(ctx, {
    readDesiredPolicy: () => readLivePolicy(config),
    readProviderOverrides: () => readLiveOverrides(config),
  });
  ctx.effect(() => () => sync.dispose(), 'dsh-retry-settings: stop provider synchronization');
  ctx.inject(['tools', 'llm', 'settingsController'], (scope) => {
    scope.effect(() => {
      const disposers = [
        scope.on('llm/adapters-updated', () => sync.notifyChange()),
        scope.on('settings/document-updated', () => sync.notifyChange()),
      ];
      return () => {
        for (const dispose of disposers) dispose();
      };
    }, 'dsh-retry-settings: reconcile on settings and provider changes');
    scope.tools.register(createRetryPolicyTool(scope, sync));
    sync.notifyChange();
  });
}
