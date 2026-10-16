/**
 * Type-only re-export of the canonical W018 World-adapter transport types —
 * the seam `engineWorldClient.ts` compiles against (work order W018).
 *
 * WHY A .d.ts SHIM (the W006 `worldContracts.d.ts` pattern): a declaration
 * file is never emitted, and it re-exports the REAL adapter types with zero
 * duplication — drift is impossible because this file literally points at
 * the canonical sources (packages/tradrl-world-sim/adapter/) through the
 * package specifier: the manifest dependency `tradrl-world-sim` is wired in
 * packages/ui/package.json, so the reference resolves through the package
 * `exports` map with a packageId — an external module, never an emit input
 * of the `tsc -b packages/ui` composite project. This is the W030
 * "real-specifier flip" (8cc3d82) applied to the shim: the earlier
 * RELATIVE-path form (`../../../../tradrl-world-sim/adapter/*.js`) resolved
 * WITHOUT a packageId, pulling the adapter/contracts sources — and their
 * whole relative-import closure — into the ui program as project files,
 * which is exactly the TS6059/TS6307 storm that broke the root typecheck
 * gate. The package-specifier form is the one the tsc -b graph accepts.
 *
 * The runtime PARITY test (packages/ui/test/tradingWorldTransportParity.test.ts)
 * imports the real adapter VALUES directly (outside the ui tsc project, the
 * W005-established pattern) and runs the REAL provider over both adapter
 * topologies — the wire compatibility is proven, not assumed.
 */

export type { WorldTransport } from "tradrl-world-sim/adapter";
export type {
  WorldAdapterWireOptions,
  WorldCallOutcome,
  WorldChannel,
  WorldClientMessage,
  WorldHeadlessReport,
  WorldHostInfo,
  WorldHostMessage,
  WorldPortCall,
  WorldPortName,
  WorldPublishedProjection,
  WorldRealtimeOptions,
  WorldRemoteError,
  WorldRequestId,
} from "tradrl-world-sim/adapter";
export type { CommandAck } from "tradrl-world-contracts/commands";
export type { WorldEventEnvelope } from "tradrl-world-contracts/events";
