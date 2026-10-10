# Agent Note: Remove the DSH peer-version activation gate

Status: implemented

## Problem

DSH 0.2.1-alpha.2 rejects both the installed @local/dsh-retry-settings@0.2.0 and the workspace @lolkda/dsh-retry@0.2.1 because their manifests require exactly @deepseek-ai/dsh@0.2.0-rc.2. The baseline suite reports 197 passes and four failures caused by Loader disabling the plugin before its settings namespace and tool are registered. No existing .agents/notes decision covers this change.

## Decision

The npm manifest and lockfile omit the DSH peer dependency and its optional-peer metadata. Release @lolkda/dsh-retry@0.2.2 retains the Loader row id dsh-retry-settings, settings fields, client identity, synchronization behavior and native retry executor. Release CI explicitly tests DSH 0.2.1-alpha.2, matching the installed runtime used for local verification. The dependency-free verify-notes command checks this repository's active note tree and runs in release CI; it rejects archives until a sealed archive verifier is introduced.

## Distribution and migration boundaries

Publishing uses the existing GitHub workflow. The old local-named bundle and the npm bundle must never both be enabled because they own the same row id. A persisted override with name @local/dsh-retry-settings is a name assertion, so it does not match the new @lolkda/dsh-retry row despite the unchanged id. Migration must retain the original policy and reapply it through native Settings when needed, not assume that the old name-qualified override matches. Profile files are managed through supported management and settings operations, never hand-edited.

## Alternatives considered

- Updating the exact peer to 0.2.1-alpha.2 retains an explicit compatibility boundary. It is rejected because the user explicitly requests removal of version restrictions, not another exact pin that breaks on the next upgrade.
- An exact-version exemption restores this one installation without publishing a new package. It is rejected because it does not fix the npm package, is profile-specific, and is not the requested distribution change.

## Verification

Against the installed DSH 0.2.1-alpha.2, npm test passes all 202 tests, including actual Loader activation, settings and tool integration, and native retry execution. The added manifest test rejects a reintroduced DSH peer gate and checks lockfile identity/version agreement. npm run build, npm run check, npm run verify-notes, npm pack --dry-run and git diff --check pass. The package contains the host modules, compiled client, locales and original SVG icon. Local tests use isolated profiles and synthetic provider failures; they do not issue real model requests.

## Consequences

Host upgrades no longer disable this plugin solely because of its declared DSH version. This removes early rejection on unknown future DSH versions, not actual API incompatibility: future upgrades still require runtime tests. The scoped settings policy remains unchanged. A name-changing installation needs an explicit configuration-preservation check. Browser control may be unavailable; Host activation and live registration alone do not establish visual acceptance.
