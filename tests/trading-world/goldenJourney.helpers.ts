/**
 * The W019 golden journey — the orchestrator (suite helper, not a test
 * file). ONE fixed, fully deterministic command + clock stream through the
 * REAL composed product: the W018 provider (`attachEngineWorldClient`) over
 * the TL-wired alpha attachment (`createAlphaEngineTransport` — the W017
 * generated market behind the W018 in-process adapter), i.e. exactly what
 * `TradingWorldShell` attaches for a Trading World pane.
 *
 * The journey is the multi-regime alpha DAY (definition
 * `alphaWorldDefinition`): mean-reversion cold start -> trend ->
 * high-volatility -> low-liquidity -> mean-reversion close, with a scripted
 * trader session on top (fills, partial fill + cancel, resting orders,
 * replace, typed rejections, clock ops, the A8 backward-seek refusal, a
 * content-addressed snapshot, a branch with lineage facts, a post-branch
 * parent mutation).
 *
 * DETERMINISM CONTRACT: the issued commands and clock operations are FROZEN
 * — reads may be added freely (they never journal), but any change to a
 * command, its issuedAt, or the clock path changes every generated event and
 * therefore every pinned digest. The golden pins live in
 * `goldenJourney.test.ts`; the facts contract in `goldenJourneyFacts.ts`;
 * the stage bodies in `goldenJourneyStages{A,B,C}.ts` (split for the
 * 400-line lint law — the code is verbatim).
 */

import {
  attachEngineWorldClient,
  type EngineWorldClient,
} from "../../packages/ui/src/trading-world/runtime/engineWorldClient.js";
import { createAlphaEngineTransport } from "../../packages/ui/src/trading-world/runtime/engineAttachment.js";
import { GOLDEN_WORLD_ID } from "./goldenJourneyFacts.js";
import type { GoldenJourneyFacts, GoldenJourneyInput } from "./goldenJourneyFacts.js";
import { makeJourneyContext } from "./goldenJourneyContext.js";
import { stagesS0ThroughS7 } from "./goldenJourneyStagesA.js";
import { stagesS10ThroughS14 } from "./goldenJourneyStagesB.js";
import { stagesS15ThroughS18AndEnd } from "./goldenJourneyStagesC.js";

// The public surface re-exported for every existing consumer (pins, tests):
export {
  GOLDEN_WORLD_ID,
  SIM_START,
  MIN,
  GOLDEN_INSTRUMENT_ID,
  GOLDEN_ACCOUNT_ID,
  GOLDEN_PARTICIPANT_ID,
  fixedWallSource,
  alphaWorldDefinition,
} from "./goldenJourneyFacts.js";
export type { GoldenJourneyFacts, GoldenJourneyInput } from "./goldenJourneyFacts.js";

/** Run the golden journey against a FRESH composed alpha attachment. */
export async function runGoldenJourney(
  input: GoldenJourneyInput = {},
): Promise<GoldenJourneyFacts> {
  const client = await attachEngineWorldClient({
    transport: createAlphaEngineTransport(GOLDEN_WORLD_ID, {
      wallTimeSource:
        input.wallTimeSource === undefined
          ? undefined
          : (input.wallTimeSource as () => never),
    }),
    expectedWorldId: GOLDEN_WORLD_ID,
  });
  try {
    return await runJourneyOn(client);
  } finally {
    client.dispose();
  }
}

/** The journey proper, against an already-attached client. */
async function runJourneyOn(client: EngineWorldClient): Promise<GoldenJourneyFacts> {
  const ctx = makeJourneyContext(client);
  const a = await stagesS0ThroughS7(ctx);
  const b = await stagesS10ThroughS14(ctx);
  const c = await stagesS15ThroughS18AndEnd(ctx);
  return {
    worldId: ctx.world as string,
    s0: a.s0,
    s1: a.s1,
    s2: a.s2,
    s3: a.s3,
    s5: a.s5,
    s6: a.s6,
    s7: a.s7,
    s10: b.s10,
    s11: b.s11,
    s12: b.s12,
    s13: b.s13,
    s14: b.s14,
    s15: c.s15,
    s16: c.s16,
    s17: c.s17,
    s18: c.s18,
    endState: c.endState,
  };
}
