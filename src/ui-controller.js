/**
 * Global retry settings controller.
 *
 * Holds the page state over the plugin's own settings namespace: it reads the
 * single global `policy` field, shows how far the configured providers are from
 * it, and writes only that field through a revision-fenced path op. Provider
 * native `retryPolicy` values are derived application state the Host
 * synchronizes; this controller never writes a provider entry.
 *
 * The controller performs no write during mount, refuses concurrent writes, and
 * keeps an edited draft — with its original baseline revision — across
 * refreshes and failed saves, so an external change surfaces as a server-side
 * conflict instead of being overwritten silently.
 *
 * @module ui-controller
 */

import {
  DEFAULT_POLICY,
  GLOBAL_SETTINGS_NS,
  buildProviderRows,
  effectivePolicyFor,
  getPath,
  hasProviderOverride,
  summarizeProviderSync
} from './policy.js';
import {
  draftFieldErrors,
  draftFromPolicy,
  draftIsDirty,
  globalResetOperation,
  globalSetOperation,
  policyFromDraft,
  providerResetOperation,
  providerSetOperation
} from './ui-draft.js';

const POLICY_PATH = ['policy'];

const EMPTY_STATE = Object.freeze({
  status: 'loading',
  error: null,
  notice: null,
  available: false,
  writable: true,
  configured: false,
  overridden: false,
  saving: false,
  dirty: false,
  failed: false,
  revision: null,
  fieldErrors: {},
  sync: { total: 0, synced: 0, pending: [] },
  defaultCodes: Object.freeze([...DEFAULT_POLICY.retryableCodes]),
  draft: null,
  providers: [],
  selectedProvider: null,
  providerDraft: null,
  providerFieldErrors: {},
  providerDirty: false,
  providerConfigured: false,
  savingScope: 'global'
});

function messageOf(error) {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Create the global retry settings controller over the injected Remote faces.
 * @param options - `remote` supplies `remote.llm` and `remote.settings`.
 * @returns the controller: `store`, `load`, `refresh`, `actions`, `dispose`.
 */
export function createRetrySettingsController({ remote }) {
  let state = { ...EMPTY_STATE };
  let namespace = null;
  let providerRows = [];
  let baselineRevision = null;
  let providerBaseline = null;
  let generation = 0;
  let pendingRefresh = false;
  let disposed = false;
  const listeners = new Set();

  const store = {
    getSnapshot: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }
  };

  function publish(patch) {
    if (disposed) return;
    state = { ...state, ...patch };
    for (const listener of [...listeners]) listener();
  }

  /** Drop in-flight reads whose basis a newer write replaced. */
  function invalidateReads() {
    generation += 1;
  }

  /** Run the one refresh a forwarded change requested while a save was in flight. */
  function runDeferredRefresh() {
    if (!pendingRefresh || disposed) return;
    pendingRefresh = false;
    void refresh();
  }

  /** The global policy in force, or `undefined` while none is configured. */
  function effectivePolicy() {
    return namespace === null ? undefined : getPath(namespace.value, POLICY_PATH);
  }

  /** The raw per-provider override map currently stored in this namespace. */
  function overrideMap() {
    const value = namespace === null ? undefined : getPath(namespace.value, ['providers']);
    return value === null || value === undefined ? {} : value;
  }

  /** The raw policy one provider should carry. */
  function desiredForProvider(provider) {
    return effectivePolicyFor(effectivePolicy(), overrideMap(), provider);
  }

  /** The view-model rows rendered below the global editor. */
  function buildProviders() {
    const global = effectivePolicy();
    const overrides = overrideMap();
    return providerRows.map((row) => {
      const desired = effectivePolicyFor(global, overrides, row.provider);
      const one = summarizeProviderSync(desired, [row]);
      return {
        provider: row.provider,
        displayName: row.displayName,
        editable: row.editable === true,
        hasOverride: hasProviderOverride(overrides, row.provider),
        synced: one.synced === 1,
        reason: one.pending[0]?.reason ?? null,
        policy: desired === undefined || desired === null ? null : normalizePolicyForView(desired)
      };
    });
  }

  function normalizePolicyForView(policy) {
    try {
      return draftFromPolicy(policy);
    } catch {
      return draftFromPolicy(DEFAULT_POLICY);
    }
  }

  /**
   * Read the provider directory and the settings namespaces once.
   * @returns the global view, provider rows and writability, or `{failure}` / `{stale:true}`.
   */
  async function read() {
    const mine = ++generation;
    let directory;
    let describe;
    try {
      [directory, describe] = await Promise.all([
        remote.llm.listConfigurableProviders(),
        remote.settings.describe()
      ]);
    } catch (error) {
      if (disposed || mine !== generation) return { stale: true };
      return { failure: messageOf(error) };
    }
    if (disposed || mine !== generation) return { stale: true };
    if (!directory.ok) return { failure: directory.error.message };
    if (!describe.ok) return { failure: describe.error.message };
    const namespaces = describe.value.namespaces ?? [];
    return {
      view: namespaces.find(candidate => candidate.ns === GLOBAL_SETTINGS_NS) ?? null,
      rows: buildProviderRows(directory.value, namespaces),
      writable: describe.value.writable !== false
    };
  }

  /**
   * Adopt one read of the settings document.
   * @param result - the read outcome.
   * @param options - `draftOverride` keeps an edited draft; `keepBaseline` keeps its write fence.
   * @returns nothing.
   */
  function adopt(result, { draftOverride, keepBaseline = false } = {}) {
    providerRows = result.rows;
    namespace = result.view;
    const effective = effectivePolicy();
    const configured = effective !== undefined;
    const revision = namespace === null || !Number.isSafeInteger(namespace.revision) ? null : namespace.revision;
    if (!keepBaseline) baselineRevision = revision;
    const draft = namespace === null ? null : (draftOverride ?? draftFromPolicy(effective));
    const selectedStillExists = state.selectedProvider === null
      || providerRows.some((row) => row.provider === state.selectedProvider);
    publish({
      status: 'ready',
      error: null,
      available: namespace !== null,
      writable: result.writable,
      configured,
      overridden: namespace !== null && getPath(namespace.user, POLICY_PATH) !== undefined,
      revision: baselineRevision,
      draft,
      fieldErrors: draft === null ? {} : draftFieldErrors(draft),
      dirty: draft === null ? false : draftIsDirty(draft, effective),
      sync: summarizeProviderSync(effective, providerRows, overrideMap()),
      providers: buildProviders(),
      failed: false,
      notice: namespace === null ? { kind: 'unavailable' } : (configured ? null : { kind: 'unconfigured' }),
      ...(selectedStillExists ? {} : {
        selectedProvider: null,
        providerDraft: null,
        providerFieldErrors: {},
        providerDirty: false,
        providerConfigured: false
      })
    });
  }

  /** Adopt the namespace view a successful write returned. */
  function adoptWrittenView(view) {
    namespace = view;
    const effective = effectivePolicy();
    baselineRevision = Number.isSafeInteger(view.revision) ? view.revision : baselineRevision;
    publish({
      available: true,
      configured: effective !== undefined,
      overridden: getPath(view.user, POLICY_PATH) !== undefined,
      revision: baselineRevision,
      draft: draftFromPolicy(effective),
      fieldErrors: {},
      dirty: false,
      sync: summarizeProviderSync(effective, providerRows, overrideMap()),
      providers: buildProviders()
    });
  }

  /**
   * Read the global policy and the provider directory, then publish the page state.
   * @returns nothing; the outcome is published to the store.
   */
  async function load() {
    const result = await read();
    if (result.stale === true) return;
    if (result.failure !== undefined) {
      publish({
        status: 'unavailable',
        error: result.failure,
        available: false,
        draft: null,
        revision: null,
        notice: { kind: 'unavailable' }
      });
      return;
    }
    adopt(result);
  }

  /**
   * Re-read settings after a forwarded change.
   *
   * A dirty draft survives, keeps its original baseline revision, and is
   * reported as externally changed: saving it then fails with the server's
   * conflict instead of rebasing onto the newer revision and overwriting it.
   * @returns nothing; a read failure keeps the last good values and draft.
   */
  async function refresh() {
    if (disposed) return;
    if (state.saving) {
      pendingRefresh = true;
      return;
    }
    const previousRevision = state.revision;
    const previousPolicy = JSON.stringify(effectivePolicy() ?? null);
    const previousOverrides = JSON.stringify(overrideMap() ?? {});
    const result = await read();
    if (result.stale === true) return;
    if (result.failure !== undefined) {
      publish({ error: result.failure });
      return;
    }
    const keepDraft = state.dirty === true && namespace !== null;
    const keepProviderDraft = state.providerDirty === true && state.selectedProvider !== null && namespace !== null;
    const nextPolicy = result.view === null ? undefined : getPath(result.view.value, POLICY_PATH);
    const nextOverrides = result.view === null ? undefined : getPath(result.view.value, ['providers']);
    const changed = previousRevision !== (result.view?.revision ?? null)
      || previousPolicy !== JSON.stringify(nextPolicy ?? null)
      || previousOverrides !== JSON.stringify(nextOverrides ?? {});
    adopt(result, { draftOverride: keepDraft ? state.draft : undefined, keepBaseline: keepDraft });
    if (keepDraft && changed) publish({ notice: { kind: 'external' } });
    else if (keepProviderDraft && changed) publish({ notice: { kind: 'external' } });
  }

  async function write(operations, scope = 'global') {
    if (disposed || state.saving || state.available !== true || state.writable !== true) return;
    if (baselineRevision === null || !Number.isSafeInteger(baselineRevision)) return;
    publish({ saving: true, savingScope: scope, notice: null });
    let response;
    try {
      response = await remote.settings.mutate(GLOBAL_SETTINGS_NS, operations, baselineRevision);
    } catch (error) {
      publish({ saving: false, failed: true, notice: { kind: 'error', message: messageOf(error) } });
      runDeferredRefresh();
      return;
    }
    if (disposed) return;
    if (!response.ok) {
      publish({
        saving: false,
        failed: true,
        notice: {
          kind: response.error.code === 'settings/conflict' ? 'conflict' : 'rejected',
          message: response.error.message
        }
      });
      runDeferredRefresh();
      return;
    }
    invalidateReads();
    adoptWrittenView(response.value);
    if (scope === 'global') {
      publish({ saving: false, savingScope: 'global', failed: false, notice: { kind: 'saved' } });
    } else {
      const provider = scope.provider;
      const overrides = overrideMap();
      const configured = hasProviderOverride(overrides, provider);
      const desired = desiredForProvider(provider);
      const draft = desired === undefined || desired === null ? null : draftFromPolicy(desired);
      providerBaseline = desired;
      publish({
        saving: false,
        savingScope: 'global',
        failed: false,
        notice: { kind: 'saved' },
        providerDraft: draft,
        providerFieldErrors: draft === null ? {} : draftFieldErrors(draft),
        providerDirty: false,
        providerConfigured: configured
      });
    }
    runDeferredRefresh();
  }

  function editDraft(mutate) {
    if (disposed || state.saving || state.draft === null || state.selectedProvider !== null) return;
    const draft = mutate(state.draft);
    publish({
      draft,
      fieldErrors: draftFieldErrors(draft),
      dirty: draftIsDirty(draft, effectivePolicy()),
      failed: false,
      notice: null
    });
  }

  const actions = {
    setField(field, value) {
      editDraft(draft => ({ ...draft, [field]: value }));
    },
    toggleCode(code, checked) {
      editDraft(draft => ({ ...draft, retryableCodes: nextCodes(draft.retryableCodes, code, checked) }));
    },
    addCustomCode(code) {
      const value = String(code).trim();
      if (value === '') return;
      editDraft(draft => ({ ...draft, retryableCodes: nextCodes(draft.retryableCodes, value, true) }));
    },
    removeCustomCode(code) {
      editDraft(draft => ({ ...draft, retryableCodes: nextCodes(draft.retryableCodes, code, false) }));
    },
    discard() {
      if (disposed || state.saving || state.draft === null || state.selectedProvider !== null) return;
      invalidateReads();
      baselineRevision = Number.isSafeInteger(namespace?.revision) ? namespace.revision : null;
      publish({
        revision: baselineRevision,
        draft: draftFromPolicy(effectivePolicy()),
        fieldErrors: {},
        dirty: false,
        failed: false,
        notice: null
      });
    },
    async save() {
      if (disposed || state.saving || state.draft === null || state.selectedProvider !== null) return;
      const fieldErrors = draftFieldErrors(state.draft);
      if (Object.keys(fieldErrors).length > 0) {
        publish({ fieldErrors, notice: { kind: 'invalid', message: Object.values(fieldErrors)[0] } });
        return;
      }
      let operations;
      try {
        operations = [globalSetOperation(policyFromDraft(state.draft))];
      } catch (error) {
        publish({ notice: { kind: 'invalid', message: messageOf(error) } });
        return;
      }
      await write(operations);
    },
    async restoreInherited() {
      if (disposed || state.saving || state.overridden !== true || state.selectedProvider !== null) return;
      await write([globalResetOperation()]);
    },
    selectProvider(provider) {
      if (disposed || state.saving || state.dirty === true || state.available !== true) return;
      const row = providerRows.find(candidate => candidate.provider === provider);
      if (row === undefined) return;
      const hasOverride = hasProviderOverride(overrideMap(), provider);
      const desired = desiredForProvider(provider);
      const draft = desired === undefined || desired === null ? draftFromPolicy(DEFAULT_POLICY) : draftFromPolicy(desired);
      providerBaseline = desired;
      publish({
        selectedProvider: provider,
        providerDraft: draft,
        providerFieldErrors: draftFieldErrors(draft),
        providerDirty: false,
        providerConfigured: hasOverride,
        notice: null
      });
    },
    closeProviderEditor() {
      if (disposed || state.saving || state.providerDirty === true) return;
      publish({
        selectedProvider: null,
        providerDraft: null,
        providerFieldErrors: {},
        providerDirty: false,
        providerConfigured: false
      });
      providerBaseline = null;
    },
    setProviderField(field, value) {
      if (disposed || state.saving || state.providerDraft === null || state.selectedProvider === null) return;
      const draft = { ...state.providerDraft, [field]: value };
      publish({
        providerDraft: draft,
        providerFieldErrors: draftFieldErrors(draft),
        providerDirty: draftIsDirty(draft, providerBaseline),
        failed: false,
        notice: null
      });
    },
    toggleProviderCode(code, checked) {
      if (disposed || state.saving || state.providerDraft === null || state.selectedProvider === null) return;
      const draft = { ...state.providerDraft, retryableCodes: nextCodes(state.providerDraft.retryableCodes, code, checked) };
      publish({
        providerDraft: draft,
        providerFieldErrors: draftFieldErrors(draft),
        providerDirty: draftIsDirty(draft, providerBaseline),
        failed: false,
        notice: null
      });
    },
    addProviderCustomCode(code) {
      if (disposed || state.saving || state.providerDraft === null || state.selectedProvider === null) return;
      const value = String(code).trim();
      if (value === '') return;
      const draft = { ...state.providerDraft, retryableCodes: nextCodes(state.providerDraft.retryableCodes, value, true) };
      publish({
        providerDraft: draft,
        providerFieldErrors: draftFieldErrors(draft),
        providerDirty: draftIsDirty(draft, providerBaseline),
        failed: false,
        notice: null
      });
    },
    removeProviderCustomCode(code) {
      if (disposed || state.saving || state.providerDraft === null || state.selectedProvider === null) return;
      const draft = { ...state.providerDraft, retryableCodes: nextCodes(state.providerDraft.retryableCodes, code, false) };
      publish({
        providerDraft: draft,
        providerFieldErrors: draftFieldErrors(draft),
        providerDirty: draftIsDirty(draft, providerBaseline),
        failed: false,
        notice: null
      });
    },
    discardProviderDraft() {
      if (disposed || state.saving || state.selectedProvider === null) return;
      if (state.providerConfigured === true) {
        const desired = desiredForProvider(state.selectedProvider);
        const draft = desired === undefined || desired === null ? draftFromPolicy(DEFAULT_POLICY) : draftFromPolicy(desired);
        providerBaseline = desired;
        publish({
          providerDraft: draft,
          providerFieldErrors: draftFieldErrors(draft),
          providerDirty: false,
          failed: false,
          notice: null
        });
        return;
      }
      actions.closeProviderEditor();
    },
    async saveProviderOverride() {
      if (disposed || state.saving || state.providerDraft === null || state.selectedProvider === null) return;
      const fieldErrors = draftFieldErrors(state.providerDraft);
      if (Object.keys(fieldErrors).length > 0) {
        publish({ providerFieldErrors: fieldErrors, notice: { kind: 'invalid', message: Object.values(fieldErrors)[0] } });
        return;
      }
      let operations;
      try {
        operations = [providerSetOperation(state.selectedProvider, policyFromDraft(state.providerDraft))];
      } catch (error) {
        publish({ notice: { kind: 'invalid', message: messageOf(error) } });
        return;
      }
      await write(operations, { scope: 'provider', provider: state.selectedProvider });
    },
    async restoreProviderInherited() {
      if (disposed || state.saving || state.selectedProvider === null || state.providerConfigured !== true) return;
      await write([providerResetOperation(state.selectedProvider)], { scope: 'provider', provider: state.selectedProvider });
    }
  };

  return {
    store,
    load,
    refresh,
    actions,
    dispose() {
      disposed = true;
      generation += 1;
      pendingRefresh = false;
      baselineRevision = null;
      namespace = null;
      providerRows = [];
      providerBaseline = null;
      listeners.clear();
      state = { ...EMPTY_STATE };
    }
  };
}

/** Add or remove one error code, preserving the order of the codes already present. */
function nextCodes(codes, code, checked) {
  if (checked === true) return codes.includes(code) ? codes : [...codes, code];
  return codes.filter(candidate => candidate !== code);
}
