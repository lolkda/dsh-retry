/**
 * Fixture provider adapter for integration tests.
 *
 * It stands in for a real adapter such as `@deepseek-ai/dsh-llm-pi-ai`, whose
 * providers carry the same `RetryPolicySchema` under a `.volatile()` subtree.
 * Mounting the real adapter would pull the pi-ai transport and the credential
 * plane into a configuration test without changing what is being asserted
 * here: the schema, its volatility, the settings revision, and the path ops
 * are all the shipped ones.
 *
 * The registry value is kept in a module global so tests can prove the plugin
 * mounted with the composed config.
 *
 * @module test/fixtures/retry-provider
 */
import z from '@deepseek-ai/schemastery';
import { RetryPolicySchema } from '@deepseek-ai/dsh-llm';

export const name = 'fixture-provider';
export const inject = [];

const profile = z.object({
  displayName: z.string(),
  // A real `role('secret')` field: the redaction walker strips it from every
  // remote read, so a path-op write that restated configuration would leak or
  // destroy it.
  apiKeyEnv: z.string().role('secret'),
  baseURL: z.string(),
  retryPolicy: RetryPolicySchema,
});

export const Config = z.object({ providers: z.dict(profile).default({}).volatile() });

export function apply(ctx, config) {
  globalThis.__dshRetryFixtureConfig = config;
}
