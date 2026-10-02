/**
 * UI-layer draft mapping for the global retry policy.
 *
 * The shared policy module owns validation and the native policy shape; this
 * module only translates between the editable draft a form holds and the global
 * `policy` field the plugin's own settings namespace carries.
 *
 * @module ui-draft
 */

import { DEFAULT_POLICY, normalizePolicy } from './policy.js';

/** Path of the global policy inside its settings namespace. */
export const GLOBAL_POLICY_PATH = ['policy'];

/** Field names a validation failure can be attributed to, for inline display. */
const VALIDATED_FIELDS = ['maxRetries', 'initialDelayMs', 'maxDelayMs', 'jitterPercent', 'retryableCodes'];

/**
 * Build the native path op that writes the global policy.
 * @param policy - the next policy; normalized through the shared module.
 * @returns a `set` path op addressing only the global `policy` field.
 */
export function globalSetOperation(policy) {
  return { op: 'set', path: [...GLOBAL_POLICY_PATH], value: normalizePolicy(policy) };
}

/**
 * Build the native path op that clears the global policy.
 * @returns an `unset` path op addressing only the global `policy` field.
 */
export function globalResetOperation() {
  return { op: 'unset', path: [...GLOBAL_POLICY_PATH] };
}

/** Path of one provider override inside its settings namespace. */
export function providerPolicyPath(provider) {
  return ['providers', provider];
}

/**
 * Build the native path op that writes one provider override.
 * @param provider - provider id.
 * @param policy - the next policy; normalized through the shared module.
 * @returns a `set` path op addressing only that provider's override.
 */
export function providerSetOperation(provider, policy) {
  return { op: 'set', path: providerPolicyPath(provider), value: normalizePolicy(policy) };
}

/**
 * Build the native path op that clears one provider override.
 * @param provider - provider id.
 * @returns an `unset` path op addressing only that provider's override.
 */
export function providerResetOperation(provider) {
  return { op: 'unset', path: providerPolicyPath(provider) };
}

/**
 * Project a native policy into the editable draft a form holds.
 * @param policy - native raw policy, or `undefined` for the native defaults.
 * @returns the draft: mode, retries, milliseconds, jitter as a percentage, codes.
 */
export function draftFromPolicy(policy) {
  const resolved = normalizePolicy(policy);
  return {
    mode: resolved.mode,
    maxRetries: resolved.mode === 'always' ? DEFAULT_POLICY.maxRetries : resolved.maxRetries,
    initialDelayMs: resolved.backoff.initialDelayMs,
    maxDelayMs: resolved.backoff.maxDelayMs,
    jitterPercent: resolved.backoff.jitterRatio * 100,
    retryableCodes: [...(resolved.mode === 'always' ? DEFAULT_POLICY.retryableCodes : resolved.retryableCodes)]
  };
}

/**
 * Read one numeric draft field, refusing blank input instead of letting the
 * shared layer treat it as an omitted field and substitute a native default.
 * @param value - raw draft value.
 * @param label - diagnostic name of the field.
 * @returns the finite number the user entered.
 */
function requireNumber(value, label) {
  if (value === null || value === undefined || (typeof value === 'string' && value.trim() === '')) {
    throw new Error(`${label} is required`);
  }
  const resolved = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(resolved)) throw new Error(`${label} must be a number`);
  return resolved;
}

/**
 * Convert an edited draft back into a native raw policy for shared validation.
 *
 * A blank number stays an error here: passing it through would let the shared
 * layer fall back to a native default and save a value the user never entered.
 *
 * @param draft - draft produced by {@link draftFromPolicy} and edited by the form.
 * @returns a native raw policy; `always` carries only mode and backoff.
 * @throws {Error} when a numeric field is blank or not a finite number.
 */
export function policyFromDraft(draft) {
  const backoff = {
    initialDelayMs: requireNumber(draft.initialDelayMs, 'policy.backoff.initialDelayMs'),
    maxDelayMs: requireNumber(draft.maxDelayMs, 'policy.backoff.maxDelayMs'),
    jitterRatio: requireNumber(draft.jitterPercent, 'policy.backoff.jitterPercent') / 100
  };
  if (draft.mode === 'always') return { mode: 'always', backoff };
  return {
    mode: 'normal',
    maxRetries: requireNumber(draft.maxRetries, 'policy.maxRetries'),
    retryableCodes: [...draft.retryableCodes],
    backoff
  };
}

/**
 * Attribute the draft's validation failure to the field that caused it.
 *
 * The rules stay in the shared module: this runs the same validation the save
 * path runs and maps its message to a field name for inline display.
 *
 * @param draft - current draft, possibly invalid.
 * @returns a map of field name to the message shown under that field; empty when valid.
 */
export function draftFieldErrors(draft) {
  if (draft === null || draft === undefined) return {};
  try {
    normalizePolicy(policyFromDraft(draft));
    return {};
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const field = VALIDATED_FIELDS.find(name => message.includes(name)) ?? 'form';
    return { [field]: message };
  }
}

/**
 * Report whether an edited draft still differs from the policy in force.
 * @param draft - current draft, possibly invalid.
 * @param policy - the effective native policy, or `undefined` when unconfigured.
 * @returns true when saving would write a different value.
 */
export function draftIsDirty(draft, policy) {
  return JSON.stringify(draftFromPolicy(policy)) !== JSON.stringify(draft ?? draftFromPolicy(policy));
}
