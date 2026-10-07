/**
 * Agent Body contracts runtime — W032 (the `tradrl-information`
 * naming/structure pattern: a flat, source-exported package).
 *
 * What this package owns (spec/WORK-ITEMS.md W032):
 * - the validators for the Body contracts (`validate.ts`): descriptor
 *   structure, view ⊆ embodiment, and the attach-time world binding —
 *   every violation collected loudly (typed codes, exact values), never a
 *   silent clip;
 * - the envelope laws (`envelope.ts`): the A13-shape structural law
 *   (reusing the W015 risk-limits validation + the canonical-decimal
 *   contract-boundary law), the exact envelope-vs-world-limits comparison
 *   (a Body declaring a LOOSER limit than its world is invalid at attach),
 *   and the effective-envelope intersection (the tighter of each declared
 *   pair — the envelope the runtime enforces for this Body);
 * - the attachment lifecycle as pure data transforms (`lifecycle.ts`):
 *   attach → active → detached, fail-closed (refusals are typed results
 *   that never mutate state);
 * - the A7 observation firewall (`view.ts`): the available-then grant —
 *   artifacts with `availableAt` after `asOf` are withheld AND named.
 *
 * NO runtime intelligence: no scheduling, no decisions, no model calls —
 * that is W033's Cognitive Substrate (R050). This package is types +
 * validation + honest states only.
 */

export * from "./contracts.js";
export * from "./envelope.js";
export * from "./lifecycle.js";
export * from "./validate.js";
export * from "./view.js";
