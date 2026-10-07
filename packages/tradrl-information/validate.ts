/**
 * The information-import validator (W027 `tradrl-information`).
 *
 * One pure pass over (descriptor, records, source declarations, symbol map)
 * collecting EVERY violation (the W004 `validateEventStream` pattern —
 * importers see all problems, never just the first, and no record is ever
 * silently dropped):
 * - descriptor fidelity-declaration laws (`./descriptor.js`);
 * - source-declaration laws (credibility is DECLARED, never fabricated);
 * - per-record structural laws + dataset-level laws (`./recordLaws.js`:
 *   declared source, resolvable symbols, canonical target prices, finite
 *   times, A7 `availableAt` boundary, publication order, declared range
 *   coverage, known-gap honesty, unique record ids).
 *
 * The loader (`./loader.js`) runs this first and rejects invalid imports
 * with the complete typed violation list.
 */

import type { WorldId } from "tradrl-world-contracts";
import type {
  InformationDatasetDescriptor,
  InformationRecord,
  InformationSourceDeclaration,
} from "tradrl-world-contracts/information-data";
import type { InformationViolation } from "./errors.js";
import { validateInformationDatasetDescriptor } from "./descriptor.js";
import type { RecordSymbolMap } from "./adapters.js";
import { isNonBlank, isRecordLike, orderingViolations, rangeGapViolations, recordViolations, sourceDeclarationViolations } from "./recordLaws.js";

/** The complete input of one information dataset import. */
export interface InformationImportInput {
  /** The world the artifacts are imported for (identity — never invented). */
  readonly worldId: WorldId;
  readonly descriptor: InformationDatasetDescriptor;
  readonly records: readonly InformationRecord[];
  /**
   * The importer's source declarations — the honesty surface: every record
   * source must be declared here with its credibility class, and the
   * adapter never assigns credibility itself (no fabricated authority).
   */
  readonly sources: readonly InformationSourceDeclaration[];
  /** Feed symbol → instrument mapping; unmapped symbols are rejected loudly. */
  readonly symbolMap: RecordSymbolMap;
}

/** Result of the pure import validation. */
export type InformationValidation =
  | { readonly ok: true }
  | { readonly ok: false; readonly violations: readonly InformationViolation[] };

/**
 * Validate one information import completely. Pure: same input ⇒ same
 * violation list, always (no IO, no clock reads, no RNG — A9).
 */
export function validateInformationImport(
  input: InformationImportInput,
): InformationValidation {
  const violations: InformationViolation[] = [];
  for (const problem of validateInformationDatasetDescriptor(input.descriptor)) {
    violations.push({ kind: "invalid-descriptor", detail: problem });
  }
  violations.push(...sourceDeclarationViolations(input.sources));
  const declaredKinds = new Set<string>(input.descriptor.recordKinds);
  const declaredSources = new Set<string>(
    input.sources
      .filter((declaration) => isNonBlank(declaration?.source))
      .map((declaration) => declaration.source),
  );
  const seenSourceIds = new Map<string, number>();
  for (let index = 0; index < input.records.length; index += 1) {
    const record = input.records[index]!;
    violations.push(
      ...recordViolations(
        record,
        index,
        declaredKinds,
        declaredSources,
        input.symbolMap,
        seenSourceIds,
      ),
    );
    if (
      isRecordLike(record) &&
      isNonBlank(record.sourceId) &&
      !seenSourceIds.has(record.sourceId)
    ) {
      seenSourceIds.set(record.sourceId, index);
    }
  }
  violations.push(...orderingViolations(input.records));
  violations.push(
    ...rangeGapViolations(input.records, input.descriptor.range, input.descriptor.knownGaps),
  );
  return violations.length === 0 ? { ok: true } : { ok: false, violations };
}
