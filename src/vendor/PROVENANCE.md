# Vendored native CSS

Two runs of the shipped settings UI are copied here verbatim. Since the 2026-10-03
restyle, the live page uses `src/ui-style.js` (a DSH-token redesign); these snapshots
are kept for provenance verification only and are no longer injected into the page.
A plugin still must not import a Harness Client package as a module, and stable
`drs-` class names avoid hashed-class dependence in both the old and new styles.

Both come from `@deepseek-ai/dsh-client-ui-primitives`, version `0.2.0-rc.2`, licence
**MIT**, installed at
`/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-ui-primitives`.

## Files copied

| Upstream file (`lib/…`) | Vendored export | File |
|---|---|---|
| `settings-form/SettingsForm.module.css` | `settingsFormCss` | `native-form-css.js` |
| `settings-form/fields.module.css` | `fieldsCss` | `native-form-css.js` |
| `Tag.module.css` | `tagCss` | `native-form-css.js` |
| `Checkbox.module.css` | `checkboxCss` | `native-form-css.js` |

The only change applied is the `drs-` namespace on every class selector, so the copy
cannot collide with the shipped stylesheet:

```js
css.replace(/\.([A-Za-z_][\w-]*)/g, '.drs-$1')
```

Backticks that appear inside upstream CSS comments are escaped in the JavaScript
source only, so the evaluated string stays byte-identical. Nothing else differs:
token references (`--dsw-alias-*`), dimensions, typography, rule order and comments
are identical to the upstream files, and no rule was rewritten or pruned.

## Section page header

The other source is `@deepseek-ai/dsh-client-ui-agent-preset`, version `0.2.0-rc.2`,
licence **MIT** — the official Agent presets **settings section page**, which draws its
own title because the settings shell draws none for a section page. Its header rules
are copied from the installed bundle `lib/client.js` (the CSS ships inlined there):

| Upstream class | Vendored class | Declaration text |
|---|---|---|
| `.rtSEdW_section` | `.drs-section` | unchanged |
| `.rtSEdW_title` | `.drs-title` | unchanged |
| `.rtSEdW_intro` | `.drs-intro` | unchanged |

These three rules live in `native-section-css.js` as `sectionCss`. Only the selector
name changes — upstream class names are build-generated hashes, so each is renamed to
a stable, plugin-prefixed name; every declaration stays byte-identical. The markup
that goes with them is the upstream element structure: a `<section>` carrying the
title `<h2>` (its text is this plugin's own translated nav label, exactly as the
upstream section uses `t('nav')`) and the intro `<p>`.

## Licence

Both upstream packages ship the same MIT licence text
(`md5 5688c42173bdbd62fc289644007ad44a`), vendored here once as `LICENSE`.
Copyright (c) 2026 DeepSeek.

## Verification

`test/ui-vendor.test.js` re-derives every vendored rule from the installed packages on
each run and asserts byte equality after the documented rename, so drift in either
direction fails the suite.
