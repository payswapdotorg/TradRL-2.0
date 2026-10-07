/**
 * Typed fidelity findings (W022 `tradrl-evaluation-replay`) — the verdict
 * core every check emits.
 *
 * Spec: spec/WORK-ITEMS.md W022 — "Replay fidelity verification": the
 * evaluation surface that takes adapter datasets/claims and emits typed
 * verdicts. A finding is `{ claim, verdict, evidence }` (deterministic,
 * journalable): the CLAIM quotes the adapter's own declaration verbatim, the
 * VERDICT is PASS (held under every case), FAIL (a case violated the claim,
 * or a declared-scope limitation went undisclosed), or PARTIAL (the claim
 * holds within its DECLARED scope and the limitation is disclosed in the
 * adapter's fidelity declaration — an honestly scoped claim, never a silent
 * approximation).
 *
 * Verdict law (the falsifiability rule): a check that cannot fail is
 * worthless. Every finding is backed by cases whose expectations CAN be
 * violated (adversarial fixtures, mutation-tested in this package's own
 * suite); a FAIL verdict is a VALID outcome of this harness, not a defect
 * of it — it means the adapter's declared convention did not hold.
 *
 * Content addressing (the W028 family): every finding carries a digest of
 * its own stable content (`stableDigest` — canonical JSON + FNV-1a, the
 * engine's own content-addressing family) so a findings report is
 * tamper-evident data: same claim verification ⇒ same finding digest, always
 * (A9).
 */

import { stableDigest } from "tradrl-world-sim/world";

/** The verdict of one fidelity claim. */
export type FidelityVerdict = "PASS" | "FAIL" | "PARTIAL";

/**
 * One check case's outcome — the per-case evidence a finding carries. Plain
 * frozen data (JSON-serializable, deterministic): what was fed, what the
 * expectation was, what was observed, and why it failed (when it did).
 */
export interface CaseVerdict {
  readonly caseId: string;
  /** What this case proves (one line, deterministic). */
  readonly describe: string;
  /** The expectation in force (a claim the case checks — CAN be violated). */
  readonly expected: string;
  /** What actually happened (typed observation summary, path-free). */
  readonly observed: string;
  /** Held exactly when undefined; otherwise the violation, quoted. */
  readonly problem?: string;
}

/** The finding of one fidelity claim — the `{ claim, verdict, evidence }` shape. */
export interface FidelityFinding {
  /** Stable claim id (the registry key — e.g. "ns-to-ms-exact-digit-truncation"). */
  readonly claimId: string;
  /** The adapter's declared claim, QUOTED VERBATIM from its declaration. */
  readonly claim: string;
  /** Where the claim is declared (e.g. "nautilus.fidelity.conventions[0]"). */
  readonly declaredIn: string;
  readonly verdict: FidelityVerdict;
  /** Per-case evidence (deterministic order — the case list's order). */
  readonly cases: readonly CaseVerdict[];
  /** PARTIAL only: the disclosed limitation, quoted from the declaration. */
  readonly limitation?: string;
  /** FAIL only: what violated the claim (the first offender, quoted). */
  readonly problem?: string;
}

/** Is the value plain JSON-serializable data (findings must journal cleanly)? */
function isPlainData(value: unknown, depth: number): boolean {
  if (depth > 8) {
    return false;
  }
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return true;
  }
  if (Array.isArray(value)) {
    return value.every((entry) => isPlainData(entry, depth + 1));
  }
  if (typeof value === "object") {
    return Object.values(value as Record<string, unknown>).every((entry) =>
      isPlainData(entry, depth + 1),
    );
  }
  return false;
}

/** Deep-freeze plain findings data (the W020 loader discipline, depth-bounded). */
function freezePlain<T>(value: T, depth: number): T {
  if (depth > 8 || value === null || typeof value !== "object") {
    return value;
  }
  if (Array.isArray(value)) {
    return Object.freeze(value.map((entry) => freezePlain(entry, depth + 1))) as unknown as T;
  }
  const frozen: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    frozen[key] = entry === undefined ? undefined : freezePlain(entry, depth + 1);
  }
  return Object.freeze(frozen) as unknown as T;
}

/**
 * Assemble one finding. Pure and total: freezes the evidence and derives the
 * verdict from the case verdicts (never trusted from the caller):
 * - any case with a problem ⇒ FAIL (the claim did not hold);
 * - otherwise, when `limitation` is set (the claim is scoped by the adapter's
 *   own disclosure) ⇒ PARTIAL (held in scope, disclosed out of scope);
 * - otherwise ⇒ PASS.
 */
export function findingOf(input: {
  readonly claimId: string;
  readonly claim: string;
  readonly declaredIn: string;
  readonly cases: readonly CaseVerdict[];
  /** The disclosed limitation this claim is scoped by (omitted for total claims). */
  readonly limitation?: string;
}): FidelityFinding {
  const offender = input.cases.find((entry) => entry.problem !== undefined);
  const verdict: FidelityVerdict =
    offender !== undefined ? "FAIL" : input.limitation === undefined ? "PASS" : "PARTIAL";
  return freezePlain(
    {
      claimId: input.claimId,
      claim: input.claim,
      declaredIn: input.declaredIn,
      verdict,
      cases: input.cases,
      ...(input.limitation === undefined ? {} : { limitation: input.limitation }),
      ...(offender === undefined
        ? {}
        : {
            problem: `case '${offender.caseId}': ${offender.problem ?? "violated"}`,
          }),
    },
    0,
  ) as FidelityFinding;
}

/** The content digest of one finding (its own stable content — A9, the W028 family). */
export function findingDigestOf(finding: FidelityFinding): string {
  return stableDigest(finding);
}

/** Verdict tallies over a findings list. */
export interface VerdictSummary {
  readonly pass: number;
  readonly fail: number;
  readonly partial: number;
  readonly total: number;
}

/** Tally verdicts (deterministic — a pure count over the list). */
export function summarizeVerdicts(findings: readonly FidelityFinding[]): VerdictSummary {
  let pass = 0;
  let fail = 0;
  let partial = 0;
  for (const finding of findings) {
    if (finding.verdict === "PASS") {
      pass += 1;
    } else if (finding.verdict === "FAIL") {
      fail += 1;
    } else {
      partial += 1;
    }
  }
  return { pass, fail, partial, total: findings.length };
}

/**
 * The harness's own honesty law: findings must stay plain serializable data
 * (journalable). Throws loudly if a check ever smuggles a non-JSON value
 * (a function, a Symbol, undefined-in-array…) into evidence — fail-closed
 * on the harness itself.
 */
export function assertFindingsArePlainData(findings: readonly FidelityFinding[]): void {
  for (const finding of findings) {
    if (!isPlainData(finding, 0)) {
      throw new Error(
        `finding '${finding.claimId}' is not plain JSON-serializable data — evidence must journal cleanly`,
      );
    }
  }
}
