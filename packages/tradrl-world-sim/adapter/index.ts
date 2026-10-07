/**
 * Public surface of the W018 World adapter module.
 *
 * Spec: spec/SIMULATION.md "Runtime topology" + "Execution targets":
 * ```
 * TradingWorld UI → World Client → Worker/Process Adapter → World Engine
 *                                     ^ this module
 * ```
 * Spec: spec/ACCEPTANCE-WORLD-ALPHA.md I (headless parity — the same
 * provider runs against both adapters).
 *
 * Topologies, one typed surface ({@link WorldTransport}):
 * - Node in-process: `createInProcessWorldTransport` (headless runner, tests,
 *   the headless half of the parity law),
 * - Web Worker: bundle `./worker.js` as the worker entry, then
 *   `createWorkerWorldTransport(asDomWorkerChannel(worker), {...})`;
 *   `asNodeWorkerChannel` runs the SAME host under `worker_threads` in tests.
 *
 * The UI-side mirror of the envelope/transport types lives at
 * `packages/ui/src/trading-world/runtime/worldAdapterContracts.d.ts`
 * (type-only shim re-exporting THIS canonical source — the W006 pattern).
 */

export {
  ADAPTER_ENVELOPE_VERSION,
  DEFAULT_REALTIME_TICK_MS,
  isWorldClientMessage,
  isWorldHostMessage,
  serializeTransportError,
  toWorldPublishedProjection,
  worldAdapterError,
} from "./envelope.js";
export type {
  WorldAdapterErrorCode,
  WorldAdapterWireOptions,
  WorldCallOutcome,
  WorldChannel,
  WorldClientMessage,
  WorldHeadlessReport,
  WorldHostInfo,
  WorldHostMessage,
  WorldHostMethodName,
  WorldPortCall,
  WorldPortName,
  WorldPublishedProjection,
  WorldRealtimeOptions,
  WorldRemoteError,
  WorldRequestId,
} from "./envelope.js";
export {
  createEngineAdapterRuntime,
  createWorldAdapterSession,
} from "./host.js";
export type {
  EngineAdapterRuntime,
  EngineAdapterRuntimeInput,
  WorldAdapterCore,
  WorldAdapterSession,
  WorldAdapterSessionOptions,
  WorldChannelState,
  WorldRealtimeDriverConfig,
} from "./host.js";
export {
  createRealtimeClockDriver,
  globalTaskScheduler,
  resolveAdapterWallTimeSource,
} from "./realtimeDriver.js";
export type {
  RealtimeClockDriverOptions,
  RealtimeClockStateView,
  WorldRealtimeClockDriver,
  WorldTaskScheduler,
} from "./realtimeDriver.js";
export { createInProcessWorldTransport } from "./inProcess.js";
export type { InProcessWorldTransportOptions } from "./inProcess.js";
export {
  createWorldTransportClosedError,
  WorldAdapterInitError,
  WorldTransportClosedError,
} from "./transportError.js";
export type { WorldTransport } from "./transport.js";
export { installWorldWorkerHost, detectWorkerScope } from "./workerHost.js";
export type { WorldWorkerHostOptions, WorldWorkerScope } from "./workerHost.js";
export {
  asDomWorkerChannel,
  asNodeWorkerChannel,
  createWorkerWorldTransport,
} from "./workerTransport.js";
export type {
  WorkerWorldTransportOptions,
  WorldWorkerChannel,
} from "./workerTransport.js";
