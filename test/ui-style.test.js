import test from 'node:test';
import assert from 'node:assert/strict';
import { uiCss } from '../src/ui-style.js';

test('redesigned stylesheet stays on public DSH tokens and stable classes', () => {
  assert.match(uiCss, /--dsw-alias-settings-card-fill/);
  assert.match(uiCss, /--dsw-alias-settings-card-stroke/);
  assert.match(uiCss, /--dsw-radius-xl/);
  assert.match(uiCss, /--dsw-alias-button-primary-fill/);
  assert.match(uiCss, /\.drs-panel/);
  assert.match(uiCss, /\.drs-segmented/);
  assert.match(uiCss, /\.drs-chip/);
  assert.match(uiCss, /\.drs-stateDot/);
});

test('redesigned stylesheet carries no literal colours or CSS-module leakage', () => {
  assert.equal(/(#[0-9a-fA-F]{3,8}\b|\brgb\(|\bhsl\()/.test(uiCss), false);
  assert.equal(uiCss.includes('composes'), false);
  assert.equal(uiCss.includes('@deepseek-ai'), false);
});
