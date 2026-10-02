/**
 * Resolve the installed dsh runtime for integration tests.
 *
 * The plugin under test declares `@deepseek-ai/dsh` as a peer and never
 * imports it, so the test tree has no `node_modules/@deepseek-ai` of its own.
 * Integration tests borrow the running installation's packages through
 * `createRequire` anchored at the dsh manifest, which is the same resolution
 * the launcher uses and keeps a single copy of each service in the process.
 *
 * Production code must never hardcode this anchor; only tests may.
 *
 * @module test/fixtures/dsh-runtime
 */
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

/** Absolute path of the dsh application manifest inside the installation. */
export const INSTALL_ANCHOR =
  process.env.DSH_TEST_RUNTIME_ANCHOR ?? '/usr/local/lib/node_modules/@deepseek-ai/dsh/package.json';

/** The installation directory, used as the Loader's bare-specifier base. */
export const INSTALL_BASE_URL = new URL('.', pathToFileURL(INSTALL_ANCHOR)).href;

const require = createRequire(INSTALL_ANCHOR);

/**
 * Import one installed package by name.
 * @param name - the package specifier, resolved against the dsh manifest.
 * @returns the imported module namespace.
 */
export async function loadDshModule(name) {
  return import(pathToFileURL(require.resolve(name)).href);
}

/** Directory holding the installation's own dependencies (the `@deepseek-ai/*` scope root). */
export function installedScopeDir() {
  return new URL('node_modules/@deepseek-ai/', pathToFileURL(INSTALL_ANCHOR)).pathname.replace(/\/$/, '');
}
