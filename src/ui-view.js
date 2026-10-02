/**
 * Retry settings section view.
 *
 * Pure presentation over a controller snapshot: the section renders one global
 * default policy plus optional per-provider overrides. Every mutation is
 * requested through the `actions` object. The page follows the DSH web client's
 * visual language: settings cards, segmented mode control, input shells, code
 * chips, state-dot rows, and Button-sized actions.
 *
 * @module ui-view
 */

import React from 'react';

const h = React.createElement;

/** Numeric draft fields, in display order, with hint and unit label keys. */
const NUMERIC_FIELDS = [
  ['maxRetries', 'maxRetriesHint', 'unitRetries'],
  ['initialDelayMs', null, 'unitMilliseconds'],
  ['maxDelayMs', null, 'unitMilliseconds'],
  ['jitterPercent', null, 'unitPercent']
];

const MODES = [
  ['normal', 'modeNormal'],
  ['always', 'modeAlways']
];

/** Blank input stays null so the shared layer rejects it instead of defaulting. */
function parseNumeric(raw) {
  return raw.trim() === '' ? null : Number(raw);
}

/** Map a controller notice kind onto the design-system tone used by the UI. */
function noticeTone(kind) {
  switch (kind) {
    case 'saved': return 'success';
    case 'unconfigured': return 'info';
    case 'external':
    case 'conflict': return 'warning';
    default: return 'danger';
  }
}

function draftSummary(draft) {
  if (draft === null || draft === undefined) return '';
  if (draft.mode === 'always') return 'always · backoff';
  return `normal · ${draft.maxRetries} retries`;
}

/**
 * Render the global retry policy editor with optional provider overrides.
 * @param props - `snapshot`, `actions`, `t`.
 * @returns the section element tree.
 */
export function RetrySettingsView({ snapshot, actions, t }) {
  const [customCode, setCustomCode] = React.useState('');
  const [providerCustomCode, setProviderCustomCode] = React.useState('');

  const header = [
    h(
      'div',
      { key: 'heading', className: 'drs-titleRow' },
      h('h2', { key: 'title', className: 'drs-title' }, t('nav')),
      h('span', { key: 'global', className: 'drs-tag', 'data-tone': 'outline' }, t('globalBadge'))
    ),
    h('p', { key: 'intro', className: 'drs-intro' }, t('intro'))
  ];
  const statusLine = (key, text) => h('p', { key, className: 'drs-unavailable', role: 'status' }, text);

  if (snapshot.status === 'loading') {
    return h('section', { className: 'drs-section' }, [...header, statusLine('loading', t('loading'))]);
  }
  if (snapshot.available !== true) {
    return h(
      'section',
      { className: 'drs-section' },
      [...header, statusLine('unavailable', snapshot.notice?.message ?? t('unavailable'))]
    );
  }

  const selectedProvider = snapshot.selectedProvider ?? null;
  const draft = snapshot.draft;
  const fieldErrors = snapshot.fieldErrors ?? {};
  const invalid = Object.keys(fieldErrors).length > 0;
  const globalLocked = draft === null || snapshot.writable !== true || snapshot.saving === true || selectedProvider !== null;
  const blocked = snapshot.saving === true || (snapshot.dirty !== true && snapshot.configured === true) || invalid || snapshot.writable !== true || selectedProvider !== null;
  const defaultCodes = snapshot.defaultCodes ?? [];
  const customCodes = (draft?.retryableCodes ?? []).filter(code => !defaultCodes.includes(code));
  const sync = snapshot.sync;
  const pending = sync === null || sync === undefined ? [] : sync.pending;
  const total = sync?.total ?? 0;
  const synced = sync?.synced ?? 0;
  const syncState = total === 0 ? 'idle' : (pending.length === 0 ? 'done' : 'warning');

  const notice = snapshot.notice;
  const noticeText = notice === null || notice === undefined
    ? null
    : notice.message ?? t(notice.kind === 'external' ? 'externalChanged' : notice.kind);
  const noticeQuiet = notice?.kind === 'saved' || notice?.kind === 'unconfigured';
  const syncReason = reason => reason === 'the provider policy differs from the global policy' ? t('syncDiffers') : reason;

  const numericField = ({ field, hintKey, unitKey, value, error, locked, onChange, idPrefix }) => h(
    'div',
    { className: 'drs-field', key: field },
    h('label', { className: 'drs-label', htmlFor: `${idPrefix}-${field}` }, t(field)),
    h(
      'div',
      { className: 'drs-inputShell', 'data-invalid': error === undefined ? 'false' : 'true' },
      h('input', {
        id: `${idPrefix}-${field}`,
        className: 'drs-input',
        type: 'text',
        inputMode: 'numeric',
        ...(error === undefined ? {} : { 'aria-invalid': true }),
        value: value ?? '',
        disabled: locked,
        onChange: event => onChange(field, parseNumeric(event.target.value))
      }),
      h('span', { className: 'drs-inputUnit' }, t(unitKey))
    ),
    error === undefined
      ? (hintKey === null ? null : h('p', { className: 'drs-hint' }, t(hintKey)))
      : h('p', { className: 'drs-invalid' }, error)
  );

  const segmentControl = ({ draft, locked, onChange }) => {
    const segmentIndex = Math.max(0, MODES.findIndex(([value]) => value === draft.mode));
    return h(
      'div',
      {
        role: 'tablist',
        'aria-label': t('mode'),
        className: 'drs-segmented',
        style: { '--drs-segment-count': String(MODES.length), '--drs-segment-index': String(segmentIndex) }
      },
      h('span', { 'aria-hidden': 'true', className: 'drs-segmentedIndicator' }),
      MODES.map(([value, labelKey]) =>
        h(
          'button',
          {
            key: value,
            type: 'button',
            role: 'tab',
            className: 'drs-segment',
            'aria-selected': draft.mode === value,
            tabIndex: draft.mode === value ? 0 : -1,
            disabled: locked,
            onClick: () => onChange('mode', value)
          },
          t(labelKey)
        ))
    );
  };

  const codesEditor = ({ draft, locked, onToggle, onAdd, onRemove, custom, setCustom, idPrefix }) => {
    const codes = draft.retryableCodes ?? [];
    const extras = codes.filter(code => !defaultCodes.includes(code));
    return [
      h('p', { key: 'policyHint', className: 'drs-hint' }, t('policyHint')),
      h(
        'div',
        { key: 'chips', role: 'group', 'aria-label': t('retryableCodes'), className: 'drs-chipList' },
        defaultCodes.map(code =>
          h(
            'label',
            { key: code, className: 'drs-chip', 'data-checked': String(codes.includes(code)) },
            h('input', {
              type: 'checkbox',
              value: code,
              checked: codes.includes(code),
              disabled: locked,
              onChange: event => onToggle(code, event.target.checked)
            }),
            h('span', null, code)
          )),
        extras.map(code =>
          h(
            'span',
            { key: code, className: 'drs-chip drs-chipCustom' },
            code,
            h(
              'button',
              {
                type: 'button',
                className: 'drs-chipRemove',
                'aria-label': `${t('removeCode')} ${code}`,
                disabled: locked,
                onClick: () => onRemove(code)
              },
              '×'
            )
          ))
      ),
      h('span', { key: 'customLabel', className: 'drs-label' }, t('codeCustom')),
      h(
        'div',
        { key: 'addRow', className: 'drs-addRow' },
        h(
          'div',
          { className: 'drs-inputShell' },
          h('input', {
            className: 'drs-input',
            type: 'text',
            'aria-label': t('customCode'),
            placeholder: t('customCodePlaceholder'),
            value: custom,
            disabled: locked,
            onChange: event => setCustom(event.target.value)
          })
        ),
        h(
          'button',
          {
            type: 'button',
            className: 'drs-secondaryButton',
            disabled: locked || custom.trim() === '',
            onClick: () => {
              const value = custom.trim();
              if (value === '') return;
              onAdd(value);
              setCustom('');
            }
          },
          t('add')
        )
      )
    ];
  };

  const policyEditor = ({ draft, fieldErrors, locked, onSetField, onToggleCode, onAddCode, onRemoveCode, custom, setCustom, idPrefix }) => {
    const fields = draft.mode === 'normal' ? NUMERIC_FIELDS : NUMERIC_FIELDS.filter(([field]) => field !== 'maxRetries');
    return h(
      'div',
      { className: 'drs-panel' },
      h(
        'div',
        { key: 'mode', className: 'drs-panelSection' },
        h(
          'div',
          { className: 'drs-head' },
          h('div', { className: 'drs-labelGroup' }, h('h3', { className: 'drs-panelTitle' }, t('mode')))
        ),
        segmentControl({ draft, locked, onChange: onSetField }),
        draft.mode === 'always' ? h('p', { className: 'drs-hint' }, t('alwaysNote')) : null
      ),
      h(
        'div',
        { key: 'parameters', className: 'drs-panelSection' },
        h(
          'div',
          { className: 'drs-head' },
          h('div', { className: 'drs-labelGroup' }, h('h3', { className: 'drs-panelTitle' }, t('parametersTitle')))
        ),
        h(
          'div',
          { className: 'drs-numberGrid' },
          fields.map(([field, hintKey, unitKey]) => numericField({
            field,
            hintKey,
            unitKey,
            value: draft[field],
            error: fieldErrors[field],
            locked,
            onChange: onSetField,
            idPrefix
          }))
        ),
        h('p', { className: 'drs-hint' }, t('backoffHint'))
      ),
      draft.mode === 'normal'
        ? h(
            'div',
            { key: 'codes', className: 'drs-panelSection' },
            h(
              'div',
              { className: 'drs-head' },
              h('div', { className: 'drs-labelGroup' }, h('h3', { className: 'drs-panelTitle' }, t('retryableCodes')))
            ),
            ...codesEditor({
              draft,
              locked,
              onToggle: onToggleCode,
              onAdd: onAddCode,
              onRemove: onRemoveCode,
              custom,
              setCustom,
              idPrefix
            })
          )
        : null
    );
  };

  const globalEditor = selectedProvider => policyEditor({
    draft,
    fieldErrors,
    locked: globalLocked,
    onSetField: actions.setField,
    onToggleCode: actions.toggleCode,
    onAddCode: actions.addCustomCode,
    onRemoveCode: actions.removeCustomCode,
    custom: customCode,
    setCustom: setCustomCode,
    idPrefix: 'drs'
  });

  const providerRows = snapshot.providers ?? [];
  const provider = providerRows.find(row => row.provider === selectedProvider) ?? null;
  const providerDraft = snapshot.providerDraft;
  const providerErrors = snapshot.providerFieldErrors ?? {};
  const providerLocked = providerDraft === null || snapshot.writable !== true || snapshot.saving === true;
  const providerBlocked = snapshot.saving === true || (snapshot.providerDirty !== true && snapshot.providerConfigured === true) || Object.keys(providerErrors).length > 0 || snapshot.writable !== true;

  const children = [
    snapshot.writable === true
      ? null
      : h('p', { key: 'readonly', className: 'drs-readOnly', role: 'status' }, t('readOnly')),
    snapshot.error === null || snapshot.error === undefined
      ? null
      : h('p', { key: 'error', className: 'drs-notice', 'data-tone': 'danger', role: 'alert' }, `${t('readFailed')}${snapshot.error}`),
    noticeText === null
      ? null
      : h(
          'p',
          {
            key: 'notice',
            className: 'drs-notice',
            'data-tone': noticeTone(notice.kind),
            role: noticeQuiet ? 'status' : 'alert',
            'data-kind': notice.kind
          },
          noticeText
        ),
    h(
      'div',
      { key: 'globalSection', className: 'drs-globalSection' },
      h(
        'div',
        { className: 'drs-head' },
        h(
          'div',
          { className: 'drs-labelGroup' },
          h('h3', { className: 'drs-panelTitle' }, t('globalTitle')),
          snapshot.configured === true
            ? h('span', { className: 'drs-badges' }, h('span', { className: 'drs-tag', 'data-tone': 'neutral' }, t('overridden')))
            : h('span', { className: 'drs-badges' }, h('span', { className: 'drs-tag', 'data-tone': 'info' }, t('unconfiguredBadge')))
        ),
        snapshot.configured === true && selectedProvider === null
          ? h(
              'button',
              {
                type: 'button',
                className: 'drs-reset',
                disabled: globalLocked,
                onClick: () => actions.restoreInherited()
              },
              t('resetToDefault')
            )
          : null
      ),
      globalEditor(selectedProvider)
    ),
    h(
      'div',
      { key: 'providers', className: 'drs-providersSection' },
      h(
        'div',
        { className: 'drs-head' },
        h('div', { className: 'drs-labelGroup' }, h('h3', { className: 'drs-panelTitle' }, t('providersTitle')))
      ),
      h(
        'div',
        { className: 'drs-providerSummary' },
        h('span', { className: 'drs-stateDot', 'data-state': syncState, 'aria-hidden': 'true' }),
        h('p', { className: 'drs-hint' }, t('syncSummary', { synced, total })),
        pending.length === 0
          ? null
          : h('span', { className: 'drs-tag', 'data-tone': 'warning' }, t('syncPending', { count: pending.length }))
      ),
      pending.length === 0
        ? null
        : h(
            'ul',
            { className: 'drs-syncList' },
            pending.map(entry =>
              h(
                'li',
                { key: entry.provider, className: 'drs-syncItem' },
                h('span', { className: 'drs-stateDot', 'data-state': 'warning', 'aria-hidden': 'true' }),
                h('span', null, h('span', { className: 'drs-syncProvider' }, entry.provider), `${t('syncReasonSeparator')}${syncReason(entry.reason)}`)
              )
            )
          ),
      providerRows.length === 0
        ? h('p', { className: 'drs-hint' }, t('noProviders'))
        : h(
            'div',
            { className: 'drs-providerList' },
            providerRows.map(row => {
              const selected = selectedProvider === row.provider;
              const syncedState = row.editable === true ? (row.synced === true ? 'done' : 'warning') : 'error';
              return h(
                'div',
                { key: row.provider, className: 'drs-providerCard' },
                h(
                  'div',
                  { className: 'drs-providerHead' },
                  h('span', { className: 'drs-stateDot', 'data-state': syncedState, 'aria-hidden': 'true' }),
                  h(
                    'span',
                    { className: 'drs-providerName' },
                    h('span', { className: 'drs-providerDisplayName' }, row.displayName),
                    h('span', { className: 'drs-providerId' }, row.provider)
                  ),
                  h(
                    'span',
                    { className: 'drs-badges' },
                    h('span', { className: 'drs-tag', 'data-tone': row.hasOverride === true ? 'warning' : 'outline' }, row.hasOverride === true ? t('overrideTag') : t('followGlobalTag')),
                    h(
                      'button',
                      {
                        type: 'button',
                        className: 'drs-secondaryButton drs-providerAction',
                        disabled: snapshot.saving === true || snapshot.dirty === true || row.editable !== true,
                        onClick: () => actions.selectProvider(row.provider)
                      },
                      row.hasOverride === true ? t('editOverride') : t('createOverride')
                    )
                  )
                ),
                h('p', { className: 'drs-hint' }, `${t('syncSummaryShort', { provider: row.displayName })} · ${draftSummary(row.policy)}`),
                selected && provider !== null && providerDraft !== null
                  ? h(
                      'div',
                      { className: 'drs-providerEditor' },
                      policyEditor({
                        draft: providerDraft,
                        fieldErrors: providerErrors,
                        locked: providerLocked,
                        onSetField: actions.setProviderField,
                        onToggleCode: actions.toggleProviderCode,
                        onAddCode: actions.addProviderCustomCode,
                        onRemoveCode: actions.removeProviderCustomCode,
                        custom: providerCustomCode,
                        setCustom: setProviderCustomCode,
                        idPrefix: `drs-provider-${row.provider}`
                      }),
                      h(
                        'div',
                        { className: 'drs-footer' },
                        h(
                          'button',
                          {
                            type: 'button',
                            className: 'drs-save',
                            disabled: providerBlocked,
                            onClick: () => actions.saveProviderOverride()
                          },
                          snapshot.saving === true && (snapshot.savingScope ?? 'global') === 'provider' ? t('saving') : t('saveOverride')
                        ),
                        h(
                          'button',
                          {
                            type: 'button',
                            className: 'drs-secondaryButton',
                            disabled: snapshot.saving === true,
                            onClick: () => actions.discardProviderDraft()
                          },
                          snapshot.providerConfigured === true ? t('discard') : t('cancel')
                        ),
                        row.hasOverride === true
                          ? h(
                              'button',
                              {
                                type: 'button',
                                className: 'drs-reset',
                                disabled: snapshot.saving === true,
                                onClick: () => actions.restoreProviderInherited()
                              },
                              t('restoreFollowGlobal')
                            )
                          : null,
                        snapshot.providerDirty === true && snapshot.saving !== true
                          ? h('span', { className: 'drs-dirty' }, t('dirty'))
                          : null
                      )
                    )
                  : null
              );
            })
          )
    ),
    selectedProvider === null
      ? h(
          'div',
          { key: 'footer', className: 'drs-footer' },
          snapshot.failed === true ? h('p', { className: 'drs-failed', role: 'status' }, t('saveFailed')) : null,
          h(
            'button',
            { type: 'button', className: 'drs-save', disabled: blocked, onClick: () => actions.save() },
            snapshot.saving === true && (snapshot.savingScope ?? 'global') === 'global' ? t('saving') : t('save')
          ),
          h(
            'button',
            {
              type: 'button',
              className: 'drs-secondaryButton',
              disabled: snapshot.dirty !== true || snapshot.saving === true,
              onClick: () => actions.discard()
            },
            t('discard')
          ),
          snapshot.dirty === true && snapshot.saving !== true
            ? h('span', { className: 'drs-dirty' }, t('dirty'))
            : null
        )
      : null
  ];

  return h('section', { className: 'drs-section' }, [...header, h('div', { key: 'form', className: 'drs-form' }, children)]);
}
