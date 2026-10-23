import test from 'node:test';
import assert from 'node:assert/strict';

import {
  backoffPreview,
  draftFieldErrors,
  draftFromPolicy,
  draftIsDirty,
  policyFromDraft
} from '../src/ui-draft.js';

const DEFAULT_CODES = ['EMPTY_RESPONSE', 'RATE_LIMIT', 'SERVER', 'TIMEOUT', 'TRANSPORT'];

const EXPONENTIAL = {
  mode: 'normal',
  maxRetries: 20,
  retryableCodes: DEFAULT_CODES,
  backoff: { initialDelayMs: 500, maxDelayMs: 10000, jitterRatio: 0.1 }
};

const CONSTANT = {
  mode: 'normal',
  maxRetries: 20,
  retryableCodes: DEFAULT_CODES,
  backoff: { initialDelayMs: 2000, maxDelayMs: 2000, jitterRatio: 0 }
};

test('指数退避策略投影为指数草稿，固定间隔策略投影为固定间隔草稿', () => {
  assert.equal(draftFromPolicy(EXPONENTIAL).backoffMode, 'exponential');
  assert.equal(draftFromPolicy(CONSTANT).backoffMode, 'constant');
  assert.equal(draftFromPolicy({ mode: 'always', backoff: { initialDelayMs: 3000, maxDelayMs: 3000, jitterRatio: 0 } }).backoffMode, 'constant');
  // A jittered policy is never a fixed interval, even when both delays match.
  assert.equal(draftFromPolicy({ mode: 'normal', maxRetries: 1, retryableCodes: DEFAULT_CODES, backoff: { initialDelayMs: 3000, maxDelayMs: 3000, jitterRatio: 0.1 } }).backoffMode, 'exponential');
});

test('固定间隔草稿保存为初始延迟＝最大延迟且抖动为 0', () => {
  const draft = { ...draftFromPolicy(EXPONENTIAL), backoffMode: 'constant', initialDelayMs: 2000 };
  assert.deepEqual(policyFromDraft(draft), {
    mode: 'normal',
    maxRetries: 20,
    retryableCodes: DEFAULT_CODES,
    backoff: { initialDelayMs: 2000, maxDelayMs: 2000, jitterRatio: 0 }
  });
});

test('指数草稿保存时三个退避字段原样生效', () => {
  const draft = { ...draftFromPolicy(EXPONENTIAL), initialDelayMs: 750, maxDelayMs: 30000, jitterPercent: 25 };
  assert.deepEqual(policyFromDraft(draft), {
    mode: 'normal',
    maxRetries: 20,
    retryableCodes: DEFAULT_CODES,
    backoff: { initialDelayMs: 750, maxDelayMs: 30000, jitterRatio: 0.25 }
  });
});

test('缺省 backoffMode 的旧草稿按指数退避处理', () => {
  const legacy = { mode: 'always', initialDelayMs: 500, maxDelayMs: 10000, jitterPercent: 10 };
  assert.deepEqual(policyFromDraft(legacy), { mode: 'always', backoff: { initialDelayMs: 500, maxDelayMs: 10000, jitterRatio: 0.1 } });
});

test('固定间隔为空白、0 或负数时给出字段级错误且不静默取默认值', () => {
  for (const value of [null, 0, -1]) {
    const draft = { ...draftFromPolicy(CONSTANT), initialDelayMs: value };
    const errors = draftFieldErrors(draft);
    assert.ok(errors.initialDelayMs, `expected an initialDelayMs error for ${String(value)}`);
  }
  assert.deepEqual(draftFieldErrors({ ...draftFromPolicy(CONSTANT), initialDelayMs: 2000 }), {});
});

test('固定间隔保存后草稿不脏，改回指数退避才脏', () => {
  assert.equal(draftIsDirty(draftFromPolicy(CONSTANT), CONSTANT), false);
  const switched = { ...draftFromPolicy(CONSTANT), backoffMode: 'exponential' };
  assert.equal(draftIsDirty(switched, CONSTANT), true);
});

test('退避预览列出未含抖动的等待时间并标出封顶次数', () => {
  const preview = backoffPreview(draftFromPolicy(EXPONENTIAL));
  assert.equal(preview.kind, 'exponential');
  assert.deepEqual(preview.steps.map(step => step.delayMs), [500, 1000, 2000, 4000, 8000, 10000]);
  assert.equal(preview.capRetry, 6);
  assert.equal(preview.jitterPercent, 10);
});

test('退避预览只列到有限重试次数', () => {
  const preview = backoffPreview({ ...draftFromPolicy(EXPONENTIAL), maxRetries: 3 });
  assert.deepEqual(preview.steps.map(step => step.delayMs), [500, 1000, 2000]);
  assert.equal(preview.capRetry, null);
  assert.deepEqual(backoffPreview({ ...draftFromPolicy(EXPONENTIAL), maxRetries: 0 }).steps, []);
});

test('固定间隔预览报一个恒定值，未配置次数时不报预览', () => {
  const preview = backoffPreview(draftFromPolicy(CONSTANT));
  assert.deepEqual(preview, { kind: 'constant', intervalMs: 2000, count: 6 });
  assert.deepEqual(backoffPreview({ ...draftFromPolicy(CONSTANT), maxRetries: 0 }), { kind: 'constant', intervalMs: 2000, count: 0 });
  assert.equal(backoffPreview({ ...draftFromPolicy(CONSTANT), initialDelayMs: null }), null);
  assert.equal(backoffPreview(null), null);
});

test('持续重试的预览不受次数上限截断', () => {
  const preview = backoffPreview({ ...draftFromPolicy({ ...EXPONENTIAL, mode: 'always' }), maxRetries: 1 });
  assert.equal(preview.steps.length, 6);
});
