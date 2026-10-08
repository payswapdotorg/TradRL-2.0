/**
 * Agent-world protocol runtime — W035 (the agent-body /
 * cognitive-substrate / possession naming/structure pattern: a flat,
 * source-exported package).
 *
 * What this package owns (spec/WORK-ITEMS.md W035 — "Observation/action
 * protocol"): the typed bridge between a POSSESSED AGENT (W032 Body +
 * W033 Substrate + W034 Possession) and a WORLD (the W023 reactive
 * participant seam):
 * - the observation grant protocol (`observation.ts`): how a possessed
 *   agent's substrate receives ObservedBodyViews — the W032 view-grant
 *   machinery over the W034 effective-agent view, driven by the W023
 *   settled-view discipline (coherence-guarded reads; future-dated
 *   artifacts withheld AND named);
 * - the action protocol (`action.ts`): how a substrate's Decision stream
 *   becomes WorldCommands through the Body's embodiment — W033's
 *   `validateDecisionStream` (via W034's decision-level check) as the
 *   admission gate (commands outside the embodiment NEVER issue), then
 *   the CommandPort issuance with typed outcomes, FIFO;
 * - the agent-world session (`session.ts`): the composed lifecycle —
 *   attach (W032 validateBodyAttachment + W034 possession check) →
 *   observe → decide (W033) → act → detach; fail-closed at every seam,
 *   every state transition typed, telemetry as data (the pass-record
 *   precedent).
 *
 * The canonical agent contracts (Body, Substrate, Possession, the
 * participant protocol) live in their own packages/files; this package
 * composes them and adds the session protocol only.
 */

export * from "./contracts.js";
export * from "./observation.js";
export * from "./action.js";
export * from "./session.js";
