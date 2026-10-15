/**
 * Load-time validation (W042) — the catalogue laws and the demand-shape
 * laws, re-proved from the recorded data (fail-closed at every seam).
 *
 * The catalogue (benchmarks/model-capability — dependency-free
 * declarative data) is validated HERE at load: unique ids, the closed
 * W040 kind/domain vocabularies (imported from capability-registry,
 * never re-declared), the closed evidence-shape set, single-scope
 * agreement (field equality), axis-atom legality (the W037 atom family:
 * legal kind, non-blank members, well-formed periods, non-empty,
 * duplicate-free), and the immutable lineage (genesis shape + version
 * continuity). Every violation is a LOUD typed error — never a silent
 * drop, never a "best effort" skip.
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import { CAPABILITY_DOMAINS, CAPABILITY_KINDS } from "capability-registry";
import type { CatalogueError } from "./demand.js";
import {
  BENCHMARK_ATOM_KINDS,
  BENCHMARK_EVIDENCE_SHAPE,
} from "./demand.js";
import type { BenchmarkDescriptor, BenchmarkSplitAtom } from "./demand.js";
import type { SelectionScope } from "./identity.js";

export type CatalogueValidationOutcome =
  | { readonly ok: true; readonly checked: readonly string[] }
  | { readonly ok: false; readonly errors: readonly CatalogueError[] };

function error(
  code: CatalogueError["code"],
  message: string,
  benchmarkId?: string,
): CatalogueError {
  return { code, message, ...(benchmarkId === undefined ? {} : { benchmarkId }) };
}

function sameScope(
  left: { readonly tenantId: string; readonly projectId: string; readonly worldId: string },
  right: SelectionScope,
): boolean {
  return (
    String(left.tenantId) === String(right.tenantId) &&
    String(left.projectId) === String(right.projectId) &&
    String(left.worldId) === String(right.worldId)
  );
}

/** The canonical data key of one atom (kind + fields, compared AS DATA). */
export function atomKey(atom: BenchmarkSplitAtom): string {
  switch (atom.kind) {
    case "period":
      return `period:${String(atom.from)}:${String(atom.to)}`;
    case "regime":
      return `regime:${String(atom.regimeId)}`;
    case "asset":
      return `asset:${String(atom.instrumentId)}`;
    case "venue":
      return `venue:${String(atom.venueId)}`;
  }
}

/** Is this runtime value a LEGAL atom of its declared kind (post-parse re-proof)? */
function legalAtom(atom: BenchmarkSplitAtom, benchmarkId: string, errors: CatalogueError[]): boolean {
  const kind = String((atom as { readonly kind?: unknown }).kind);
  if (!BENCHMARK_ATOM_KINDS.some((member) => member === kind)) {
    errors.push(error("unknown-axis-kind", `benchmark '${benchmarkId}' declares an axis atom of kind '${kind}' — the W037 atom family is ${BENCHMARK_ATOM_KINDS.join(", ")} only`, benchmarkId));
    return false;
  }
  if (kind === "period") {
    const from = Number((atom as { readonly from?: unknown }).from);
    const to = Number((atom as { readonly to?: unknown }).to);
    if (!Number.isFinite(from) || !Number.isFinite(to) || from >= to) {
      errors.push(error("invalid-period-atom", `benchmark '${benchmarkId}' declares a period atom [${String(from)}, ${String(to)}) — a period opens before it closes`, benchmarkId));
      return false;
    }
    return true;
  }
  const id =
    kind === "regime"
      ? String((atom as { readonly regimeId?: unknown }).regimeId)
      : kind === "asset"
        ? String((atom as { readonly instrumentId?: unknown }).instrumentId)
        : String((atom as { readonly venueId?: unknown }).venueId);
  if (id.trim() === "") {
    errors.push(error("blank-axis-member", `benchmark '${benchmarkId}' declares a blank '${kind}' atom id — an atom names its regime/asset/venue`, benchmarkId));
    return false;
  }
  return true;
}

function validateLineage(
  benchmark: BenchmarkDescriptor,
  byId: Map<string, BenchmarkDescriptor>,
  errors: CatalogueError[],
): void {
  const id = String(benchmark.benchmarkId);
  const version = Number(benchmark.lineage.version);
  const parent = benchmark.lineage.parentBenchmarkId;
  if (parent === null) {
    if (version !== 1) {
      errors.push(error("invalid-lineage", `benchmark '${id}' is genesis (no parent) but declares version ${String(version)} — a genesis benchmark is version 1`, id));
    }
    return;
  }
  if (String(parent).trim() === "") {
    errors.push(error("invalid-lineage", `benchmark '${id}' cites a blank parent — a successor names its parent`, id));
    return;
  }
  const parentEntry = byId.get(String(parent));
  if (parentEntry === undefined) {
    errors.push(error("lineage-break", `benchmark '${id}' cites parent '${String(parent)}' which the catalogue does not declare — lineage is never dangling`, id));
    return;
  }
  if (version !== Number(parentEntry.lineage.version) + 1) {
    errors.push(error("invalid-lineage", `benchmark '${id}' declares version ${String(version)} but its parent is version ${String(parentEntry.lineage.version)} — a successor is exactly parent.version + 1`, id));
  }
}

/**
 * The catalogue's own honesty gate: unique ids, closed vocabularies,
 * single scope, legal atoms, immutable lineage. Pure, deterministic,
 * fail-closed — the walk never consults an unvalidated catalogue.
 */
export function validateBenchmarkCatalogue(
  catalogue: readonly BenchmarkDescriptor[],
): CatalogueValidationOutcome {
  const errors: CatalogueError[] = [];
  const byId = new Map<string, BenchmarkDescriptor>();
  const seenIds = new Set<string>();
  let reference: SelectionScope | undefined;

  for (const benchmark of catalogue) {
    const id = String(benchmark.benchmarkId ?? "");
    if (id.trim() === "" || String(benchmark.name ?? "").trim() === "") {
      errors.push(error("blank-benchmark-member", `a benchmark declares a blank id or name — a benchmark is named (data, never a prompt)`, id));
      continue;
    }
    if (seenIds.has(id)) {
      errors.push(error("duplicate-benchmark", `benchmark '${id}' is declared twice — one id, one benchmark`, id));
      continue;
    }
    seenIds.add(id);
    byId.set(id, benchmark);

    if (!CAPABILITY_KINDS.some((member) => member === benchmark.capabilityKind)) {
      errors.push(error("unknown-capability-kind", `benchmark '${id}' declares capability kind '${String(benchmark.capabilityKind)}' — the registry answers in ${CAPABILITY_KINDS.join(", ")} only (W040's closed vocabulary)`, id));
    }
    if (!CAPABILITY_DOMAINS.some((member) => member === benchmark.capabilityDomain)) {
      errors.push(error("unknown-capability-domain", `benchmark '${id}' declares capability domain '${String(benchmark.capabilityDomain)}' — the registry answers in ${CAPABILITY_DOMAINS.join(", ")} only (W040's closed vocabulary)`, id));
    }
    if (benchmark.requiredEvidence.length === 0) {
      errors.push(error("empty-evidence-shape", `benchmark '${id}' demands no evidence component — a benchmark is justified against the experiment + evaluation + findings chain`, id));
    }
    for (const member of benchmark.requiredEvidence) {
      if (!BENCHMARK_EVIDENCE_SHAPE.some((entry) => entry === member)) {
        errors.push(error("unknown-evidence-shape", `benchmark '${id}' demands evidence component '${String(member)}' — the closed set is ${BENCHMARK_EVIDENCE_SHAPE.join(", ")}`, id));
      }
    }

    const scope = benchmark.scope;
    if (String(scope.tenantId ?? "").trim() === "" || String(scope.projectId ?? "").trim() === "" || String(scope.worldId ?? "").trim() === "") {
      errors.push(error("blank-benchmark-member", `benchmark '${id}' declares a blank scope member — the catalogue scope is explicit, never blank`, id));
    } else if (reference === undefined) {
      reference = { tenantId: String(scope.tenantId), projectId: String(scope.projectId), worldId: String(scope.worldId) };
    } else if (!sameScope(scope, reference)) {
      errors.push(error("catalogue-scope-mismatch", `benchmark '${id}' declares scope (${String(scope.tenantId)}, ${String(scope.projectId)}, ${String(scope.worldId)}) which disagrees with the catalogue's declared scope — the catalogue is single-scope`, id));
    }

    const axisIds = new Set<string>();
    for (const axis of benchmark.requiredAxes) {
      const axisId = String(axis.axisId ?? "");
      if (axisId.trim() === "") {
        errors.push(error("blank-axis-member", `benchmark '${id}' declares a blank axis id — an axis is named`, id));
        continue;
      }
      if (axisIds.has(axisId)) {
        errors.push(error("duplicate-axis", `benchmark '${id}' declares axis '${axisId}' twice — one axisId, one axis`, id));
        continue;
      }
      axisIds.add(axisId);
      if (!BENCHMARK_ATOM_KINDS.some((member) => member === axis.kind)) {
        errors.push(error("unknown-axis-kind", `benchmark '${id}' axis '${axisId}' declares kind '${String(axis.kind)}' — the W037 atom family is ${BENCHMARK_ATOM_KINDS.join(", ")} only`, id));
        continue;
      }
      if (axis.atoms.length === 0) {
        errors.push(error("empty-axis", `benchmark '${id}' axis '${axisId}' demands no atom — a required axis names at least one atom`, id));
        continue;
      }
      const atomKeys = new Set<string>();
      for (const atom of axis.atoms) {
        if (!legalAtom(atom, id, errors)) {
          continue;
        }
        if (String(atom.kind) !== String(axis.kind)) {
          errors.push(error("unknown-axis-kind", `benchmark '${id}' axis '${axisId}' is a '${String(axis.kind)}' axis but carries a '${String(atom.kind)}' atom — an axis's atoms are of its own family`, id));
          continue;
        }
        const key = atomKey(atom);
        if (atomKeys.has(key)) {
          errors.push(error("duplicate-atom", `benchmark '${id}' axis '${axisId}' demands atom '${key}' twice — one atom once`, id));
          continue;
        }
        atomKeys.add(key);
      }
    }
  }

  for (const benchmark of catalogue) {
    if (byId.has(String(benchmark.benchmarkId))) {
      validateLineage(benchmark, byId, errors);
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }
  return { ok: true, checked: [...seenIds].sort() };
}
