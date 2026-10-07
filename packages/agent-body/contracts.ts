/**
 * The canonical Body contract surface (W032's `contracts/agent` seam).
 *
 * The types, closed sets and lifecycle tables live in the shared contracts
 * package at `packages/tradrl-world-contracts/src/agentBody.ts` (the
 * `data.ts` precedent: a domain contracts file owned next to the world
 * contracts). The subpath export `tradrl-world-contracts/agentBody` is a
 * REGISTERED TL ACTION ITEM — the contracts package.json exports map is a
 * shared-root file (ARCHITECTURE-LOCK.md A16) this Work Order must not
 * edit. Until that entry lands, this module bridges to the canonical
 * source directly; when it lands, the import below flips to the package
 * specifier (one line) and every `agent-body/contracts` consumer keeps
 * working unchanged.
 */

export * from "../tradrl-world-contracts/src/agentBody.js";
