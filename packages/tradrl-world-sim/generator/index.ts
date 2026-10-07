/**
 * Public surface of the W017 `generator` module.
 *
 * Spec: spec/SIMULATION.md "Runtime topology" (`World Engine ├─ synthetic
 * market`) and "Synthetic regimes"; spec/ACCEPTANCE-WORLD-ALPHA.md B (quote
 * changes, book changes, Time & Sales changes from a deterministic
 * multi-regime generator) and J (10k synthetic events/second — the
 * generator is O(events) per turn with no hidden cursors).
 *
 * Consumers: W019 (the World Alpha golden integration suite and the alpha
 * world attachment), headless runners, and any host that wants a world
 * whose clock advance fills the books with honest simulated liquidity.
 */

export {
  GENERATOR_EVENT_SCHEMA_VERSION,
  GENERATOR_EVENT_TYPES,
  GENERATOR_STATE_EVENT_TYPES,
  MARKET_GENERATOR_PRODUCER,
  asInstrumentId,
  generatedCommandId,
  generatorTurnId,
  isGeneratorStateEventType,
  isMarketHaltPayload,
  isMarketReopenPayload,
  isQuoteUpdatePayload,
  isRegimeChangePayload,
  type GeneratorEventPayload,
  type GeneratorEventType,
} from "./events.js";
export {
  initialMarketGeneratorState,
  reduceMarketGeneratorEvent,
  type ActiveRegime,
  type MarketGeneratorState,
} from "./state.js";
export {
  derivedRandom,
  drawChance,
  drawInt,
  mulberry32,
} from "./rng.js";
export {
  DEFAULT_GENERATOR_TICK_MS,
  DEFAULT_HALT_AFTER_MS,
  DEFAULT_REOPEN_AFTER_MS,
  activeEntryAt,
  gridTimesForInterval,
  haltReopenEventsForInterval,
  haltTimeOf,
  isFirstGridTimeInWindow,
  isShockGapTurn,
  scheduleTickMs,
  shockGapTimeOf,
  referenceModeOf,
  regimeAnnouncementsForInterval,
  regimeProfileOf,
  reopenTimeOf,
  scheduleBoundaries,
  scheduleEntriesOf,
  shockHaltEventsForInterval,
  type RegimeAnnouncement,
  type RegimeProfile,
  type ScheduledHaltEvent,
} from "./regime.js";
export {
  formatPrice,
  quotePayloadOf,
  referencePriceOf,
  sameQuote,
  snapNumberToTick,
  snapToTick,
  topOfBook,
  type ReferenceMode,
  type TopOfBook,
} from "./quotes.js";
export {
  createCommandIdSource,
  planGeneratorTurn,
  type CommandIdSource,
  type GeneratedCommand,
} from "./participants.js";
export {
  createGeneratedWorldEngine,
  type GeneratedWorldEngine,
  type GeneratedWorldEngineOptions,
} from "./engine.js";
