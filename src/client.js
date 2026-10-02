/**
 * Retry settings section plugin (client half).
 *
 * Registers one page under Settings → Request retries and keeps it fresh from
 * the native forwarded events. The page reads and writes only through the
 * Remote settings/llm faces; mounting performs a read and never a write.
 *
 * @module client
 */

import React from 'react';
import { createRetrySettingsController } from './ui-controller.js';
import { RetrySettingsView } from './ui-view.js';
import { dictionaries } from './ui-locales.js';
import { uiCss } from './ui-style.js';

/** Services this plugin requires from the client composition. */
export const inject = ['slots', 'locale', 'remote', 'remote.settings', 'remote.llm'];

const NS = 'dsh-retry-settings';

/**
 * Section entry: project the controller snapshot into the view.
 * @param props - injected `useSnapshot` hook, `controller`, and translator.
 * @returns the rendered section, with the token-driven DSH stylesheet.
 */
function RetrySettingsSection({ useSnapshot, controller, t }) {
  const snapshot = useSnapshot(value => value);
  return React.createElement(
    React.Fragment,
    null,
    React.createElement('style', null, uiCss),
    React.createElement(RetrySettingsView, { snapshot, actions: controller.actions, t })
  );
}

/**
 * Mount the retry settings section.
 * @param ctx - client context with the injected services.
 * @returns nothing; every registration is owned by a context effect.
 */
export function apply(ctx) {
  ctx.effect(() => ctx.locale.register(NS, dictionaries), 'dsh-retry-settings: copy dictionaries');
  const t = ctx.locale.bind(NS);
  const controller = createRetrySettingsController({ remote: ctx.remote });

  ctx.effect(() => {
    const refresh = () => {
      void controller.refresh();
    };
    const disposers = [
      ctx.remote.$on('settings/document-updated', refresh),
      ctx.remote.$on('llm/adapters-updated', refresh),
      ctx.on('connection/reset', refresh)
    ];
    return () => {
      for (const dispose of disposers) dispose();
      controller.dispose();
    };
  }, 'dsh-retry-settings: forwarded setting and provider changes');

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: NS,
    order: 12,
    label: () => t('nav'),
    inject: () => ({ controller, hooks: { snapshot: controller.store }, t })
  }, RetrySettingsSection));

  void controller.load().catch(error => {
    console.error('[dsh-retry-settings] initial read failed', error);
  });
}
