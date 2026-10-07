/**
 * tradrl-market-participants (W023) — the reactive participant runtime.
 *
 * The deterministic event loop (settled view → pure decide → commands
 * through the same CommandPort humans use, FIFO with the engine's own
 * sequencing) plus the reference agents (momentum + mean-reversion).
 *
 * PROTOCOL TYPES live in tradrl-world-contracts/src/participantProtocol.ts
 * (the W023 contracts addition); this package re-exports them for consumers
 * until the TL registers the contracts exports-map entry.
 *
 * IMPORT LAW: this package imports ONLY contracts types (type-only) and its
 * own modules — never engine internals, never the sim, never the UI. The
 * provider surface it consumes (ReactiveParticipantWorldClient) is
 * structurally satisfied by the engine-backed world client the tool surfaces
 * use (proven by the tests, which run the REAL generated alpha world).
 */

export {
  createParticipantRuntime,
  type ParticipantRuntime,
  type ParticipantRuntimeOptions,
} from "./runtime.js";
export { readSettledView, viewInstruments } from "./views.js";
export {
  createMomentumAgent,
  createMeanReversionAgent,
  signedPositionScaled,
  type MomentumAgentConfig,
  type MeanReversionAgentConfig,
} from "./agents/index.js";
export {
  compareRatio,
  formatParticipantDecimal,
  lotsOf,
  mulScaled,
  parseParticipantDecimal,
  PARTICIPANT_DECIMAL_SCALE,
  ratioText,
  tickOffset,
  type Scaled,
} from "./decimal.js";
export { drawChance, drawInt, keyedRandom } from "./rng.js";
export type {
  ParticipantCommandOutcome,
  ParticipantDecision,
  ParticipantOrderIntent,
  ParticipantPassRecord,
  ParticipantRuntimeStatus,
  ParticipantRuntimeTelemetry,
  ParticipantSettledView,
  ParticipantViewConfig,
  ReactiveParticipantAgent,
  ReactiveParticipantWorldClient,
} from "../../tradrl-world-contracts/src/participantProtocol.js";
