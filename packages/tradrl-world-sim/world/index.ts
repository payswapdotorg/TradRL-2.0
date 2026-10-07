/**
 * Public surface of the W013 engine `world` module.
 *
 * Spec: spec/SIMULATION.md "Runtime topology" (World Engine core), spec/
 * WORLD-PROTOCOL.md "Command lifecycle" + "Ports". Consumers: W012 (clock/
 * timeline UI via ClockState), W014–W017 (engine surfaces built on this
 * core), W018 (worker adapter hosting the ports), W031 (headless CLI
 * runner), W019 (golden integration suite).
 */

export {
  InvalidWorldDefinitionError,
  NotImplementedInSkeletonError,
  UnknownWorldEntityError,
  EngineInvariantError,
  WORK_ORDER_OF_SURFACE,
  type NotImplementedSurface,
} from "./errors.js";
export {
  ENGINE_EVENT_TYPES,
  ENGINE_EVENT_SCHEMA_VERSION,
  WORLD_CORE_PRODUCER,
  isAnnotationAddedPayload,
  isEngineEvent,
  isScenarioSetPayload,
  type AnnotationAddedPayload,
  type EngineEvent,
  type EngineEventPayload,
  type EngineEventType,
  type ScenarioSetPayload,
} from "./events.js";
export {
  CONTRACTS_DEPENDENCY_VERSION,
  ENGINE_ID,
  ENGINE_VERSION,
  SKELETON_KNOWN_LIMITATIONS,
  assertValidWorldDefinition,
  projectWorldMeta,
  validateWorldDefinition,
  type ClockGenesis,
  type WorldDefinition,
} from "./definition.js";
export {
  initialWorldState,
  nextAnnotationId,
  reduceWorldEvent,
  type WorldAnnotation,
  type WorldState,
} from "./state.js";
export {
  applyCommand,
  authorizeCommand,
  runCommandLifecycle,
  validateCommand,
  type LifecycleContext,
  type LifecycleOutcome,
} from "./lifecycle.js";
export {
  buildDeterminismManifest,
  buildHeadlessReport,
  type HeadlessFinancialSummary,
  type HeadlessPnlSummary,
  type HeadlessRunReport,
  type ManifestInputs,
} from "./manifest.js";
export { canonicalString, createFnv1aHasher, fnv1aChainHex, stableDigest, type Fnv1aHasher } from "./hashing.js";
export {
  createEvidencePort,
  createQueryPort,
  journalEventLookup,
  type EngineReadModel,
} from "./projections.js";
export {
  createHeadlessWorldEngine,
  type EngineRestore,
  type HeadlessWorldEngine,
  type HeadlessWorldEngineOptions,
} from "./engine.js";
