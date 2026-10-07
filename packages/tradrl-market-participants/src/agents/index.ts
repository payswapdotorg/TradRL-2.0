/**
 * The reference reactive participants (W023).
 *
 * Both agents are PURE decision functions over settled views with every
 * threshold DECLARED in configuration (never invented), and both act only
 * through the runtime's CommandPort — the same typed port a human trader
 * uses. Tested against the REAL generated alpha world through the W018
 * provider (test/agents.alphaWorld.test.ts).
 */

export {
  createMomentumAgent,
  signedPositionScaled,
  type MomentumAgentConfig,
} from "./momentum.js";
export {
  createMeanReversionAgent,
  type MeanReversionAgentConfig,
} from "./meanReversion.js";
