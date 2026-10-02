/**
 * Host-owned synchronization of the one global retry policy onto every
 * configurable provider.
 *
 * The native retry executor is never replaced or wrapped: this module only writes
 * each provider's own `retryPolicy`, so the executor keeps reading the policy it
 * captures at adapter registration. Every write is a native settings path
 * operation guarded by the revision the service reported.
 *
 * @module dsh-retry-settings/global-sync
 */

import {
  buildProviderRows,
  effectivePolicyFor,
  hasProviderOverride,
  normalizePolicy,
  policyOperation,
  summarizeProviderSync,
} from './policy.js';

/** Native settings failure code for a write whose expected revision is stale. */
const SETTINGS_CONFLICT = 'settings/conflict';

/**
 * Attempts per namespace inside one pass: the first, plus a single rebase after a
 * stale revision. Bounded so a namespace that keeps moving cannot spin.
 */
const MAX_NAMESPACE_ATTEMPTS = 2;

function messageOf(error) {
  return error instanceof Error ? error.message : String(error);
}

function codeOf(error) {
  if (error === null || typeof error !== 'object') return undefined;
  return typeof error.code === 'string' ? error.code : undefined;
}

/**
 * Create the provider synchronizer.
 *
 * Reconciliation is serialized and coalesced: notifications raised while a pass
 * runs collapse into at most one follow-up pass, and a pass that finds nothing
 * differing performs no write at all. That is what makes the plugin's own
 * settings and provider events settle instead of looping.
 *
 * @param ctx - context whose `llm` and `settingsController` services are used.
 * @param options - synchronizer options.
 * @param options.readDesiredPolicy - returns the current global raw policy, or `undefined` when unconfigured.
 * @param options.readProviderOverrides - returns the current provider id → raw policy map; defaults to `{}`.
 * @returns `{reconcile, notifyChange, dispose}`.
 */
export function createProviderSync(ctx, options = {}) {
  const readDesiredPolicy = options.readDesiredPolicy;
  if (typeof readDesiredPolicy !== 'function') {
    throw new TypeError('createProviderSync requires options.readDesiredPolicy');
  }
  const readProviderOverrides = typeof options.readProviderOverrides === 'function'
    ? options.readProviderOverrides
    : () => ({});

  let disposed = false;
  let tail = Promise.resolve();
  let scheduled = false;

  function emptyReport() {
    return { configured: false, desired: null, total: 0, synced: 0, pending: [], namespaces: [], written: 0 };
  }

  function services() {
    const llm = ctx.get('llm');
    const settingsController = ctx.get('settingsController');
    if (llm === undefined || settingsController === undefined) return undefined;
    return { llm, settingsController };
  }

  function viewsOf(described) {
    const views = new Map();
    for (const view of Array.isArray(described?.namespaces) ? described.namespaces : []) {
      if (view !== null && view !== undefined && typeof view.ns === 'string') views.set(view.ns, view);
    }
    return views;
  }

  /** Read the provider rows and namespace revisions that exist right now. */
  async function readRows(resolved) {
    const directory = await resolved.llm.listConfigurableProviders();
    const described = await resolved.settingsController.describe();
    return { rows: buildProviderRows(directory, described?.namespaces), views: viewsOf(described) };
  }

  /** The operations one namespace needs, recomputed from the rows and desired policies that exist right now. */
  function planNamespace(rows, ns, desiredByProvider) {
    const ops = [];
    const providers = [];
    for (const row of rows) {
      if (row.ns !== ns || row.editable !== true) continue;
      const desired = desiredByProvider.get(row.provider);
      if (desired === undefined) continue;
      // Reuse the frozen comparator: a row already carrying the policy needs no operation.
      if (summarizeProviderSync(desired, [row]).synced === 1) continue;
      ops.push(policyOperation(row.settingsPath, desired));
      providers.push(row.provider);
    }
    return { ops, providers };
  }

  /** Whether the effective policy for every row still matches the pass snapshot. */
  function desiredStillCurrent(desiredByProvider) {
    const currentGlobal = readDesiredPolicy();
    const currentOverrides = readProviderOverrides() ?? {};
    for (const [provider, expected] of desiredByProvider) {
      const desired = effectivePolicyFor(currentGlobal, currentOverrides, provider);
      if (desired === undefined || desired === null) return false;
      try {
        if (JSON.stringify(normalizePolicy(desired)) !== JSON.stringify(expected)) return false;
      } catch {
        return false;
      }
    }
    return true;
  }

  /**
   * Apply one namespace's differing providers as a single revision-guarded mutation.
   *
   * A rejected write means the configuration moved under us, so the retry re-reads the
   * directory and the namespace and recomputes its operations. A provider that disappeared
   * while the write was in flight must not be written back, and one that appeared must not
   * be missed; replaying the first attempt's operations would do both wrong.
   */
  async function applyNamespace(resolved, ns, desiredByProvider, view, rows, refreshDesired) {
    let lastError;
    for (let attempt = 0; attempt < MAX_NAMESPACE_ATTEMPTS; attempt += 1) {
      if (disposed) break;
      const { ops, providers } = planNamespace(rows, ns, desiredByProvider);
      if (ops.length === 0) return { applied: false, providers: [], entry: { ns, status: 'unchanged', changed: 0 } };
      const revision = Number.isSafeInteger(view?.revision) ? view.revision : undefined;
      try {
        await resolved.settingsController.mutate(ns, ops, revision);
        return { applied: true, providers, entry: { ns, status: 'applied', changed: ops.length } };
      } catch (error) {
        lastError = error;
        if (codeOf(error) !== SETTINGS_CONFLICT || attempt === MAX_NAMESPACE_ATTEMPTS - 1) break;
        const fresh = await readRows(resolved);
        rows = fresh.rows;
        view = fresh.views.get(ns);
        refreshDesired(rows);
        // An unreadable revision means the namespace is gone or unusable; stop rather than guess.
        if (view === undefined || !Number.isSafeInteger(view.revision)) break;
      }
    }
    return { applied: false, providers: [], entry: { ns, status: 'failed', changed: 0, error: messageOf(lastError) } };
  }

  async function runOnce() {
    const report = emptyReport();
    const globalRaw = readDesiredPolicy();
    const overridesRaw = readProviderOverrides() ?? {};
    const hasGlobal = globalRaw !== undefined && globalRaw !== null;
    const overrideKeys = Object.keys(overridesRaw).filter((key) => overridesRaw[key] !== undefined && overridesRaw[key] !== null);
    // Unconfigured means inactive: no read and no write happens at all.
    if (!hasGlobal && overrideKeys.length === 0) return report;

    let global;
    if (hasGlobal) {
      try {
        global = normalizePolicy(globalRaw);
      } catch (error) {
        report.error = `the global policy is invalid: ${messageOf(error)}`;
        return report;
      }
    }
    const overrides = new Map();
    for (const provider of overrideKeys) {
      try {
        overrides.set(provider, normalizePolicy(overridesRaw[provider]));
      } catch (error) {
        // The summary reports this pending; the writer never propagates an invalid override.
        report.error = `a provider override is invalid: ${messageOf(error)}`;
      }
    }

    const resolved = services();
    if (resolved === undefined) {
      report.error = 'the settings service is unavailable, so no policy was applied';
      return report;
    }
    report.configured = hasGlobal;
    report.desired = global ?? null;

    const { rows, views } = await readRows(resolved);
    const summary = summarizeProviderSync(globalRaw, rows, overridesRaw);
    report.total = summary.total;
    report.synced = summary.synced;
    report.pending = [...summary.pending];
    if (disposed) return report;

    const desiredByProvider = new Map();
    for (const row of rows) {
      const desired = effectivePolicyFor(globalRaw, overridesRaw, row.provider);
      if (desired === undefined || desired === null) continue;
      try {
        desiredByProvider.set(row.provider, normalizePolicy(desired));
      } catch {
        // Invalid effective policy is already pending in the summary.
      }
    }
    /** After a conflict re-read, add newly appeared providers to the snapshot. */
    const refreshDesired = (freshRows) => {
      const currentGlobal = readDesiredPolicy();
      const currentOverrides = readProviderOverrides() ?? {};
      for (const row of freshRows) {
        if (desiredByProvider.has(row.provider)) continue;
        const desired = effectivePolicyFor(currentGlobal, currentOverrides, row.provider);
        if (desired === undefined || desired === null) continue;
        try {
          desiredByProvider.set(row.provider, normalizePolicy(desired));
        } catch {
          // Invalid effective policy is already pending in the summary.
        }
      }
    };
    const order = [];
    for (const row of rows) {
      if (row.editable !== true) continue;
      if (!order.includes(row.ns)) order.push(row.ns);
    }

    const applied = new Set();
    for (const ns of order) {
      // The configured policy may have been cleared or replaced while this pass ran. A later
      // pass applies the new one, so stop here rather than propagate a policy that is gone.
      if (!desiredStillCurrent(desiredByProvider)) break;
      if (planNamespace(rows, ns, desiredByProvider).ops.length === 0) {
        report.namespaces.push({ ns, status: 'unchanged', changed: 0 });
        continue;
      }
      const outcome = await applyNamespace(resolved, ns, desiredByProvider, views.get(ns), rows, refreshDesired);
      report.namespaces.push(outcome.entry);
      if (!outcome.applied) continue;
      report.written += outcome.entry.changed;
      for (const provider of outcome.providers) applied.add(provider);
    }
    // A write that succeeded is known-applied configuration, so the summary reflects it.
    report.synced += applied.size;
    report.pending = report.pending.filter((entry) => !applied.has(entry.provider));
    return report;
  }

  function enqueue() {
    const pass = tail.then(() => {
      scheduled = false;
      if (disposed) return emptyReport();
      return runOnce();
    });
    tail = pass.then(() => undefined, () => undefined);
    return pass;
  }

  return {
    /**
     * Run one reconciliation pass, after any pass already queued.
     * @returns the pass report.
     */
    reconcile() {
      if (disposed) return Promise.resolve(emptyReport());
      return enqueue();
    },
    /**
     * Request a reconciliation without waiting. Repeated calls before a pass runs
     * collapse into that single pass.
     */
    notifyChange() {
      if (disposed || scheduled) return;
      scheduled = true;
      void enqueue().then(() => undefined, () => undefined);
    },
    /** Stop scheduling new passes, then wait for any pass already running to drain. */
    async dispose() {
      disposed = true;
      await tail;
    },
  };
}
