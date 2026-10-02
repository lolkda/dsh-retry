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
 * @module vendor/native-section-css
 */

/**
 * Upstream class -> vendored class: .rtSEdW_section -> .drs-section, .rtSEdW_title -> .drs-title, .rtSEdW_intro -> .drs-intro.
 * Only the selector names differ; every declaration is byte-identical.
 */
export const sectionCss = [
  '.drs-section{max-width:720px;color:var(--dsw-alias-label-primary);flex-direction:column;gap:12px;display:flex}',
  '.drs-title{margin:0;font-size:18px;font-weight:600}',
  '.drs-intro{color:var(--dsw-alias-label-tertiary);margin:0;font-size:13px}'
].join(String.fromCharCode(10));
