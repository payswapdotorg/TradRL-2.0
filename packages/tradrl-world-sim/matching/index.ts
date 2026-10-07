/**
 * Public surface of the W014 `matching` module.
 *
 * Spec: spec/SIMULATION.md "Runtime topology" (`World Engine └─ matching`).
 * The seam (`seam.ts`) is the single integration point the W013 world core
 * calls; everything else here is the matching engine's own typed surface.
 */

export {
  FEE_DECIMALS,
  fillFee,
  totalFeeAmount,
} from "./fees.js";
export {
  DEFAULT_VENUE_POLICY,
  acknowledgementAvailableAt,
  fillAvailableAt,
  resolveVenuePolicy,
  type VenuePolicy,
} from "./policy.js";
export {
  MATCHING_EVENT_SCHEMA_VERSION,
  MATCHING_PRODUCER,
  MATCHING_ORDER_EVENT_TYPES,
  MATCHING_STATE_EVENT_TYPES,
  isMatchingStateEventType,
  isOrderAcceptedPayload,
  isOrderCanceledPayload,
  isOrderFilledPayload,
  isOrderRejectedPayload,
  isOrderReplacedPayload,
  isOrderTriggeredPayload,
  type MatchingEventPayload,
  type MatchingOrderEventPayload,
  type MatchingOrderEventType,
  type OrderAcceptedPayload,
  type OrderCanceledPayload,
  type OrderFilledPayload,
  type OrderRejectedPayload,
  type OrderReplacedPayload,
  type OrderTriggeredPayload,
} from "./events.js";
export {
  initialMatchingState,
  nextFillId,
  nextOrderId,
  nextTradeId,
  type ArmedStop,
  type MatchingState,
  type TradeRecord,
} from "./state.js";
export { reduceMatchingEvent } from "./reducer.js";
export {
  MatchContext,
  executeTakerPlan,
  planAggressive,
  wouldCross,
  type PlannedMatch,
  type ReduceOnlyPositionCheck,
  type SubmissionInput,
} from "./matcher.js";
export {
  evaluateStopCascade,
  executeSubmission,
  precheckSubmission,
  successorInputOf,
  type PrecheckRejection,
} from "./submission.js";
export {
  applyMatchingCommand,
  type MatchingCommandContext,
  type MatchingCommandOutcome,
} from "./seam.js";
