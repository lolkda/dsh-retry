import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';

const builder = await import('../scripts/build.mjs');

test('client artifact registers a lazy DSH factory and reuses host React without activating early', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-retry-build-'));
  try {
    const entry = join(directory, 'entry.js');
    await writeFile(entry, "import React from 'react'; export const inject = ['slots']; export function apply(ctx) { ctx.record(React.marker); }");
    const code = await builder.compileClient(entry);
    let registration;
    const calls = [];
    vm.runInNewContext(code, { window: { __ModuleLoader__: { load(value) { registration = value; } } } });
    assert.equal(registration?.id, '@local/dsh-retry-settings');
    assert.deepEqual(calls, []);
    const plugin = registration.factory(name => {
      assert.equal(name, 'react');
      return { marker: 'host-react' };
    });
    assert.equal(typeof plugin.apply, 'function');
    assert.deepEqual(Array.from(plugin.inject), ['slots']);
    plugin.apply({ record: value => calls.push(value) });
    assert.deepEqual(calls, ['host-react']);
  } finally {
    const target = resolve(directory);
    assert.ok(target.startsWith(resolve(tmpdir()) + '/dsh-retry-build-'));
    await rm(target, { recursive: true, force: true });
  }
});
