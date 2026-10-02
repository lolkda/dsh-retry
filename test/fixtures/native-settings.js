/**
 * Boot the real Settings stack over a throwaway profile.
 *
 * The fixture builds a genuine dsh profile in a temporary directory —
 * `cordis.yml` root, `package.json` bundle list, `cordis.patch.yml` patch
 * layer — and boots it with the installed `@deepseek-ai/dsh-app-boot`, so the
 * tests exercise the shipped Loader, the shipped `@deepseek-ai/dsh-config-editor`
 * persistence, and the shipped `@deepseek-ai/dsh-settings` revision logic.
 *
 * Shape matters and mirrors a real profile: the **bundle layer** declares the
 * services and the provider row, and the **profile patch** starts empty so the
 * writes under test land there as id-targeted overrides. A profile patch that
 * declared its own row via `insert` would be refused by the config editor with
 * "overridden by a home patch or command-line overlay" — that refusal is real
 * product behaviour, not a fixture artefact, which is why the fixture uses the
 * bundle-layer form.
 *
 * Nothing outside the temporary directory is read or written: `home` is a temp
 * directory (so no legacy `settings.yaml` import can fire) and the real
 * profile, provider configuration, and GUI are untouched.
 *
 * @module test/fixtures/native-settings
 */
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { INSTALL_BASE_URL, INSTALL_ANCHOR, installedScopeDir, loadDshModule } from './dsh-runtime.js';

/** Settings namespace the fixture provider registers. */
export const FIXTURE_NS = 'fixture-provider';
/** Provider route name inside that namespace. */
export const FIXTURE_PROVIDER = 'cpa';
/** Path of one provider inside its namespace, matching `LlmConfigurableProvider.settingsPath`. */
export const FIXTURE_SETTINGS_PATH = ['providers', FIXTURE_PROVIDER];

const BUNDLE_NAME = '@fixture/dsh-retry-bundle';
const HERE = dirname(fileURLToPath(import.meta.url));

/** Same-namespace routes used by the `multi` layout, to exercise one batched mutation. */
export const FIXTURE_ROUTES = ['cpa', 'cpa-b'];
/** Second provider namespace, used to exercise the non-atomic cross-namespace path. */
export const FIXTURE_NS_ALT = 'fixture-provider-alt';
/** The route inside {@link FIXTURE_NS_ALT}. */
export const FIXTURE_ALT_ROUTE = 'alt';
/** Path of the alternate provider inside its namespace. */
export const FIXTURE_ALT_SETTINGS_PATH = ['providers', FIXTURE_ALT_ROUTE];

/** The stored policy the lower (bundle) layer supplies when `lowerPolicy` is set. */
const LOWER_POLICY = {
  mode: 'normal',
  maxRetries: 7,
  backoff: { initialDelayMs: 4000, maxDelayMs: 20000, jitterRatio: 0.3 },
};

function keyRefFor(route) {
  return `${route.toUpperCase().replace(/-/g, '_')}_API_KEY`;
}

/** One provider profile: a secret reference, an endpoint, and optionally a stored policy. */
function providerProfile(route, lowerPolicy) {
  return {
    displayName: route,
    apiKeyEnv: keyRefFor(route),
    baseURL: 'http://192.168.1.100:8317/v1',
    ...(lowerPolicy ? { retryPolicy: { ...LOWER_POLICY, backoff: { ...LOWER_POLICY.backoff } } } : {}),
  };
}

function providersRecord(routes, lowerPolicy) {
  return Object.fromEntries(routes.map((route) => [route, providerProfile(route, lowerPolicy)]));
}

/**
 * The bundle patch: service rows, the fixture provider rows, and optionally the
 * plugin's own global-policy row.
 *
 * Emitted as JSON, which is valid YAML, so the patch structure cannot be broken
 * by hand-maintained indentation.
 */
function bundlePatch({ lowerPolicy, layout, global }) {
  const primaryRoutes = layout === 'multi' ? [...FIXTURE_ROUTES] : [FIXTURE_PROVIDER];
  const rows = [
    { id: 'config-editor', name: '@deepseek-ai/dsh-config-editor' },
    { id: 'settings', name: '@deepseek-ai/dsh-settings' },
    { id: FIXTURE_NS, name: './provider.js', config: { providers: providersRecord(primaryRoutes, lowerPolicy) } },
  ];
  if (layout === 'multi') {
    rows.push({ id: FIXTURE_NS_ALT, name: './provider.js', config: { providers: providersRecord([FIXTURE_ALT_ROUTE], lowerPolicy) } });
  }
  if (global !== undefined) {
    rows.push({
      id: global.id,
      name: global.modulePath,
      ...global.policy === undefined ? {} : { config: { policy: global.policy } },
    });
  }
  return `${JSON.stringify([{ insert: rows }], null, 2)}\n`;
}

/**
 * Create and boot one isolated profile.
 * @param options - `lowerPolicy` selects whether the bundle layer already stores a policy;
 *   `layout` selects one provider namespace (`single`) or two (`multi`);
 *   `global` adds the plugin's own global-policy row as `{id, modulePath, policy?}`,
 *   where an absent `policy` means the global setting is not configured.
 * @returns handles over the live services plus a `close()` that removes the temp tree.
 */
export async function createNativeSettingsProfile({ lowerPolicy = false, layout = 'single', global, services } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-retry-it-'));
  const dir = join(root, 'profile');
  const home = join(root, 'home');
  const bundleDir = join(dir, 'node_modules', '@fixture', 'dsh-retry-bundle');
  const patchPath = join(dir, 'cordis.patch.yml');

  await mkdir(bundleDir, { recursive: true });
  await mkdir(home, { recursive: true });
  await mkdir(join(dir, 'node_modules'), { recursive: true });

  // The profile's dependency scope is the installation's own `@deepseek-ai`
  // scope, so every `@deepseek-ai/*` specifier — the service rows and the
  // fixture provider's imports — resolves to the one installed copy.
  await symlink(installedScopeDir(), join(dir, 'node_modules', '@deepseek-ai'));

  await writeFile(join(dir, 'cordis.yml'), '[]\n');
  await writeFile(patchPath, '[]\n');
  await writeFile(
    join(dir, 'package.json'),
    `${JSON.stringify({ name: 'dsh-retry-it-profile', private: true, type: 'module', dsh: { profile: { bundles: [BUNDLE_NAME] } } }, null, 2)}\n`,
  );

  await writeFile(
    join(bundleDir, 'package.json'),
    `${JSON.stringify({
      name: BUNDLE_NAME,
      version: '1.0.0',
      private: true,
      type: 'module',
      exports: { '.': './index.js' },
      dsh: { bundle: { patch: './cordis.patch.yml' } },
    }, null, 2)}\n`,
  );
  await writeFile(join(bundleDir, 'index.js'), 'export function apply() {}\n');
  await writeFile(join(bundleDir, 'cordis.patch.yml'), bundlePatch({ lowerPolicy, layout, global }));
  await copyFile(join(HERE, 'retry-provider.js'), join(bundleDir, 'provider.js'));

  // The generated bundle resolves `@deepseek-ai/*` through the profile's own
  // node_modules, exactly as an installed bundle would.
  await symlink(installedScopeDir(), join(bundleDir, 'node_modules', '@deepseek-ai')).catch(async () => {
    await mkdir(join(bundleDir, 'node_modules'), { recursive: true });
    await symlink(installedScopeDir(), join(bundleDir, 'node_modules', '@deepseek-ai'));
  });

  const { boot, loadProfileDirectory, readProfilePatches } = await loadDshModule('@deepseek-ai/dsh-app-boot');

  const profileContext = {
    name: 'dsh-retry-it',
    dir,
    patchPath,
    installAnchor: INSTALL_ANCHOR,
    startedBundles: [BUNDLE_NAME],
    cwd: process.cwd(),
    home,
    overlays: [],
  };
  const loaded = loadProfileDirectory('dsh', dir, INSTALL_ANCHOR);
  if (loaded.skippedBundles.length > 0) {
    throw new Error(`fixture bundle did not load: ${JSON.stringify(loaded.skippedBundles)}`);
  }

  let ctx;
  try {
    ctx = await boot(
      'dsh',
      join(dir, 'cordis.yml'),
      readProfilePatches('dsh', profileContext, loaded),
      async (hostCtx) => {
        hostCtx.provide('profileContext', profileContext);
        // Runs before the root include mounts, so a plugin row that names these
        // services in `inject` activates instead of staying dormant. Services
        // created by a row (the Settings stack) are resolved lazily by callers.
        await services?.(hostCtx);
      },
      INSTALL_BASE_URL,
    );
  } catch (error) {
    await rm(root, { recursive: true, force: true });
    throw error;
  }

  const settings = ctx.get('settings');
  const configEditor = ctx.get('configEditor');
  if (settings === undefined || configEditor === undefined) {
    await ctx.fiber.dispose();
    await rm(root, { recursive: true, force: true });
    throw new Error('fixture profile did not mount the real settings stack');
  }

  return {
    ctx,
    settings,
    configEditor,
    patchPath,
    dir,
    /** Every namespace the real service currently projects. */
    describe: (options) => settings.describe(options),
    /** One namespace view by id, or a descriptive failure. */
    viewOf: (ns) => {
      const found = settings.describe().find((row) => row.ns === ns);
      if (found === undefined) throw new Error(`namespace ${ns} is not projected`);
      return found;
    },
    /** The fixture provider's namespace view. */
    view: () => {
      const found = settings.describe().find((row) => row.ns === FIXTURE_NS);
      if (found === undefined) throw new Error(`namespace ${FIXTURE_NS} is not projected`);
      return found;
    },
    /** Raw bytes of the profile patch, the only place a write can land. */
    readPatchFile: () => readFile(patchPath, 'utf8'),
    async close() {
      await ctx.fiber.dispose();
      await rm(root, { recursive: true, force: true });
    },
  };
}
