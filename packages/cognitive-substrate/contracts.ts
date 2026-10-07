/**
 * The canonical Cognitive Substrate contract surface (W033's
 * `contracts/agent` seam — the W032 `agent-body/contracts.ts` pattern).
 *
 * The types, closed sets and error-code unions live in the shared
 * contracts package at
 * `packages/tradrl-world-contracts/src/cognitiveSubstrate.ts` (the
 * `data.ts`/`agentBody.ts` precedent: a domain contracts file owned next
 * to the world contracts). The subpath export
 * `tradrl-world-contracts/cognitiveSubstrate` is a REGISTERED TL ACTION
 * ITEM — the contracts package.json exports map is a shared-root file
 * (ARCHITECTURE-LOCK.md A16) this Work Order must not edit. Until that
 * entry lands, this module bridges to the canonical source directly; when
 * it lands, the import below flips to the package specifier (one line) and
 * every `cognitive-substrate/contracts` consumer keeps working unchanged.
 */

export * from "../tradrl-world-contracts/src/cognitiveSubstrate.js";
