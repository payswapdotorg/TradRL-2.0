/**
 * Public surface of the W013 engine `clock` module.
 *
 * Spec: spec/SIMULATION.md "Runtime topology" (`World Engine ├─ clock`).
 * The clock is consumed by the world engine (world/engine.ts) and exposed to
 * UI/adapter consumers through W018. W012's clock/timeline UI consumes the
 * same `ClockState` shapes.
 */

export {
  DEFAULT_CLOCK_STATUS,
  DEFAULT_CLOCK_STEP_MS,
  ClockRejectionError,
  InvalidClockSetupError,
  asClockPort,
  createSimulationClock,
  type ClockEventLookup,
  type SimulationClock,
  type SimulationClockOptions,
} from "./simulationClock.js";
