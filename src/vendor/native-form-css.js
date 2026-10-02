/**
 * Vendored Harness CSS.
 *
 * Copied verbatim from the installed DSH packages, with the only permitted
 * change applied: every class selector is namespaced with `drs-` so this copy
 * cannot collide with a shipped stylesheet. Token references, dimensions,
 * typography, and rule order are unchanged; no rule was rewritten or pruned.
 *
 * Provenance and licence: ./PROVENANCE.md
 *
 * @module vendor/native-form-css
 */

/** settings-form/SettingsForm.module.css */
export const settingsFormCss = `/* Settings form: the controls a page shows under a plugin's title, and the save that writes them. */

.drs-form {
  display: flex;
  flex-direction: column;
}

.drs-readOnly,
.drs-unavailable {
  margin: 0 0 12px;
  font-size: 12px;
  line-height: 1.5;
  color: var(--dsw-alias-label-tertiary);
}

.drs-footer {
  display: flex;
  align-items: center;
  gap: 8px;
  padding-top: 16px;
}

.drs-failed {
  flex: 1;
  min-width: 0;
  margin: 0;
  font-size: 12px;
  line-height: 1.5;
  color: var(--dsw-alias-label-error);
}

.drs-save {
  appearance: none;
  border: 1px solid transparent;
  border-radius: var(--dsw-radius-md);
  padding: 5px 14px;
  font: inherit;
  font-size: 13px;
  line-height: 1.5;
  cursor: pointer;
  background: var(--dsw-alias-label-primary);
  color: var(--dsw-alias-bg-layer-3);
}

.drs-save:disabled {
  opacity: 0.4;
  cursor: default;
}

.drs-save:focus-visible {
  outline: var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
  outline-offset: 1px;
}
`;

/** settings-form/fields.module.css */
export const fieldsCss = `/* Settings form fields: label, control, override badge, and hint. */

.drs-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 12px 0;
}

.drs-field + .drs-field {
  border-top: 0.5px solid var(--dsw-alias-border-l2);
}

.drs-head {
  display: flex;
  align-items: center;
  gap: 8px;
}

.drs-label {
  flex: 1;
  min-width: 0;
  font-size: 13px;
  font-weight: 500;
  line-height: 1.5;
  color: var(--dsw-alias-label-primary);
}

.drs-labelGroup {
  display: flex;
  align-items: center;
  gap: 4px;
  flex: 1;
  min-width: 0;
}

.drs-labelGroup > .drs-label {
  flex: 0 1 auto;
}

.drs-helpButton {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  width: 24px;
  height: 24px;
  padding: 0;
  border: 0;
  border-radius: var(--dsw-radius-sm);
  background: none;
  color: var(--dsw-alias-label-tertiary);
  cursor: pointer;
}

.drs-helpButton:hover,
.drs-helpButton[aria-expanded='true'] {
  background: var(--dsw-alias-bg-layer-4);
  color: var(--dsw-alias-label-secondary);
}

.drs-helpButton:focus-visible {
  outline: var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
  outline-offset: 1px;
}

.drs-help {
  padding: 10px 0 0;
  font-size: 12px;
  line-height: 1.6;
  color: var(--dsw-alias-label-secondary);
}

.drs-help > p {
  margin: 0;
}

.drs-help > p + p {
  margin-top: 8px;
}

.drs-badges {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.drs-reset {
  border: none;
  background: none;
  padding: 0;
  font: inherit;
  font-size: 12px;
  line-height: 1.5;
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
}

.drs-reset:hover:not(:disabled) {
  color: var(--dsw-alias-label-primary);
}

.drs-reset:disabled {
  cursor: default;
}

.drs-input {
  height: 34px;
  padding: 0 12px;
  border: 0.5px solid var(--dsw-alias-border-l4);
  border-radius: var(--dsw-radius-md);
  background: var(--dsw-alias-bg-layer-3);
  font: inherit;
  font-size: 13px;
  line-height: 1.5;
  color: var(--dsw-alias-label-primary);
}

.drs-input:focus-visible {
  outline: none;
  border-color: var(--dsw-alias-state-business-primary);
}

.drs-input:disabled {
  color: var(--dsw-alias-label-tertiary);
  cursor: default;
}

.drs-input[aria-invalid='true'] {
  border-color: var(--dsw-alias-state-error-primary);
}

.drs-invalid {
  margin: 0;
  font-size: 12px;
  line-height: 1.5;
  color: var(--dsw-alias-state-error-primary);
}

.drs-hint {
  margin: 0;
  font-size: 12px;
  line-height: 1.5;
  color: var(--dsw-alias-label-tertiary);
}
`;

/** Tag.module.css */
export const tagCss = `/* Capsule geometry is fixed: a tag reads as one size everywhere, and only its
 * palette varies. Tone colors ride background/border/color so a render site can
 * still position the tag with its own class without touching the palette. */
.drs-tag {
  display: inline-flex;
  align-items: center;
  border-radius: 999px;
  corner-shape: round;
  padding: 1px 8px;
  font-size: 11px;
  line-height: 17px;
  font-weight: 500;
  white-space: nowrap;
}

.drs-tag[data-tone='outline'] {
  border: 0.5px solid var(--dsw-alias-border-l4);
  color: var(--dsw-alias-label-tertiary);
}

.drs-tag[data-tone='solid'] {
  background: var(--dsw-alias-label-primary);
  color: var(--dsw-alias-bg-layer-3);
}

.drs-tag[data-tone='neutral'] {
  background: var(--dsw-alias-bg-module-platform);
  color: var(--dsw-alias-label-secondary);
}

.drs-tag[data-tone='quiet'] {
  color: var(--dsw-alias-label-tertiary);
}

/* Status tones tint their own color for the fill, so a palette change moves
 * fill and text together and neither needs a second token. The tint is 10%,
 * except \`warning\`, which keeps the 12% the plugin inventory's conditional
 * tag shipped with — matching it is what makes this a pure consolidation. */
.drs-tag[data-tone='success'] {
  background: color-mix(in srgb, var(--dsw-alias-state-success-primary) 10%, transparent);
  color: var(--dsw-alias-state-success-primary);
}

.drs-tag[data-tone='info'] {
  background: color-mix(in srgb, var(--dsw-alias-state-business-primary) 10%, transparent);
  color: var(--dsw-alias-state-business-primary);
}

.drs-tag[data-tone='warning'] {
  background: color-mix(in srgb, var(--dsw-alias-state-warn-primary) 12%, transparent);
  color: var(--dsw-alias-state-warn-primary);
}

.drs-tag[data-tone='danger'] {
  background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 10%, transparent);
  color: var(--dsw-alias-state-error-primary);
}
`;

/** Checkbox.module.css */
export const checkboxCss = `.drs-checkbox {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 14px;
  line-height: 20px;
  color: var(--dsw-alias-label-primary);
  cursor: pointer;
}

.drs-checkbox input {
  flex: 0 0 auto;
  width: 16px;
  height: 16px;
  margin: 0;
  accent-color: var(--dsw-alias-brand-primary);
  cursor: inherit;
}

.drs-checkbox input:focus-visible {
  outline: var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
  outline-offset: 2px;
}

.drs-checkbox:has(input:disabled) {
  cursor: default;
  opacity: 0.5;
}
`;

/** Every vendored settings-form rule, in source order. */
export const vendoredCss = [settingsFormCss, fieldsCss, tagCss, checkboxCss].join(String.fromCharCode(10));
