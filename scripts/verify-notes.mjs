import assert from 'node:assert/strict';
import { readdir, readFile, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../.agents/notes/', import.meta.url));
const classes = new Set(['feature', 'bug-fix', 'simplification', 'architecture', 'process', 'testing']);
const required = {
  proposed: ['Problem', 'Proposal', 'Alternatives considered', 'Acceptance criteria', 'Risks'],
  implemented: ['Problem', 'Decision', 'Alternatives considered', 'Consequences'],
  rejected: ['Problem', 'Proposal', 'Alternatives considered'],
};
let count = 0;

// This repository has only active notes. Refuse archives until a hash-sealed
// append-only archive verifier is introduced, rather than silently skipping them.
for (const lifecycle of await readdir(root, { withFileTypes: true })) {
  assert(lifecycle.isDirectory() && Object.hasOwn(required, lifecycle.name), `Unsupported lifecycle: ${lifecycle.name}`);
  const lifecycleDir = join(root, lifecycle.name);
  for (const category of await readdir(lifecycleDir, { withFileTypes: true })) {
    assert(category.isDirectory() && classes.has(category.name), `Invalid class: ${category.name}`);
    const categoryDir = join(lifecycleDir, category.name);
    for (const entry of await readdir(categoryDir, { withFileTypes: true })) {
      assert(entry.isFile() && /^\d{4}-\d{2}-\d{2}-[a-z0-9]+(?:-[a-z0-9]+)*\.md$/.test(entry.name), `Invalid note filename: ${entry.name}`);
      const path = join(categoryDir, entry.name);
      const text = (await readFile(path, 'utf8')).replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
      const lines = text.split('\n');
      assert(/^# Agent Note: .+/.test(lines[0]), `${path}: missing title`);
      assert(lines[1] === '' && lines[3] === '', `${path}: invalid header spacing`);
      assert(lifecycle.name === 'rejected'
        ? /^Status: rejected — .+/.test(lines[2])
        : lines[2] === `Status: ${lifecycle.name}`, `${path}: status mismatch`);
      assert.equal(lines.filter(line => line.startsWith('Status:')).length, 1, `${path}: duplicate status`);
      const headings = lines.filter(line => line.startsWith('## ')).map(line => line.slice(3));
      assert.equal(headings[0], 'Problem', `${path}: Problem must be first`);
      for (const heading of required[lifecycle.name]) {
        assert(headings.includes(heading), `${path}: missing ${heading}`);
      }
      if (lifecycle.name === 'implemented') {
        assert(!headings.some(heading => ['Proposal', 'Plan', 'Migration plan', 'Acceptance criteria'].includes(heading)), `${path}: implemented note contains proposal headings`);
      }
      for (const match of text.matchAll(/\]\((?:<([^>]+)>|([^\s)]+))\)/g)) {
        const target = match[1] ?? match[2];
        if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('#')) continue;
        const linked = resolve(dirname(path), decodeURIComponent(target.split('#')[0]));
        await stat(linked).catch(() => { throw new Error(`${path}: broken link ${target}`); });
      }
      count += 1;
    }
  }
}
assert(count > 0, 'Expected at least one decision note');
console.log(`Verified ${count} active decision note(s).`);
