# Retry settings contract — GLOBAL revision (supersedes v0.1 provider editor)

## 2026-10-03 provider overrides (user-authorized)

The user then asked whether retry rules can be configured per provider, and approved **global default + per-provider overrides**. The plugin Config now also owns an optional volatile `providers` dictionary. Each provider follows the global default unless an override exists; Host reconciliation writes each provider's own native `retryPolicy` from its effective policy. The UI keeps the global editor and adds a provider-override list, and `retry_policy` accepts an optional `provider` argument. Provider overrides are never rolled back when reset — reset only removes the override from this plugin.

## 2026-10-03 UI restyle (supersedes the verbatim-vendor UI clause)

The user reviewed the frontend and asked for a redesign that follows DSH's own visual design. The UI no longer injects the byte-for-byte SettingsForm vendor copy; it now renders the native section heading plus a token-driven DSH-style form (settings cards, SegmentedControl-style mode tabs, Input-style shells with units, Pill-style code chips, StateDot-style sync summary, Button-sized actions). All rules use public `--dsw-*` tokens and stable `drs-` class names from `src/ui-style.js`; there are still no runtime imports of Harness Client packages and no hashed-class dependence. The older vendor snapshots remain in `src/vendor/` for provenance verification only. Every Client behaviour below (global-only reads/writes, revision fencing, honest sync summary) is unchanged.

## User-authorized change and Lead decisions

The user explicitly rejected provider-by-provider settings and the custom CSS design. One global policy now applies to existing AND future configurable providers. Keep the independent Settings → Request retries entry, but remove provider selection. Reuse the official Settings form markup/CSS verbatim (local prefixed vendor copy, not a new visual design; no direct imports of Harness Client packages). [SUPERSEDED 2026-10-03: the user then asked to redesign the form after DSH's own visual design — see the note above.]

Confirmed actual user state: cpa retryPolicy is normal/maxRetries=20/backoff500..10000/jitter0.1/default five codes, revision8 on last read. Never reset cpa to5 as test cleanup. The v0.1 bundle is now disabled (applied); native retry executor remains enabled and cpa20 remains effective. Lead preserved v0.1 package archive. All actual profile/GUI mutations remain Lead-only.

## Architecture and lifecycle

Package remains @local/dsh-retry-settings, ESM, compatible DSH0.2.0-rc.2; next package version0.2.0.
Plugin Config owns ONE desired `policy` (native raw RetryPolicy shape), exposed as a volatile setting in namespace `dsh-retry-settings`. Native provider `retryPolicy` values become derived application state, not separate user settings in our UI.
- Missing global Config.policy means inactive/unconfigured: no provider writes at mount. The UI can show native default draft but must say not configured.
- Lead will set initial global policy to the user's existing20 AFTER installation through the guarded global tool. No guessed initialization from one arbitrary provider.
- Once a global policy is explicitly configured, synchronization on mount/config changes/provider changes is AUTHORIZED by the latest unified-policy requirement. This intentionally supersedes the old no-startup-write rule.
- Keep original dsh-llm-retry row enabled. No alternate retry loop, monkey patch, modified readonly event payload, or re-mount of native retry apply.
- Synchronize desired policy using native settingsController.mutate to each existing/configured editable provider. Group all differing providers in SAME namespace into ONE atomic ops list and one expectedRevision. Cross-namespace writes are NOT atomic; preserve partial success and report per-namespace failures.
- One serialized/coalesced reconciliation queue; equality checks make self-generated settings/provider events no-ops. Bound conflict handling (no endless self-triggered loop). Unknown/unsupported/unwritable targets are reported, not silently claimed applied. A future provider receives desired policy through the same event-driven reconcile; no timers/polling. There is an asynchronous synchronization interval, not a first-request atomic routing guarantee.
- Native loader applies policies to later requests; existing in-flight requests/backoff keep captured policy.
- Disable/uninstall stops listeners/drains active application; do not revert user/native provider values. Already-applied policies remain. Re-enable reapplies configured global desired state.

## Frozen interfaces

Keep existing browser-safe exports from src/policy.js: DEFAULT_POLICY, normalizePolicy, getPath, policyOperation, resetOperation, buildProviderRows. Native Settings schema is Schemastery `{uid,refs}`, NOT the Inspect JSONSchema projection.
Add:
- `GLOBAL_SETTINGS_NS = 'dsh-retry-settings'`.
- `summarizeProviderSync(policy, rows)` -> `{total, synced, pending: [{provider, reason}]}`. Compare normalized policy behavior (code-set order irrelevant); report unsupported rows. This is a configuration-observation summary, not proof of a currently in-flight request's captured policy.

Host exports Config/name/inject/apply from src/host.js. Config built with @deepseek-ai/schemastery3.18.4 (Lead installed runtime dependency). policy remains optional until user sets it; validate native field limits and cross-field semantics before admitting invalid writes where native Config support allows. Runtime synchronizer must refuse invalid policy, never propagate it.
`retry_policy` becomes GLOBAL: actions list/get/set/reset (list alias of global get). Remove provider input. set requires explicit policy + expectedRevision; reset requires expectedRevision and removes global override (restores inherited global policy, or inactive if absent). Resolve target namespace internally. UI/tool both save only global namespace via native Settings; executor configuration synchronization is Host-owned. Results return global policy/revision/configured and current sync summary/errors, not credentials or full config. Preserve existing plan/read-only/cancel guards. Tool set/reset await a reconciliation pass to report actual partial/full application; failures cannot be mislabeled full success.
Synchronizer may live in src/global-sync.js and expose a small factory suitable for actual-native integration testing; Host worker must tell QA its final signature promptly. Services/listeners use observed public contracts only. No custom HTTP endpoints/new database/session event type.

## Client contract

Keep src/client.js exports inject/apply, settings.section id/order12/locale. Use current known Remote methods (settings.describe/mutate and llm.listConfigurableProviders), not uncatalogued configForms guesses. configForms was probed but no catalogued API; direct existing Remote seam remains verified.
- Read global namespace.value.policy, .base.policy, .user.policy and revision. Missing namespace disables form with reason. Missing policy displays native default draft and unconfigured state.
- Save/reset mutations ONLY global ns `dsh-retry-settings`, ops path ['policy'], with original baseline expectedRevision. No provider-specific mutation from Client.
- Behind the scenes compute synchronization summary via directory+namespaces and summarizeProviderSync. Render honest configured/synced/unsynced count; no provider selector. Partial application is visibly pending/not fully synchronized; detailed native errors can be read via tool.
- Explicit Save/Discard/Restore inherited. Preserve all original guarantees for dirty drafts, refresh failures, revision conflicts, late read vs save, duplicate clicks/disposal. Remove obsolete provider-switch workflow/tests rather than retaining hidden dead paths.
- Modes normal/always; both keep backoff controls, normal has max retries and full error-code set; missing numeric input rejected; 0 retries allowed.
- Vendor EXACT relevant official SettingsForm.module.css and fields.module.css from installed ui-primitives plus exact minimal primitive markup/CSS as needed (checkbox/switch/section). Keep token values/dimensions/typography unchanged; only namespace selectors and prune unused rules. Source provenance + license file. No new hand-designed form CSS, no hashed class dependence, no direct module require of Harness Client packages, no global DOM writes. [SUPERSEDED 2026-10-03 for the live page: the redesign in `src/ui-style.js` uses public `--dsw-*` tokens and stable `drs-` classes; the vendor snapshots remain provenance-only.]

## Ownership (disjoint)

- Lead: package.json/lock/index.js/generated client.js/scripts/README/icon/root locale metadata/CONTRACT.md; actual installation and GUI acceptance.
- Host: src/policy.js, src/host.js, src/global-sync.js, test/policy.test.js, test/host.test.js, test/global-sync.test.js.
- UI: src/client.js, src/ui-*, src/vendor/ (native CSS/templates/provenance), test/ui*.js; can remove obsolete UI files only after checking exact absolute paths and updating imports/tests.
- QA: test/integration*.test.js, test/fixtures/; read-only production.

## Acceptance and execution

TDD mandatory, meaningful regressions before implementation (missing optional TDD writing-good-tests attachment already reported). No silent standards reduction, no unrelated dependencies/cleanup, no spawn/commit/push/publish, no runtime changes by teammates. Read latest task and claim before work. Escalate material interface/scope changes with blocker/evidence/impact/<=2 options. Final report files, red/green+full npm test result, remaining real limitations.

Global tests: missing policy does not write; set20 -> at least2 providers different namespaces receive20; same-ns2 providers batched into one mutation; new provider event receives20; only retryPolicy changes; repeated/self-generated events do not loop/write unchanged; partial failure reported while success retained; cancellation/dispose stops further writes; stale global revision rejected; reset restores inherited global policy or inactive; no provider-specific tool argument accepted. Keep actual-native retryexecutor tests proving 2=>3attempts,0=>1,AUTH=>1,cancel.
UI tests: no provider selector, save/reset only ['policy'], honest sync summary, native vendor source parity, baseline/late-read/CAS/no-write-on-mount and modes. Actual GUI: native-style source-based rows/footer/title, light/dark/narrow, read/save/reload, native cpa remains20 until user knowingly changes global. No real API retry traffic.
