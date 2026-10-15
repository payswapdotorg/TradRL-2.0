/**
 * The Time Machine's deterministic-replay fidelity proofs (W050) — the
 * W022 pattern applied to point-in-time views.
 *
 * Spec: spec/WORK-ITEMS.md W022 — "replay fidelity verification": typed
 * `{ claim, verdict, evidence }` findings, each backed by cases whose
 * expectations CAN be violated; the verdict is DERIVED from the cases,
 * never trusted from the caller. A FAIL verdict is a VALID outcome — it
 * means the machine's own determinism claim did not hold under its own
 * harness.
 * Spec: spec/ARCHITECTURE-LOCK.md A9 — the twin law: the same view
 * re-assembled twice deep-equals; the view digest re-derivation: the
 * content-addressed ids of the assembled view re-derive from its own
 * recorded data (replay fidelity — a recorded view replays bit-for-bit).
 *
 * The deep-equality witness is the repository's canonical serialization
 * family (`canonicalString`, the W037/W047 lineage): two plain-data values
 * are deep-equal exactly when their canonical encodings are equal — no
 * second equality rule.
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import type { FidelityVerdict } from "tradrl-evaluation-replay";
import { canonicalDigestHex, canonicalString } from "trajectory";
import type { PointInTimeQuery, PointInTimeView } from "tradrl-time-machine";
import { sealView, validatePointInTimeView } from "tradrl-time-machine";
import type { AssembleViewOutcome, TimeMachineStream } from "./engine.js";
import { assembleView } from "./engine.js";

// ---------------------------------------------------------------------------
// The finding shapes (the W022 `{ claim, verdict, evidence }` family)
// ---------------------------------------------------------------------------

/** One check case's outcome — the per-case evidence a finding carries. */
export interface ViewFidelityCase {
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

/** The finding of one fidelity claim — `{ claim, verdict, evidence }`. */
export interface ViewFidelityFinding {
  readonly claimId: string;
  readonly claim: string;
  /** Where the claim is declared (this package's own laws). */
  readonly declaredIn: string;
  readonly verdict: FidelityVerdict;
  readonly cases: readonly ViewFidelityCase[];
}

/** The deterministic, content-addressed fidelity report. */
export interface ViewFidelityReport {
  /** Content-addressed id: `pitfr-<digest>` over the findings (A9). */
  readonly reportId: string;
  readonly findings: readonly ViewFidelityFinding[];
  /** True exactly when every finding's verdict is PASS. */
  readonly allPassed: boolean;
}

/** Derive the verdict from the cases (never trusted from the caller). */
function verdictOf(cases: readonly ViewFidelityCase[]): FidelityVerdict {
  return cases.some((oneCase) => oneCase.problem !== undefined) ? "FAIL" : "PASS";
}

// ---------------------------------------------------------------------------
// The proofs
// ---------------------------------------------------------------------------

function outcomeSummary(outcome: AssembleViewOutcome): string {
  if (outcome.ok) {
    return `assembled view ${String(outcome.assembled.view.viewId)} ` +
      `(${String(outcome.assembled.view.records.length)} sealed records, ` +
      `${String(outcome.assembled.summaries.length)} stream summaries)`;
  }
  const first = outcome.errors[0];
  return `fail-closed: ${String(first?.code ?? "none")} — ${String(first?.message ?? "")}`;
}

/**
 * The A9 twin: the same query + the same streams assembled twice must
 * deep-equal (view or refusal) through the canonical encoding.
 */
function twinFinding(query: PointInTimeQuery, streams: readonly TimeMachineStream[]): ViewFidelityFinding {
  const first = assembleView(query, streams);
  const second = assembleView(query, streams);
  const equal = canonicalString(first) === canonicalString(second);
  const oneCase: ViewFidelityCase = {
    caseId: "twin-assembly",
    describe: "the same point-in-time query + the same recorded streams, assembled twice",
    expected: "deep-equal outcomes (assembled views, or fail-closed refusals) — the canonical encodings match",
    observed: `first: ${outcomeSummary(first)}; second: ${outcomeSummary(second)}`,
    ...(equal ? {} : { problem: "the twin assemblies diverged — the machine is not a pure function of its inputs" }),
  };
  return {
    claimId: "same-inputs-deep-equal-view",
    claim:
      "A9 determinism: the Time Machine is a pure function of (query, streams) — the same " +
      "recorded streams sealed at the same cutoff always assemble the deep-equal view",
    declaredIn: "spec/ARCHITECTURE-LOCK.md A9 (the twin law)",
    verdict: verdictOf([oneCase]),
    cases: [oneCase],
  };
}

/**
 * Replay fidelity: the assembled view's canonical ids (the firewall
 * digest, the view id) must RE-DERIVE from the view's own recorded data —
 * a recorded view replays bit-for-bit through the whole-record validator.
 */
function digestReDerivationFinding(
  query: PointInTimeQuery,
  streams: readonly TimeMachineStream[],
): ViewFidelityFinding {
  const outcome = assembleView(query, streams);
  const cases: ViewFidelityCase[] = [];
  if (outcome.ok) {
    const validation = validatePointInTimeView(outcome.assembled.view);
    cases.push({
      caseId: "view-whole-record-reproof",
      describe: "the assembled view re-proven through the contract's whole-record validator",
      expected: "ok — the query id, firewall digest and view id all re-derive from the recorded data",
      observed: validation.ok
        ? `ok — view ${String(outcome.assembled.view.viewId)} replays bit-for-bit`
        : `refused: ${String(validation.errors[0]?.code ?? "none")} — ${String(validation.errors[0]?.message ?? "")}`,
      ...(validation.ok ? {} : { problem: "the recorded view failed its own whole-record re-proof" }),
    });
  } else {
    cases.push({
      caseId: "deterministic-refusal",
      describe: "the inputs fail-closed before a view exists",
      expected: "a deterministic refusal (the fail-closed outcome is itself reproducible)",
      observed: outcomeSummary(outcome),
    });
  }
  return {
    claimId: "view-digest-re-derivation",
    claim:
      "replay fidelity: an assembled point-in-time view's canonical ids (firewall digest, " +
      "view id) re-derive from the view's own recorded data — a recorded view replays exactly",
    declaredIn: "spec/WORK-ITEMS.md W022 (the replay-fidelity pattern), applied to W050 views",
    verdict: verdictOf(cases),
    cases,
  };
}

/**
 * The firewall seal reproducibility: re-sealing the assembled view's own
 * records through the contract gate must reproduce the bit-identical view.
 */
function sealReproducibilityFinding(
  query: PointInTimeQuery,
  streams: readonly TimeMachineStream[],
): ViewFidelityFinding {
  const outcome = assembleView(query, streams);
  const cases: ViewFidelityCase[] = [];
  if (outcome.ok) {
    const resealed = sealView(query, outcome.assembled.view.records);
    const equal =
      resealed.ok &&
      canonicalString(resealed.view) === canonicalString(outcome.assembled.view as PointInTimeView);
    cases.push({
      caseId: "re-seal-of-the-sealed-records",
      describe: "the view's own sealed records re-sealed through the knowledge firewall gate",
      expected: "the bit-identical view (same view id, same firewall digest, same proof)",
      observed: resealed.ok
        ? `re-sealed view ${String(resealed.view.viewId)}`
        : `the gate refused: ${String(resealed.refusal.code)} — ${String(resealed.refusal.message)}`,
      ...(equal ? {} : { problem: "the re-seal did not reproduce the recorded view bit-for-bit" }),
    });
  } else {
    cases.push({
      caseId: "deterministic-refusal",
      describe: "the inputs fail-closed before a view exists",
      expected: "a deterministic refusal (the fail-closed outcome is itself reproducible)",
      observed: outcomeSummary(outcome),
    });
  }
  return {
    claimId: "firewall-seal-reproducible",
    claim:
      "the knowledge firewall is reproducible: sealing the view's own records again through " +
      "the R016 gate reproduces the bit-identical sealed view",
    declaredIn: "spec/REQUIREMENTS.md R016 (the typed gate law)",
    verdict: verdictOf(cases),
    cases,
  };
}

/**
 * Prove the Time Machine's fidelity claims over one (query, streams)
 * input: the A9 twin, the view digest re-derivation, and the firewall
 * seal reproducibility — assembled into the deterministic,
 * content-addressed report. Pure (A9): the same inputs always yield the
 * deep-equal report.
 */
export function proveViewFidelity(
  query: PointInTimeQuery,
  streams: readonly TimeMachineStream[],
): ViewFidelityReport {
  const findings: ViewFidelityFinding[] = [
    twinFinding(query, streams),
    digestReDerivationFinding(query, streams),
    sealReproducibilityFinding(query, streams),
  ];
  const reportId = `pitfr-${canonicalDigestHex(findings)}`;
  return Object.freeze({
    reportId,
    findings: Object.freeze(findings),
    allPassed: findings.every((finding) => finding.verdict === "PASS"),
  });
}
