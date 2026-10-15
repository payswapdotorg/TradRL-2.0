/**
 * The W064 REFERENCE END-TO-END TRADING JOURNEY — the entry point.
 *
 * ONE §14 scope, the WHOLE trading-improvement pipeline, every record
 * composed through its own package's own gate (never hand-forged): the
 * founding (W041→W045), the learning family (W037→W055), the improvement
 * loop + commerce (W055→W058), and the governance family (W059→W061).
 * Run from the repository root:
 *
 *   npx tsx examples/reference-trading/journey.ts
 *
 * The journey prints every composed stage (stage → gate → record id → the
 * count the RECORD itself carries — A6: no invented numbers) and the
 * journey's own content-addressed id (A9: the same journey ⇒ the same id).
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import { pathToFileURL } from "node:url";
import { SCOPE } from "./journeyFacts.js";
import { journeyIdOf, renderStageLine, type StageLine } from "./journeyHelpers.js";
import { stagesFounding, type FoundingRecords } from "./journeyStagesA.js";
import { stagesLearning, type LearningRecords, type DeclarationOrder } from "./journeyStagesB.js";
import { stagesCommerce, type CommerceRecords } from "./journeyStagesC.js";
import { stagesGovernance, type GovernanceRecords } from "./journeyStagesD.js";

/** The whole journey's composed records (one record family per stage set). */
export interface JourneyRecords {
  readonly founding: FoundingRecords;
  readonly learning: LearningRecords;
  readonly commerce: CommerceRecords;
  readonly governance: GovernanceRecords;
}

/** The composed journey: the ordered stage lines + every record + the
 * journey's content-addressed identity (A9). */
export interface ComposedJourney {
  readonly scope: typeof SCOPE;
  readonly lines: readonly StageLine[];
  readonly records: JourneyRecords;
  readonly journeyId: string;
}

/**
 * Compose the reference journey. Pure and deterministic (A9): no clocks,
 * no randomness, no env reads, no filesystem, no network (A14 + the W064
 * laws). The declaration-order option exercises the gates that
 * canonicalize their inputs (W054 ingest, W055 cycle) — the composed ids
 * are IDENTICAL either way (the A9 twin).
 */
export function composeJourney(order: DeclarationOrder = "canonical"): ComposedJourney {
  const founding = stagesFounding();
  const learning = stagesLearning(founding.records, order);
  const commerce = stagesCommerce(founding.records, learning.records, order);
  const governance = stagesGovernance(learning.records);
  const lines: readonly StageLine[] = [
    ...founding.lines,
    ...learning.lines,
    ...commerce.lines,
    ...governance.lines,
  ];
  return {
    scope: SCOPE,
    lines,
    records: {
      founding: founding.records,
      learning: learning.records,
      commerce: commerce.records,
      governance: governance.records,
    },
    journeyId: journeyIdOf(lines),
  };
}

function main(): void {
  const journey = composeJourney();
  const out = process.stdout;
  out.write("The W064 reference end-to-end trading journey\n");
  out.write(
    `§14 scope: tenant '${String(journey.scope.tenantId)}' · project '${String(journey.scope.projectId)}' · world '${String(journey.scope.worldId)}'\n`,
  );
  out.write(`stages: ${String(journey.lines.length)} — every record through its own gate\n\n`);
  for (const line of journey.lines) {
    out.write(`${renderStageLine(line)}\n`);
  }
  out.write(`\njourney id: ${journey.journeyId}\n`);
}

// The entry-point law: the journey prints ONLY when run as the main module
// (`npx tsx examples/reference-trading/journey.ts`); importing it composes
// nothing (the tests import composeJourney directly — no side effects).
const isMainModule = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMainModule) {
  main();
}
