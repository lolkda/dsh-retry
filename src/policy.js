/**
 * Browser-safe retry-policy model shared by the Settings page and the Host tool.
 *
 * The native provider `retryPolicy` is the only persistent state: everything here
 * validates, reads, and addresses that value. Nothing in this module performs I/O,
 * stores a copy of a policy, or reaches a Harness service.
 *
 * @module dsh-retry-settings/policy
 */

/** Native retry mode with a finite attempt budget. */
const MODE_NORMAL = 'normal';
/** Native retry mode that keeps retrying until success, cancellation, or disposal. */
const MODE_ALWAYS = 'always';

/** Largest delay the Harness timer accepts, mirrored from the native policy schema. */
const MAX_TIMER_DELAY_MS = 2147483647;

/** Error codes the native normal policy retries when the provider declares none. */
const DEFAULT_RETRYABLE_CODES = Object.freeze([
  'EMPTY_RESPONSE',
  'RATE_LIMIT',
  'SERVER',
  'TIMEOUT',
  'TRANSPORT',
]);

const DEFAULT_BACKOFF = Object.freeze({ initialDelayMs: 500, maxDelayMs: 10000, jitterRatio: 0.1 });

/**
 * The native default normal policy, for callers that need a baseline without
 * calling {@link normalizePolicy}. Frozen: use `normalizePolicy(undefined)` for a
 * detached clone.
 */
export const DEFAULT_POLICY = Object.freeze({
  mode: MODE_NORMAL,
  maxRetries: 5,
  retryableCodes: DEFAULT_RETRYABLE_CODES,
  backoff: DEFAULT_BACKOFF,
});

const NORMAL_KEYS = new Set(['mode', 'maxRetries', 'retryableCodes', 'backoff']);
const ALWAYS_KEYS = new Set(['mode', 'maxRetries', 'retryableCodes', 'backoff']);
const BACKOFF_KEYS = new Set(['initialDelayMs', 'maxDelayMs', 'jitterRatio']);

/** Native normal-mode fields this module resolves, in the order it reports them. */
const NORMAL_POLICY_FIELDS = { maxRetries: 5, retryableCodes: DEFAULT_RETRYABLE_CODES };

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertKnownKeys(value, allowed, path) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new Error(`${path}: unknown key ${JSON.stringify(key)}`);
  }
}

function resolveBackoff(config, path) {
  if (config !== undefined && !isPlainObject(config)) throw new Error(`${path} must be an object or undefined`);
  if (config !== undefined) assertKnownKeys(config, BACKOFF_KEYS, path);
  const initialDelayMs = config?.initialDelayMs ?? DEFAULT_BACKOFF.initialDelayMs;
  const maxDelayMs = config?.maxDelayMs ?? DEFAULT_BACKOFF.maxDelayMs;
  const jitterRatio = config?.jitterRatio ?? DEFAULT_BACKOFF.jitterRatio;
  if (!Number.isFinite(initialDelayMs) || initialDelayMs <= 0 || initialDelayMs > MAX_TIMER_DELAY_MS) {
    throw new Error(`${path}.initialDelayMs must be a positive finite number no greater than ${MAX_TIMER_DELAY_MS}`);
  }
  if (!Number.isFinite(maxDelayMs) || maxDelayMs <= 0 || maxDelayMs > MAX_TIMER_DELAY_MS) {
    throw new Error(`${path}.maxDelayMs must be a positive finite number no greater than ${MAX_TIMER_DELAY_MS}`);
  }
  if (initialDelayMs > maxDelayMs) {
    throw new Error(`${path}.initialDelayMs must be less than or equal to maxDelayMs`);
  }
  if (typeof jitterRatio !== 'number' || !Number.isFinite(jitterRatio) || jitterRatio < 0 || jitterRatio > 1) {
    throw new Error(`${path}.jitterRatio must be between 0 and 1`);
  }
  return { initialDelayMs, maxDelayMs, jitterRatio };
}

function resolveRetryableCodes(value) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error('policy.retryableCodes must not be empty');
  }
  for (const code of value) {
    if (typeof code !== 'string' || code.trim().length === 0) {
      throw new Error('policy.retryableCodes must contain only non-blank strings');
    }
  }
  if (new Set(value).size !== value.length) {
    throw new Error('policy.retryableCodes must not contain duplicates');
  }
  // Preserved verbatim: custom codes are opaque provider vocabulary, never rewritten.
  return [...value];
}

/**
 * Validate one native raw retry policy and detach it from the caller's object.
 *
 * `undefined` selects the native normal defaults. Missing optional fields resolve
 * to those same defaults. Custom error codes are preserved exactly; unknown keys
 * are rejected rather than silently persisted, because the native schema rejects
 * them on write anyway.
 *
 * @param value - native raw policy, or `undefined` for the native defaults.
 * @returns a detached native raw policy: `mode` + `maxRetries` + `retryableCodes` + `backoff`
 *   for normal, `mode` + `backoff` for always.
 * @throws {Error} when a field is missing, malformed, or out of the native bounds.
 */
export function normalizePolicy(value) {
  if (value === undefined) {
    return {
      mode: MODE_NORMAL,
      maxRetries: DEFAULT_POLICY.maxRetries,
      retryableCodes: [...DEFAULT_POLICY.retryableCodes],
      backoff: { ...DEFAULT_BACKOFF },
    };
  }
  if (!isPlainObject(value)) throw new Error('policy must be an object or undefined');
  const mode = value.mode;
  if (mode !== MODE_NORMAL && mode !== MODE_ALWAYS) {
    throw new Error('policy.mode must be "normal" or "always"');
  }
  if (mode === MODE_ALWAYS) {
    // Always mode ignores retries and codes; the native schema accepts those two keys here.
    assertKnownKeys(value, ALWAYS_KEYS, 'policy');
    return { mode, backoff: resolveBackoff(value.backoff, 'policy.backoff') };
  }
  assertKnownKeys(value, NORMAL_KEYS, 'policy');
  const maxRetries = value.maxRetries ?? NORMAL_POLICY_FIELDS.maxRetries;
  if (!Number.isSafeInteger(maxRetries) || maxRetries < 0) {
    throw new Error('policy.maxRetries must be a non-negative safe integer');
  }
  const retryableCodes = value.retryableCodes === undefined
    ? [...DEFAULT_POLICY.retryableCodes]
    : resolveRetryableCodes(value.retryableCodes);
  return {
    mode,
    maxRetries,
    retryableCodes,
    backoff: resolveBackoff(value.backoff, 'policy.backoff'),
  };
}

/**
 * Read a value along an own-property path.
 * @param value - any value; non-objects end the walk.
 * @param path - property names, outermost first.
 * @returns the value at the path, or `undefined` when any step is absent.
 */
export function getPath(value, path) {
  let current = value;
  for (const key of path) {
    if (current === null || typeof current !== 'object') return undefined;
    if (!Object.prototype.hasOwnProperty.call(current, key)) return undefined;
    current = current[key];
  }
  return current;
}

/**
 * Build the native settings path op that writes one provider's retry policy.
 * @param settingsPath - the provider's path inside its namespace, `[]` for a whole-section provider.
 * @param policy - the next policy; normalized here so an invalid value never reaches the writer.
 * @returns a `set` path op addressing only `retryPolicy`.
 */
export function policyOperation(settingsPath, policy) {
  return {
    op: 'set',
    path: [...settingsPath, 'retryPolicy'],
    value: normalizePolicy(policy),
  };
}

/**
 * Build the native settings path op that removes one provider's stored retry policy,
 * restoring whatever the lower configuration layer supplies.
 * @param settingsPath - the provider's path inside its namespace.
 * @returns an `unset` path op addressing only `retryPolicy`.
 */
export function resetOperation(settingsPath) {
  return { op: 'unset', path: [...settingsPath, 'retryPolicy'] };
}

function indexNamespaces(namespaces) {
  const byNamespace = new Map();
  if (namespaces === undefined || namespaces === null) return byNamespace;
  const views = namespaces instanceof Map
    ? [...namespaces.values()]
    : Array.isArray(namespaces)
      ? namespaces
      : Object.values(namespaces);
  for (const view of views) {
    if (isPlainObject(view) && typeof view.ns === 'string') byNamespace.set(view.ns, view);
  }
  return byNamespace;
}

function resolveRef(root, node) {
  let current = node;
  const seen = new Set();
  while (isPlainObject(current) && typeof current.$ref === 'string') {
    const ref = current.$ref;
    if (!ref.startsWith('#/') || seen.has(ref)) return undefined;
    seen.add(ref);
    current = getPath(root, ref.slice(2).split('/'));
  }
  return current;
}

function isObjectTyped(node) {
  return node.type === 'object' || (Array.isArray(node.type) && node.type.includes('object'));
}

/**
 * Resolve a schema node to the object branch that describes properties.
 * Unions are searched for their first object branch, so a trailing
 * `loaderExpression` marker branch never wins over the real profile schema.
 */
function objectBranch(root, node, depth = 0) {
  if (depth > 16) return undefined;
  const resolved = resolveRef(root, node);
  if (!isPlainObject(resolved) || Array.isArray(resolved)) return undefined;
  if (isPlainObject(resolved.properties) || isPlainObject(resolved.additionalProperties) || isObjectTyped(resolved)) {
    return resolved;
  }
  for (const key of ['anyOf', 'oneOf']) {
    if (Array.isArray(resolved[key])) {
      for (const branch of resolved[key]) {
        const candidate = objectBranch(root, branch, depth + 1);
        if (candidate !== undefined) return candidate;
      }
      return undefined;
    }
  }
  return undefined;
}

function hasOwn(object, key) {
  return isPlainObject(object) && Object.prototype.hasOwnProperty.call(object, key);
}

/**
 * Whether a schema document is Schemastery's own serialization — the shape the
 * Settings service publishes — rather than a JSON Schema projection.
 */
function isWireSchema(schema) {
  return isPlainObject(schema) && typeof schema.uid === 'number' && isPlainObject(schema.refs);
}

/** Follow a numeric schema reference; an inline node is returned unchanged. */
function wireNode(root, node) {
  let current = node;
  const seen = new Set();
  while (typeof current === 'number') {
    if (seen.has(current)) return undefined;
    seen.add(current);
    current = root.refs[current];
  }
  return isPlainObject(current) ? current : undefined;
}

/** Consume one settings-path segment against one Schemastery node. */
function wireStep(root, node, segment) {
  const resolved = wireNode(root, node);
  if (resolved === undefined) return undefined;
  switch (resolved.type) {
    case 'object':
      // A named property of the object schema.
      return isPlainObject(resolved.dict) ? resolved.dict[segment] : undefined;
    case 'dict':
      // The segment is one arbitrary key, so it descends into the key schema.
      return resolved.inner;
    case 'lazy':
    case 'transform':
      return resolved.inner;
    case 'union':
    case 'intersect': {
      for (const branch of Array.isArray(resolved.list) ? resolved.list : []) {
        const next = wireStep(root, branch, segment);
        if (next !== undefined) return next;
      }
      return undefined;
    }
    default:
      return undefined;
  }
}

/** Whether a Schemastery node declares `field` itself, or on any union branch. */
function wireDeclaresField(root, node, field) {
  const resolved = wireNode(root, node);
  if (resolved === undefined) return false;
  switch (resolved.type) {
    case 'object':
      return isPlainObject(resolved.dict) && Object.prototype.hasOwnProperty.call(resolved.dict, field);
    case 'union':
    case 'intersect':
      return (Array.isArray(resolved.list) ? resolved.list : [])
        .some((branch) => wireDeclaresField(root, branch, field));
    case 'lazy':
    case 'transform':
      return wireDeclaresField(root, resolved.inner, field);
    default:
      return false;
  }
}

function wireSchemaSupportsField(schema, settingsPath, field) {
  let node = schema.uid;
  for (const segment of settingsPath) {
    node = wireStep(schema, node, segment);
    if (node === undefined) return false;
  }
  return wireDeclaresField(schema, node, field);
}

/**
 * Walk a Settings form schema down `settingsPath` and report whether the target
 * object declares `field`.
 *
 * The Settings service publishes Schemastery's own serialization — `{uid, refs}`
 * with numeric references — so that is the primary shape handled here. A JSON
 * Schema projection is also accepted, because configuration surfaces can hand
 * over one, and treating it as unsupported would silently report every provider
 * as read-only.
 *
 * Either way this reads the schema the caller actually holds rather than
 * assuming a provider family's shape: a provider dictionary resolves through its
 * key schema, while a whole-section provider resolves through the section root.
 */
function schemaSupportsField(schema, settingsPath, field) {
  if (isWireSchema(schema)) return wireSchemaSupportsField(schema, settingsPath, field);
  let node = objectBranch(schema, schema);
  for (const segment of settingsPath) {
    if (node === undefined) return false;
    const properties = isPlainObject(node.properties) ? node.properties : undefined;
    let next = properties !== undefined && Object.prototype.hasOwnProperty.call(properties, segment)
      ? properties[segment]
      : undefined;
    if (next === undefined) {
      const additional = objectBranch(schema, node.additionalProperties);
      if (additional === undefined) return false;
      next = hasOwn(additional.properties, segment) ? additional.properties[segment] : additional;
    }
    node = objectBranch(schema, next);
  }
  return node !== undefined && hasOwn(node.properties, field);
}

function pathLabel(settingsPath) {
  return settingsPath.length === 0 ? 'the section root' : `"${settingsPath.join('.')}"`;
}

function buildRow(provider, displayName, ns, settingsPath, view) {
  const row = {
    provider,
    displayName: typeof displayName === 'string' && displayName.length > 0 ? displayName : provider,
    ns,
    settingsPath,
    revision: Number.isSafeInteger(view.revision) ? view.revision : 0,
    policy: normalizePolicy(undefined),
    overridden: getPath(view.user, [...settingsPath, 'retryPolicy']) !== undefined,
    editable: true,
  };
  if (!schemaSupportsField(view.schema, settingsPath, 'retryPolicy')) {
    row.editable = false;
    row.reason = `provider "${provider}" declares no native retryPolicy at ${pathLabel(settingsPath)}`;
    return row;
  }
  try {
    row.policy = normalizePolicy(getPath(view.value, [...settingsPath, 'retryPolicy']));
  } catch (error) {
    row.editable = false;
    row.reason = `provider "${provider}" stores an invalid retryPolicy: ${error instanceof Error ? error.message : String(error)}`;
  }
  return row;
}

/**
 * Project the provider directory against the live Settings namespaces into
 * editable retry-policy rows.
 *
 * A row is produced only for a provider that exists in the directory *and* is
 * configured in the namespace it names — a dormant catalog route is not offered,
 * and a provider whose namespace is unavailable is omitted rather than shown with
 * fabricated state, because its revision and effective policy cannot be read.
 * Problems that leave a real row in place (no native retry schema, an unreadable
 * stored policy) keep the row and mark it non-editable with a reason.
 *
 * Rows carry no credential, header, or unrelated provider configuration.
 *
 * @param directory - provider directory entries: `{provider, displayName, settingsNs, settingsPath}`.
 * @param namespaces - Settings namespace views keyed by `ns` (a `Map` or a list of views).
 * @returns one row per configured provider, in directory order.
 */
export function buildProviderRows(directory, namespaces) {
  const byNamespace = indexNamespaces(namespaces);
  const rows = [];
  if (!Array.isArray(directory)) return rows;
  for (const entry of directory) {
    if (!isPlainObject(entry)) continue;
    const provider = entry.provider;
    if (typeof provider !== 'string' || provider.length === 0) continue;
    const ns = entry.settingsNs;
    if (typeof ns !== 'string' || ns.length === 0) continue;
    const view = byNamespace.get(ns);
    if (view === undefined) continue;
    const settingsPath = Array.isArray(entry.settingsPath) ? [...entry.settingsPath] : [];
    const configured = settingsPath.length === 0 || getPath(view.value, settingsPath) !== undefined;
    if (!configured) continue;
    rows.push(buildRow(provider, entry.displayName, ns, settingsPath, view));
  }
  return rows;
}

/** The plugin-owned Settings namespace carrying the one global desired policy. */
export const GLOBAL_SETTINGS_NS = 'dsh-retry-settings';

/** Whether two normalized policies would make the executor behave identically. */
function isSamePolicy(left, right) {
  if (left.mode !== right.mode) return false;
  if (left.mode === 'normal') {
    if (left.maxRetries !== right.maxRetries) return false;
    // Eligibility is set membership, so code order is not behaviour.
    const leftCodes = [...left.retryableCodes].sort();
    const rightCodes = [...right.retryableCodes].sort();
    if (leftCodes.length !== rightCodes.length) return false;
    for (let index = 0; index < leftCodes.length; index += 1) {
      if (leftCodes[index] !== rightCodes[index]) return false;
    }
  }
  return left.backoff.initialDelayMs === right.backoff.initialDelayMs
    && left.backoff.maxDelayMs === right.backoff.maxDelayMs
    && left.backoff.jitterRatio === right.backoff.jitterRatio;
}

function policyReason(error) {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Summarize how far the configured providers are from one desired global policy.
 *
 * This is a configuration observation: it compares the policy each provider's
 * configuration resolves to, which is the value a later request captures. It is
 * not proof of what an already running request is using, because an in-flight
 * request keeps the policy captured when it started.
 *
 * Never throws, so a hand-edited configuration value is reported through
 * `pending` reasons instead of breaking a surface that renders this.
 *
 * @param policy - the desired native raw policy; `undefined` or `null` means unconfigured.
 * @param rows - exactly the output of {@link buildProviderRows}.
 * @returns `{total, synced, pending}`, with a plain-text reason per unsynced provider.
 */
/**
 * Whether one provider carries its own desired policy instead of following the
 * global default.
 * @param overrides - provider id → raw retry policy map.
 * @param provider - provider id.
 * @returns true when the map owns a value for that provider, even if undefined.
 */
export function hasProviderOverride(overrides, provider) {
  return isPlainObject(overrides) && Object.prototype.hasOwnProperty.call(overrides, provider);
}

/**
 * The policy a provider should carry: its own override when configured, otherwise
 * the global default.
 * @param policy - the global raw policy, or `undefined`/`null` when unconfigured.
 * @param overrides - provider id → raw retry policy map.
 * @param provider - provider id.
 * @returns the raw policy that applies to that provider.
 */
export function effectivePolicyFor(policy, overrides, provider) {
  return hasProviderOverride(overrides, provider) ? overrides[provider] : policy;
}

/**
 * Summarize how far the configured providers are from the policies they should
 * carry.
 *
 * With no per-provider overrides this is the previous global summary. When
 * overrides are supplied they win over the global policy for the providers they
 * name; every other provider continues to follow the global policy. A provider
 * with no override and no global policy stays pending, exactly as before.
 *
 * @param policy - the desired global raw policy; `undefined` or `null` means unconfigured.
 * @param rows - exactly the output of {@link buildProviderRows}.
 * @param overrides - optional provider id → raw retry policy map.
 * @returns `{total, synced, pending}`, with a plain-text reason per unsynced provider.
 */
export function summarizeProviderSync(policy, rows, overrides) {
  const list = Array.isArray(rows) ? rows : [];
  const summary = { total: list.length, synced: 0, pending: [] };
  if (list.length === 0) return summary;
  for (const row of list) {
    if (row.editable !== true) {
      summary.pending.push({ provider: row.provider, reason: row.reason ?? 'this provider cannot hold a retry policy' });
      continue;
    }
    const overridden = hasProviderOverride(overrides, row.provider);
    const desiredRaw = overridden ? overrides[row.provider] : policy;
    if (desiredRaw === undefined || desiredRaw === null) {
      summary.pending.push({
        provider: row.provider,
        reason: overridden ? 'the provider override is not configured' : 'no global policy is configured',
      });
      continue;
    }
    let desired;
    try {
      desired = normalizePolicy(desiredRaw);
    } catch (error) {
      summary.pending.push({
        provider: row.provider,
        reason: overridden
          ? `the desired policy for provider "${row.provider}" is invalid: ${policyReason(error)}`
          : `the global policy is invalid: ${policyReason(error)}`,
      });
      continue;
    }
    let current;
    try {
      current = normalizePolicy(row.policy);
    } catch (error) {
      summary.pending.push({ provider: row.provider, reason: `the provider policy is invalid: ${policyReason(error)}` });
      continue;
    }
    if (isSamePolicy(current, desired)) summary.synced += 1;
    else summary.pending.push({
      provider: row.provider,
      reason: overridden ? 'the provider policy differs from its configured override' : 'the provider policy differs from the global policy',
    });
  }
  return summary;
}
