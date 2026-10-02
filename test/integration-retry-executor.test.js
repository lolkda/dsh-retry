/**
 * Integration acceptance against the real installed retry executor.
 *
 * These tests mount the shipped `@deepseek-ai/dsh-llm-retry` plugin (its own
 * `apply`) on a real `@deepseek-ai/cordis` context and dispatch
 * `agent/request-error` through the real agent dispatcher
 * (`agentEvents(...).waterfall`), which is exactly how `dsh-agent-loop`
 * reaches the executor. Every attempt count, delay, and event below is
 * produced by the shipped retry code, not by a re-implementation.
 *
 * Real modules: `@deepseek-ai/cordis`, `@deepseek-ai/dsh-agent`
 * (`agentEvents`), `@deepseek-ai/dsh-llm` (`resolveRetryPolicy`), and
 * `@deepseek-ai/dsh-llm-retry` (the executor under test).
 *
 * Test doubles, and their exact boundary:
 * - `agents` is an empty service object. The executor declares it in `inject`
 *   but never reads it on the recovery path, so this only satisfies
 *   activation.
 * - `sessionProjections` folds the registered projection definition over the
 *   session's event list on demand. The shipped service maintains the same
 *   fold incrementally with checkpoints; because the projection's `apply` is
 *   pure and returns the same reference for events it ignores, folding the
 *   whole log yields the same state.
 * - The `agent`/`session` pair records `session.append(type, data)` into an
 *   event list, matching the durable-append contract the executor relies on.
 *   No provider request is ever made: the "attempt" is a counter in the test.
 *
 * @module test/integration-retry-executor
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { loadDshModule } from './fixtures/dsh-runtime.js';
import { normalizePolicy } from '../src/policy.js';

const { Context } = await loadDshModule('@deepseek-ai/cordis');
const { agentEvents } = await loadDshModule('@deepseek-ai/dsh-agent');
const { resolveRetryPolicy } = await loadDshModule('@deepseek-ai/dsh-llm');
const {
  apply: applyRetryExecutor,
  inject: retryExecutorInject,
  name: retryExecutorName,
} = await loadDshModule('@deepseek-ai/dsh-llm-retry');

const FIXTURE_PROVIDER = 'cpa';
const TURN = 1;
const STEP = 1;

/** A fast backoff so a retry-driven test costs milliseconds, never seconds. */
function fastPolicy(overrides = {}) {
  return resolveRetryPolicy(
    {
      mode: 'normal',
      maxRetries: 2,
      backoff: { initialDelayMs: 1, maxDelayMs: 5, jitterRatio: 0 },
      ...overrides,
    },
    'integration.retryPolicy',
  );
}

/**
 * Mount the shipped retry executor on a real Cordis context.
 * @returns the context, the dispatching agent, and the recorded session.
 */
async function mountRetryExecutor() {
  const ctx = new Context();
  const definitions = new Map();
  ctx.provide('agents', {});
  ctx.provide('sessionProjections', {
    register(definition) {
      definitions.set(definition.key, definition);
      return () => definitions.delete(definition.key);
    },
    stateOf(session, key) {
      const definition = definitions.get(key);
      let state = definition.init();
      for (const event of session.events) state = definition.apply(state, event);
      return state;
    },
  });
  const session = {
    events: [],
    append(type, data) {
      this.events.push({ type, data });
      return { seq: this.events.length };
    },
  };
  const agent = { id: 'integration-agent', session };
  const fiber = ctx.plugin({ name: retryExecutorName, inject: retryExecutorInject, apply: applyRetryExecutor });
  // The plugin activation is asynchronous; dispatch before it settles would
  // simply find no listener, which would make every assertion below vacuous.
  for (let attempt = 0; attempt < 200 && fiber.state !== 2; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  assert.equal(fiber.state, 2, `retry executor did not activate: ${String(fiber.error)}`);
  return { ctx, agent, session };
}

/**
 * Drive one turn to completion the way the agent loop does: fail, ask the
 * executor for an action, and continue only while it answers `retry`.
 * @returns the attempt count and the types the executor appended.
 */
async function driveTurn({
  policy,
  code = 'RATE_LIMIT',
  providerRetryAfterMs,
  signal = new AbortController().signal,
  maxAttempts = 12,
}) {
  const { ctx, agent, session } = await mountRetryExecutor();
  let attempts = 0;
  try {
    while (attempts < maxAttempts) {
      attempts += 1;
      const failure = {
        message: `synthetic ${code}`,
        code,
        ...providerRetryAfterMs === undefined ? {} : { providerRetryAfterMs },
      };
      const action = await agentEvents(ctx, agent).waterfall(
        'agent/request-error',
        { turn: TURN, step: STEP, provider: FIXTURE_PROVIDER, failure, retryPolicy: policy, signal },
        () => Promise.resolve(undefined),
      );
      if (action?.kind !== 'retry') break;
    }
    return { attempts, events: session.events.map((event) => ({ type: event.type, data: event.data })) };
  } finally {
    await ctx.fiber.dispose();
  }
}

test('a rate limit with maxRetries 2 produces three attempts and two native retry pairs', async () => {
  const { attempts, events } = await driveTurn({ policy: fastPolicy() });
  assert.equal(attempts, 3, 'the initial request plus two retries');
  assert.deepEqual(
    events.map((event) => event.type),
    ['llm/retry', 'llm/retry-started', 'llm/retry', 'llm/retry-started'],
  );
  // The durable scheduling record names the policy that produced it.
  assert.equal(events[0].data.maxRetries, 2);
  assert.equal(events[0].data.provider, FIXTURE_PROVIDER);
  assert.equal(events[0].data.retry, 1);
  assert.equal(events[2].data.retry, 2);
  assert.equal(events[0].data.retryId, events[2].data.retryId, 'one retry chain shares its id');
});

test('maxRetries 0 disables ordinary retries', async () => {
  const { attempts, events } = await driveTurn({ policy: fastPolicy({ maxRetries: 0 }) });
  assert.equal(attempts, 1);
  assert.deepEqual(events, [], 'straight through failure, as the executor promises');
});

test('an exhausted budget stops after the configured number of retries', async () => {
  const { attempts } = await driveTurn({ policy: fastPolicy({ maxRetries: 1 }) });
  assert.equal(attempts, 2);
});

test('a code outside the default retryable set is not retried', async () => {
  const { attempts, events } = await driveTurn({ policy: resolveRetryPolicy(undefined, 'integration.retryPolicy'), code: 'AUTH' });
  assert.equal(attempts, 1, 'AUTH is a permanent failure under the native default set');
  assert.deepEqual(events, []);
});

test('a custom retryable code is retried once the policy names it', async () => {
  const policy = resolveRetryPolicy({ mode: 'normal', maxRetries: 1, retryableCodes: ['MY_GATEWAY_BUSY'] }, 'integration.retryPolicy');
  const { attempts } = await driveTurn({ policy, code: 'MY_GATEWAY_BUSY' });
  assert.equal(attempts, 2);
});

test('cancellation during backoff abandons the wait and never starts the retry', async () => {
  const controller = new AbortController();
  const slow = resolveRetryPolicy(
    { mode: 'normal', maxRetries: 5, backoff: { initialDelayMs: 5000, maxDelayMs: 10000, jitterRatio: 0 } },
    'integration.retryPolicy',
  );
  const timer = setTimeout(() => controller.abort(), 20);
  try {
    const { attempts, events } = await driveTurn({ policy: slow, signal: controller.signal });
    assert.equal(attempts, 1, 'the loop stopped after the wait was cancelled');
    assert.deepEqual(
      events.map((event) => event.type),
      ['llm/retry'],
      'the retry was scheduled durably but never marked started',
    );
  } finally {
    clearTimeout(timer);
  }
});

test("a provider Retry-After replaces the local backoff when it fits the policy", async () => {
  // jitterRatio 0 and initialDelayMs 5000 make the local delay unmistakable,
  // so a scheduled delayMs of 30 can only come from providerRetryAfterMs.
  const policy = resolveRetryPolicy(
    { mode: 'normal', maxRetries: 1, backoff: { initialDelayMs: 5000, maxDelayMs: 10000, jitterRatio: 0 } },
    'integration.retryPolicy',
  );
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 40);
  try {
    const { events } = await driveTurn({ policy, providerRetryAfterMs: 30, signal: controller.signal });
    assert.equal(events[0].type, 'llm/retry');
    assert.equal(events[0].data.delayMs, 30, 'the provider instruction won over the local backoff');
  } finally {
    clearTimeout(timer);
  }
});

test('the policy the plugin writes is accepted and preserved by the native resolver', async () => {
  const written = normalizePolicy({
    mode: 'normal',
    maxRetries: 2,
    retryableCodes: ['RATE_LIMIT', 'MY_GATEWAY_BUSY'],
    backoff: { initialDelayMs: 1000, maxDelayMs: 30000, jitterRatio: 0 },
  });
  // The raw (nested-backoff) form the plugin stores resolves into the flat
  // provider-owned form the executor consumes. Nothing the plugin wrote may be
  // rejected as an unknown key or silently dropped.
  const resolved = resolveRetryPolicy(written, 'integration.bridge');
  assert.equal(resolved.mode, 'normal');
  assert.equal(resolved.maxRetries, 2);
  assert.deepEqual([...resolved.retryableCodes], ['RATE_LIMIT', 'MY_GATEWAY_BUSY']);
  assert.equal(resolved.initialDelayMs, 1000);
  assert.equal(resolved.maxDelayMs, 30000);
  assert.equal(resolved.jitterRatio, 0);

  const { attempts } = await driveTurn({ policy: resolved });
  assert.equal(attempts, 3, 'the normalized policy drives the real executor exactly as written');
});

test('an always-mode policy retries a permanent failure without an attempt limit', async () => {
  const policy = resolveRetryPolicy({ mode: 'always', backoff: { initialDelayMs: 1, maxDelayMs: 2, jitterRatio: 0 } }, 'integration.retryPolicy');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25);
  try {
    const { attempts } = await driveTurn({ policy, code: 'AUTH', signal: controller.signal, maxAttempts: 50 });
    assert.ok(attempts > 1, 'always mode keeps asking for recovery instead of stopping at the permanent failure');
    assert.ok(attempts < 50, 'cancellation still ends the retrying');
  } finally {
    clearTimeout(timer);
  }
});
