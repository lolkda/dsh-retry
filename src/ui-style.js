/**
 * Retry settings stylesheet.
 *
 * The page no longer renames the shipped settings-form classes; it now follows
 * the visual language of the DSH web client itself. Every rule here is built
 * from the public `--dsw-*` design tokens and mirrors the structure of the
 * shipped primitives (SegmentedControl, Button, Input, Tag/Pill, Checkbox,
 * StateDot — `@deepseek-ai/dsh-client-ui-primitives@0.2.0-rc.2`, MIT). Only
 * stable, plugin-prefixed `drs-` class names are used, so the stylesheet can
 * never collide with a shipped stylesheet or depend on a generated hash.
 *
 * Because the rules are rebuilt from token contracts rather than copied
 * byte-for-byte, no selector namespace transform applies here. The native
 * source snapshots stay under `src/vendor` for provenance verification.
 *
 * @module ui-style
 */

export const uiCss = `
.drs-section {
  max-width: 720px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  color: var(--dsw-alias-label-primary);
}

/* Page heading. The settings shell draws no title for a section page, so the
 * page keeps the official section-head structure and adds a global badge. */
.drs-titleRow {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.drs-title {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
  line-height: 1.4;
}

.drs-intro {
  margin: 0;
  font-size: 13px;
  line-height: 1.6;
  color: var(--dsw-alias-label-tertiary);
}

/* Tag tones follow dsh-client-ui-primitives/Tag.module.css. */
.drs-tag {
  display: inline-flex;
  align-items: center;
  border-radius: 999px;
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

.drs-tag[data-tone='neutral'] {
  background: var(--dsw-alias-bg-module-platform);
  color: var(--dsw-alias-label-secondary);
}

.drs-tag[data-tone='success'] {
  background: var(--dsw-alias-bg-layer-2);
  background: color-mix(in srgb, var(--dsw-alias-state-success-primary) 10%, transparent);
  color: var(--dsw-alias-state-success-primary);
}

.drs-tag[data-tone='warning'] {
  background: var(--dsw-alias-bg-layer-2);
  background: color-mix(in srgb, var(--dsw-alias-state-warn-primary) 12%, transparent);
  color: var(--dsw-alias-state-warn-primary);
}

.drs-tag[data-tone='danger'] {
  background: var(--dsw-alias-bg-layer-2);
  background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 10%, transparent);
  color: var(--dsw-alias-state-error-primary);
}

.drs-readOnly,
.drs-unavailable {
  margin: 0;
  font-size: 12px;
  line-height: 1.5;
  color: var(--dsw-alias-label-tertiary);
}

.drs-notice {
  margin: 0;
  padding: 8px 12px;
  border-radius: var(--dsw-radius-md);
  font-size: 12px;
  line-height: 1.5;
}

.drs-notice[data-tone='success'] {
  background: var(--dsw-alias-bg-layer-2);
  background: color-mix(in srgb, var(--dsw-alias-state-success-primary) 10%, transparent);
  color: var(--dsw-alias-state-success-primary);
}

.drs-notice[data-tone='info'] {
  background: var(--dsw-alias-bg-layer-2);
  background: color-mix(in srgb, var(--dsw-alias-state-business-primary) 10%, transparent);
  color: var(--dsw-alias-state-business-primary);
}

.drs-notice[data-tone='warning'] {
  background: var(--dsw-alias-bg-layer-2);
  background: color-mix(in srgb, var(--dsw-alias-state-warn-primary) 12%, transparent);
  color: var(--dsw-alias-state-warn-primary);
}

.drs-notice[data-tone='danger'] {
  background: var(--dsw-alias-bg-layer-2);
  background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 10%, transparent);
  color: var(--dsw-alias-state-error-primary);
}

.drs-form {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

/* One raised settings surface, like the cards on the shipped Agent presets
 * page (\`--dsw-alias-settings-card-*\`, \`--dsw-radius-xl\`). */
.drs-panel {
  border: 0.5px solid var(--dsw-alias-settings-card-stroke, var(--dsw-alias-border-l4));
  border-radius: var(--dsw-radius-xl);
  background: var(--dsw-alias-settings-card-fill, var(--dsw-alias-bg-layer-2));
  overflow: hidden;
}

.drs-panelSection {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 16px;
}

.drs-panelSection + .drs-panelSection {
  border-top: 0.5px solid var(--dsw-alias-border-l2);
}

.drs-head {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.drs-labelGroup {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  min-width: 0;
}

.drs-panelTitle {
  flex: 0 1 auto;
  min-width: 0;
  margin: 0;
  font-size: 13px;
  font-weight: 600;
  line-height: 1.5;
  color: var(--dsw-alias-label-primary);
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
  opacity: 0.4;
}

.drs-reset:focus-visible {
  outline: var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
  outline-offset: 2px;
}

/* Segmented control, structurally the shipped SegmentedControl: a translucent
 * track, an elevated sliding indicator positioned by custom properties, and
 * equal-width tab segments. */
.drs-segmented {
  position: relative;
  display: inline-grid;
  grid-auto-flow: column;
  grid-auto-columns: 1fr;
  gap: 2px;
  align-self: flex-start;
  padding: 4px;
  border-radius: var(--dsw-radius-md);
  background: var(--dsw-alias-interactive-bg-hover);
}

.drs-segmentedIndicator {
  position: absolute;
  top: 4px;
  left: 4px;
  width: calc((100% - 8px - 2px * (var(--drs-segment-count) - 1)) / var(--drs-segment-count));
  height: calc(100% - 8px);
  border-radius: var(--dsw-radius-sm);
  background: var(--dsw-alias-bg-layer-1);
  box-shadow: var(--dsw-elevation-soft);
  transform: translateX(calc(var(--drs-segment-index) * (100% + 2px)));
  transition: transform 160ms ease;
  pointer-events: none;
}

.drs-segment {
  box-sizing: border-box;
  position: relative;
  z-index: 1;
  height: 28px;
  padding: 0 16px;
  border: 0;
  border-radius: var(--dsw-radius-sm);
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  font: inherit;
  font-size: 13px;
  line-height: 20px;
  font-weight: 500;
  white-space: nowrap;
  cursor: pointer;
  transition: color 120ms ease;
}

.drs-segment:hover:not(:disabled),
.drs-segment[aria-selected='true'] {
  color: var(--dsw-alias-label-primary);
}

.drs-segment:disabled {
  cursor: default;
  opacity: 0.4;
}

.drs-segment:focus-visible {
  outline: var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
  outline-offset: -2px;
}

/* Numeric fields. */
.drs-numberGrid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.drs-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.drs-label {
  font-size: 13px;
  font-weight: 500;
  line-height: 1.5;
  color: var(--dsw-alias-label-primary);
}

.drs-inputShell {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 34px;
  padding: 0 12px;
  border: 0.5px solid var(--dsw-alias-border-l4);
  border-radius: var(--dsw-radius-md);
  background: var(--dsw-alias-bg-layer-3);
  transition: border-color 120ms ease;
}

.drs-inputShell:focus-within {
  border-color: var(--dsw-alias-state-business-primary);
}

.drs-inputShell[data-invalid='true'],
.drs-inputShell[data-invalid='true']:focus-within {
  border-color: var(--dsw-alias-state-error-primary);
}

.drs-input {
  flex: 1;
  min-width: 0;
  border: 0;
  outline: 0;
  background: transparent;
  font: inherit;
  font-size: 13px;
  line-height: 1.5;
  color: var(--dsw-alias-label-primary);
}

.drs-input::placeholder {
  color: var(--dsw-alias-label-dimmed);
}

.drs-input:disabled {
  color: var(--dsw-alias-label-tertiary);
  cursor: default;
}

.drs-inputUnit {
  flex: none;
  font-size: 12px;
  line-height: 1.5;
  color: var(--dsw-alias-label-tertiary);
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

/* Retryable codes as selectable chips: the checked state uses the same ghost
 * active fill and inset border as the shipped Pill component. */
.drs-chipList {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.drs-chip {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 28px;
  padding: 0 12px;
  border: 0.5px solid var(--dsw-alias-border-l4);
  border-radius: 999px;
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-secondary);
  font-size: 12px;
  line-height: 18px;
  cursor: pointer;
  transition: border-color 120ms ease, background 120ms ease, color 120ms ease;
}

.drs-chip input {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  margin: 0;
  opacity: 0;
  cursor: inherit;
}

.drs-chip:hover:not(:has(input:disabled)) {
  background: var(--dsw-alias-interactive-bg-hover);
}

.drs-chip[data-checked='true'] {
  background: var(--dsw-alias-button-ghost-active-fill);
  border-color: var(--dsw-alias-button-ghost-active-border);
  color: var(--dsw-alias-label-primary);
  font-weight: 500;
}

.drs-chip:has(input:disabled) {
  cursor: default;
  opacity: 0.5;
}

.drs-chip:has(input:focus-visible) {
  outline: var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
  outline-offset: 2px;
}

.drs-chipCustom {
  padding-right: 6px;
  font-family: var(--dsw-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
  cursor: default;
}

.drs-chipRemove {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: var(--dsw-alias-label-tertiary);
  font: inherit;
  font-size: 14px;
  line-height: 1;
  padding: 0;
  cursor: pointer;
}

.drs-chipRemove:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-primary);
}

.drs-chipRemove:disabled {
  cursor: default;
  opacity: 0.4;
}

.drs-chipRemove:focus-visible {
  outline: var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
  outline-offset: 1px;
}

.drs-addRow {
  display: flex;
  align-items: center;
  gap: 8px;
}

.drs-addRow .drs-inputShell {
  flex: 1;
  min-width: 0;
}

.drs-addRow .drs-secondaryButton {
  height: 34px;
}

/* Synchronization summary. The state dot follows StateDot's data-state tones. */
.drs-sync {
  display: flex;
  flex-direction: column;
  gap: 8px;
  border: 0.5px solid var(--dsw-alias-settings-card-stroke, var(--dsw-alias-border-l4));
  border-radius: var(--dsw-radius-xl);
  background: var(--dsw-alias-settings-card-fill, var(--dsw-alias-bg-layer-2));
  padding: 12px 16px;
}

.drs-syncHead {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.drs-stateDot {
  flex: none;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: currentColor;
}

.drs-stateDot[data-state='done'] {
  color: var(--dsw-alias-state-success-primary);
}

.drs-stateDot[data-state='warning'] {
  color: var(--dsw-alias-state-warn-primary);
}

.drs-stateDot[data-state='error'] {
  color: var(--dsw-alias-state-error-primary);
}

.drs-stateDot[data-state='idle'] {
  color: var(--dsw-alias-state-idle-primary);
}

.drs-syncTitle {
  font-size: 13px;
  font-weight: 600;
  line-height: 1.5;
  color: var(--dsw-alias-label-primary);
}

.drs-syncCount {
  margin-left: auto;
  font-size: 12px;
  line-height: 1.5;
  color: var(--dsw-alias-label-tertiary);
}

.drs-syncList {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.drs-syncItem {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin: 0;
  font-size: 12px;
  line-height: 1.6;
  color: var(--dsw-alias-label-secondary);
}

.drs-syncProvider {
  font-family: var(--dsw-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
  color: var(--dsw-alias-label-primary);
}

/* Buttons follow the shipped Button heights and fills. */
.drs-save {
  box-sizing: border-box;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 36px;
  padding: 0 16px;
  border: none;
  border-radius: var(--dsw-radius-md);
  background: var(--dsw-alias-button-primary-fill);
  color: var(--dsw-alias-label-primary-foreground);
  font: inherit;
  font-size: 14px;
  line-height: 22px;
  font-weight: 500;
  cursor: pointer;
}

.drs-save:hover:not(:disabled) {
  background: var(--dsw-alias-button-primary-hover);
}

.drs-save:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.drs-save:focus-visible {
  outline: var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
  outline-offset: 1px;
}

.drs-secondaryButton {
  box-sizing: border-box;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 36px;
  padding: 0 14px;
  border: 0.5px solid var(--dsw-alias-border-l3);
  border-radius: var(--dsw-radius-md);
  background: transparent;
  color: var(--dsw-alias-label-primary);
  font: inherit;
  font-size: 14px;
  line-height: 22px;
  cursor: pointer;
}

.drs-secondaryButton:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover);
}

.drs-secondaryButton:active:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-active);
}

.drs-secondaryButton:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.drs-secondaryButton:focus-visible {
  outline: var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
  outline-offset: 1px;
}

.drs-footer {
  display: flex;
  align-items: center;
  gap: 8px;
  padding-top: 4px;
}

.drs-failed {
  flex: 1;
  min-width: 0;
  margin: 0;
  font-size: 12px;
  line-height: 1.5;
  color: var(--dsw-alias-state-error-primary);
}

.drs-dirty {
  margin: 0;
  font-size: 12px;
  line-height: 1.5;
  color: var(--dsw-alias-label-tertiary);
}


/* Global-default section and per-provider override rows. */
.drs-globalSection,
.drs-providersSection {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

/* Compact synchronization summary shown above the provider-override list. */
.drs-providerSummary {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0;
}

.drs-providerSummary .drs-hint {
  flex: 1;
  min-width: 0;
}

.drs-providerSummary .drs-syncList {
  flex-basis: 100%;
}

.drs-providerList {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.drs-providerCard {
  display: flex;
  flex-direction: column;
  gap: 8px;
  border: 0.5px solid var(--dsw-alias-settings-card-stroke, var(--dsw-alias-border-l4));
  border-radius: var(--dsw-radius-xl);
  background: var(--dsw-alias-settings-card-fill, var(--dsw-alias-bg-layer-2));
  padding: 12px 16px;
}

.drs-providerHead {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.drs-providerName {
  display: flex;
  align-items: baseline;
  gap: 6px;
  min-width: 0;
  flex: 1;
}

.drs-providerDisplayName {
  font-size: 13px;
  font-weight: 600;
  line-height: 1.5;
  color: var(--dsw-alias-label-primary);
}

.drs-providerId {
  font-family: var(--dsw-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
  font-size: 11px;
  line-height: 1.5;
  color: var(--dsw-alias-label-tertiary);
}

.drs-providerAction {
  height: 28px;
  padding: 0 10px;
  font-size: 12px;
  line-height: 18px;
  border-radius: var(--dsw-radius-sm);
}

.drs-providerEditor {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-top: 4px;
}

.drs-providerEditor .drs-footer {
  padding-top: 0;
}

.drs-providerEditor .drs-panel {
  background: var(--dsw-alias-bg-layer-1);
}

@media (max-width: 560px) {
  .drs-numberGrid {
    grid-template-columns: 1fr;
  }

  .drs-panelSection {
    padding: 14px;
  }

  .drs-segmented {
    align-self: stretch;
    width: 100%;
  }

  .drs-footer {
    flex-wrap: wrap;
  }

  .drs-failed {
    flex-basis: 100%;
  }
}

@media (prefers-reduced-motion: reduce) {
  .drs-segmentedIndicator,
  .drs-segment,
  .drs-chip,
  .drs-inputShell {
    transition: none;
  }
}
`;
