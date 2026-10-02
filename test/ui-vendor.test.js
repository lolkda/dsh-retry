import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';

const require = createRequire('/usr/local/lib/node_modules/@deepseek-ai/dsh/package.json');
const primitivesDir = dirname(require.resolve('@deepseek-ai/dsh-client-ui-primitives/package.json'));

/** The one transform applied to every vendored file: namespace class selectors. */
function prefixSelectors(css) {
  return css.replace(/\.([A-Za-z_][\w-]*)/g, '.drs-$1');
}

async function nativeCss(relativePath) {
  return readFile(join(primitivesDir, 'lib', relativePath), 'utf8');
}

/** Sibling packages sit beside the primitives package inside dsh's own node_modules. */
const dshModules = dirname(primitivesDir);

/** The upstream hashed class to vendored class mapping for the section header. */
const SECTION_RENAME = [
  ['rtSEdW_section', 'drs-section'],
  ['rtSEdW_title', 'drs-title'],
  ['rtSEdW_intro', 'drs-intro']
];

test('vendored settings-form CSS is the native source with only selectors namespaced', async () => {
  const vendored = await import('../src/vendor/native-form-css.js');
  const cases = [
    ['settings/form', 'settings-form/SettingsForm.module.css', vendored.settingsFormCss],
    ['settings/fields', 'settings-form/fields.module.css', vendored.fieldsCss],
    ['tag', 'Tag.module.css', vendored.tagCss],
    ['checkbox', 'Checkbox.module.css', vendored.checkboxCss]
  ];
  for (const [name, relativePath, actual] of cases) {
    assert.equal(actual, prefixSelectors(await nativeCss(relativePath)), `${name} drifted from the native source`);
  }
});

test('vendored section header CSS is the official section page rules renamed only', async () => {
  const vendored = await import('../src/vendor/native-section-css.js');
  const source = await readFile(join(dshModules, 'dsh-client-ui-agent-preset', 'lib', 'client.js'), 'utf8');
  const expected = SECTION_RENAME.map(([hashed, replacement]) => {
    const start = source.indexOf(`.${hashed}{`);
    assert.notEqual(start, -1, `upstream rule .${hashed} is gone`);
    return source.slice(start, source.indexOf('}', start) + 1).split(`.${hashed}`).join(`.${replacement}`);
  });
  assert.deepEqual(vendored.sectionCss.split(String.fromCharCode(10)), expected);
  assert.equal(/(#[0-9a-fA-F]{3,8}\b|\brgb\(|\bhsl\()/.test(vendored.sectionCss), false);
  assert.match(vendored.sectionCss, /--dsw-alias-label-primary/);
});

test('vendored CSS keeps native tokens and carries no literal colours', async () => {
  const vendored = await import('../src/vendor/native-form-css.js');
  assert.match(vendored.vendoredCss, /--dsw-alias-label-primary/);
  assert.match(vendored.vendoredCss, /--dsw-radius-md/);
  assert.equal(/(#[0-9a-fA-F]{3,8}\b|\brgb\(|\bhsl\()/.test(vendored.vendoredCss), false);
  assert.equal(vendored.vendoredCss.includes('composes'), false);
});

test('vendored CSS declares its source and licence', async () => {
  const provenance = await readFile(new URL('../src/vendor/PROVENANCE.md', import.meta.url), 'utf8');
  assert.match(provenance, /@deepseek-ai\/dsh-client-ui-primitives/);
  assert.match(provenance, /0\.2\.0-rc\.2/);
  assert.match(provenance, /MIT/);
  for (const relativePath of ['settings-form/SettingsForm.module.css', 'settings-form/fields.module.css', 'Tag.module.css', 'Checkbox.module.css']) {
    assert.match(provenance, new RegExp(relativePath.replace(/[/.]/g, '\\$&')));
  }
  assert.match(provenance, /@deepseek-ai\/dsh-client-ui-agent-preset/);
  for (const [hashed, replacement] of SECTION_RENAME) {
    assert.match(provenance, new RegExp(hashed), `provenance must name the upstream class ${hashed}`);
    assert.match(provenance, new RegExp(replacement), `provenance must name the vendored class ${replacement}`);
  }
});

test('no source file imports a Harness Client package', async () => {
  const src = resolve(new URL('../src', import.meta.url).pathname);
  const entries = await readdir(src, { withFileTypes: true, recursive: true });
  const files = entries.filter(entry => entry.isFile() && entry.name.endsWith('.js')).map(entry => join(entry.parentPath, entry.name));
  assert.ok(files.length > 0);
  for (const file of files) {
    const text = await readFile(file, 'utf8');
    assert.equal(/from\s+['"]@deepseek-ai\/dsh-client-/.test(text), false, `${file} imports a Harness Client package`);
  }
});
