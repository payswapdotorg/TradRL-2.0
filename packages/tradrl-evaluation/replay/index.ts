/**
 * Public surface of the W022 `tradrl-evaluation-replay` package — the
 * falsifiable verification harness over the W021 NautilusTrader adapter's
 * declared fidelity conventions and the W020/W031 replay path.
 *
 * Two entries:
 * - `verifyFidelityClaims` (sync): the 17 adapter/loader-level claims
 *   (ns conventions, dtype conventions, honesty declarations) — each a typed
 *   `{ claim, verdict, evidence }` finding backed by adversarial fixtures.
 * - `verifyNautilusReplayFidelity` (async): the whole harness — the 17 claims
 *   PLUS the 4 end-to-end replay-pipeline claims (dataset → W020 loader →
 *   the W031 CLI run/replay seam → A9 twin stability + the W016 restore
 *   equivalence) — assembled into the deterministic, content-addressed
 *   findings report.
 *
 * A FAIL verdict is a VALID outcome (the harness working, not failing): it
 * means an adapter claim did not hold under the harness's fixtures. A
 * PARTIAL verdict means the claim held within its DECLARED scope and the
 * limitation is disclosed in the adapter's own fidelity declaration.
 */

import { nautilusTraderCatalog } from "tradrl-adapters-nautilus/dtypes";
import type { NautilusCatalogDescriptor } from "tradrl-adapters-nautilus/dtypes";
import type { FidelityFinding } from "./findings.js";
import { HARNESS_INSTRUMENTS } from "./fixtures.js";
import { verifyNsConventions } from "./nsChecks.js";
import { verifyDtypeConventions } from "./dtypeChecks.js";
import { verifyTickConventions } from "./tickChecks.js";
import { verifyHonestyClaims } from "./honestyChecks.js";
import { verifyReplayPipeline, type ReplayPipelineOptions } from "./e2eReplay.js";
import { buildReplayVerificationReport, type ReplayVerificationReport } from "./report.js";

export {
  type FidelityVerdict,
  type FidelityFinding,
  type CaseVerdict,
  type VerdictSummary,
  findingOf,
  findingDigestOf,
  summarizeVerdicts,
  assertFindingsArePlainData,
} from "./findings.js";
export {
  type FidelityClaimDescriptor,
  FIDELITY_CLAIM_REGISTRY,
  registeredClaimIds,
  claimTitleOf,
  quoteDeclaration,
  undeclaredFinding,
  guardedFinding,
} from "./claims.js";
export {
  type CaseObservation,
  type CaseExpectation,
  type FidelityCase,
  type MappingObservation,
  type BatchObservation,
  type ImportObservation,
  describeObservation,
  expectMappedRecord,
  expectMappedBatch,
  expectRejectedWith,
  expectImported,
  expectImportThrows,
  runCase,
  runCases,
} from "./cases.js";
export {
  REPLAY_VERIFICATION_SCHEMA,
  type ReplayVerificationReport,
  buildReplayVerificationReport,
  dumpReplayVerificationReport,
} from "./report.js";
export {
  type E2EObservation,
  type CliRunOutcome,
  type ReplayPipelineOptions,
  runReplayPipeline,
  verifyReplayPipeline,
  cliImportParityFinding,
  twinRunsFinding,
  restoreEquivalenceFinding,
  replayExactnessFinding,
} from "./e2eReplay.js";
export { verifyNsConventions } from "./nsChecks.js";
export { verifyDtypeConventions } from "./dtypeChecks.js";
export { verifyTickConventions } from "./tickChecks.js";
export { verifyHonestyClaims } from "./honestyChecks.js";

/** The harness's default verification catalog (its own instrument table). */
export function harnessCatalog(): NautilusCatalogDescriptor {
  return nautilusTraderCatalog(HARNESS_INSTRUMENTS);
}

/**
 * Verify the 17 adapter/loader-level fidelity claims (sync, no IO): the ns
 * conventions, the dtype conventions, and the honesty declarations — each
 * against the REAL adapter/loader surfaces, with adversarial fixtures.
 */
export function verifyFidelityClaims(catalog: NautilusCatalogDescriptor = harnessCatalog()): readonly FidelityFinding[] {
  return [
    ...verifyNsConventions(catalog),
    ...verifyDtypeConventions(catalog),
    ...verifyTickConventions(catalog),
    ...verifyHonestyClaims(catalog),
  ];
}

/**
 * The complete verification: the 17 fidelity claims + the 4 end-to-end
 * replay-pipeline claims, assembled into the deterministic content-addressed
 * findings report (the evidence artifact).
 */
export async function verifyNautilusReplayFidelity(
  options: ReplayPipelineOptions = {},
): Promise<ReplayVerificationReport> {
  const catalog = harnessCatalog();
  const findings: FidelityFinding[] = [...verifyFidelityClaims(catalog)];
  findings.push(...(await verifyReplayPipeline(options)));
  return buildReplayVerificationReport({ catalogId: catalog.catalogId, findings });
}
