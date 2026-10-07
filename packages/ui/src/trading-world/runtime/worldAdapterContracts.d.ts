/**
 * Type-only re-export of the canonical W018 World-adapter transport types —
 * the seam `engineWorldClient.ts` compiles against (work order W018).
 *
 * WHY A .d.ts SHIM (the W006 `worldContracts.d.ts` pattern): packages/ui does
 * not depend on tradrl-world-sim — adding that dependency requires the
 * TL-owned manifests (packages/ui/package.json + workspace wiring). A
 * declaration-file shim is never emitted, and with the repo's
 * `skipLibCheck: true` it re-exports the REAL adapter types with zero
 * duplication — drift is impossible because this file literally points at
 * the canonical sources (packages/tradrl-world-sim/adapter/).
 *
 * The TL replaces these with real package specifiers when wiring the worker
 * transport (see the W018 PR wiring note). The runtime PARITY test
 * (packages/ui/test/tradingWorldTransportParity.test.ts) imports the real
 * adapter VALUES directly (outside the ui tsc project, the W005-established
 * pattern) and runs the REAL provider over both adapter topologies — the
 * wire compatibility is proven, not assumed.
 */

export type { WorldTransport } from "../../../../tradrl-world-sim/adapter/transport.js";
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
} from "../../../../tradrl-world-sim/adapter/envelope.js";
export type { CommandAck } from "../../../../tradrl-world-contracts/src/commands.js";
export type { WorldEventEnvelope } from "../../../../tradrl-world-contracts/src/events.js";
