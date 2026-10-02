# Restart handoff — 2026-10-02

## Current status

User chose to restart DSH manually, then return for final acceptance. Do NOT restart/kill the server yourself.

- Implemented global retry policy (existing/future configurable providers synchronized through native Settings, native retry executor unchanged).
- Frontend redesigned on 2026-10-03 per user request to follow DSH's own visual design, then extended to **global default + per-provider overrides** (provider list, create/edit/save override, restore follow-global): token-driven settings cards, segmented mode control, unit input shells, error-code chips, state-dot sync summary, DSH Button-style actions; stable `drs-` classes only, no runtime Client-package imports (`src/ui-style.js`). Old vendor CSS snapshots are provenance-only.
- Final Lead regressions: default global policy can be explicitly enabled without manufacturing dirty state; explicit discard rebases the next write to the last read revision.
- Final `npm test` after restyle: **201 tests / 201 pass / 0 fail**. `npm run build` and `npm run check` pass (latest full run after provider overrides (see `/tmp/dsh-retry-redesign-test.log` for the earlier UI-only run); earlier global test log `/tmp/dsh-retry-global-test.log`).
- All Team implementation/QA tasks finished; teammates frozen. Lead controls actual install/GUI acceptance.

## Installation truth

- The rebuilt package was overlayed onto the installed package on 2026-10-03 (`/app/.dsh/profiles/web/node_modules/@lolkda/dsh-retry/`). HMR picked up the client half: bundle rev moved `d0c807fbd7f4` → `530ded847676` → `879af3f33e3c` after moving the sync summary above the provider-override list, verified by authenticated index read. The **client half is live after a browser reload**.
- The **host half** (Config `providers` field, override-aware synchronizer, `retry_policy` provider argument) is written to disk but the running DSH process still has the old host module loaded. **A DSH restart is required for per-provider override saves and the provider-aware tool to work.**
- Pre-overlay installed bundle backup: `/app/project/dsh-retry/local-dsh-retry-settings-0.2.0-installed-client.js.pre-restyle`; tarball lineage: `local-dsh-retry-settings-0.2.0.pre-restyle.tgz` (original vendor UI) and `local-dsh-retry-settings-0.2.0.global-only.tgz` (first DSH-style global-only UI), and `local-dsh-retry-settings-0.2.0.provider-overrides-v1.tgz` (before the sync-summary relocation).
- The project tarball was repacked after the restyle; the pre-restyle tarball is preserved at `/app/project/dsh-retry/local-dsh-retry-settings-0.2.0.pre-restyle.tgz`.


Package `@lolkda/dsh-retry@0.2.0` installed using:
`/app/project/dsh-retry/local-dsh-retry-settings-0.2.0.tgz`

Last plugin_manager install result: `stage: enable`, `enabled: true`, `changed: true`, **`application: restart-required`**.
Local link update first returned ambiguous-install and reused old Host modules; the versioned tarball is now installed. Do not claim global runtime is active until restart and inspect prove its Config exists.

## Protect user state

The USER independently saved **cpa maxRetries20**, normal mode, backoff500..10000ms, jitter0.1, default five codes. Last live read: cpa namespace llm-pi-ai revision8, overridden true.
Do NOT restore the initial default5 from earlier tests. An earlier UI test hit expected CAS conflict (revision7 vs8) and did NOT overwrite the user's20.
No global policy has been initialized yet. After restart, set the global policy to the user's20 using the new global tool (no provider argument) and a freshly read global revision. The normalizer fills defaults, but supply the full explicit policy for clarity.

## Next steps after user says restarted

1. Read live Config for include:dsh-retry-settings. It must be schema-backed with optional volatile `policy`, not status absent. Query current Tools if necessary; retry_policy should be GLOBAL and reject provider input.
2. Read global policy and revision. If user already configured it, preserve it; otherwise initialize normal20/default codes/backoff500..10000/jitter0.1 as requested.
3. Verify global sync summary all supported/configured providers match. Cross-ns sync is non-atomic and must report partial failures, never falsely claim all applied.
4. Browser originally served authenticated GUI at http://192.168.1.100:3080; http://127.0.0.1:3080 was reachable but browser had no auth cookie for that authority. Existing inspected page55 was user-closed; newest created page93 may or may not survive. List pages first, do not touch unrelated data: tabs.
5. Inspect actual Settings → Request retries: native title, no provider dropdown, global20, save/discard/error states; inspect screenshot beside native page. Check dark and narrow mode, restore any test theme changes. No real LLM rate-limit requests.
6. Verify reload/persistence and no plugin console error. Re-enable/disable lifecycle if it can be exercised without disrupting other work; native saved provider policy must remain.
7. Mark remaining todo/goal complete only after real GUI/runtime acceptance. Final should distinguish tests from runtime evidence.

## Files and commands

Sources are in src/; build command `npm run build`; `client.js` generated. `README.md` documents global semantics. `src/vendor/PROVENANCE.md` and LICENSE trace official styles. v0.1 backup tarball preserved.
Global namespace: `dsh-retry-settings`; global ops path ['policy']. Tool actions list/get/set/reset, mutations require expectedRevision (nonnegative integer;0 valid). Original per-provider tool API was intentionally removed.

## Known tooling issue from this session

Attempts to call update_goal resume with extraneous action-specific fields were rejected; avoid sending objective/max_goal_rounds/blocked_reason for resume/complete. Current revised goal id was goal-3e6a477c-e930-4444-9faf-d49a0da011db revision1, likely disarmed after status reply. User continuation permits resume; check get_goal first. This is not a plugin defect.
