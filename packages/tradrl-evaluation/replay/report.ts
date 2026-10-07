/**
 * The findings report (W022): the verification verdicts AS DATA — a
 * deterministic, content-addressed report (the W028 digest family:
 * `stableDigest` — canonical JSON + FNV-1a, so digests agree with the
 * engine's own content addressing).
 *
 * Determinism laws (A9):
 * - NO wall time, NO paths, NO environment anywhere in the report — the
 *   content digest is a pure function of the findings (same verification
 *   run ⇒ same digest, on any machine, at any time);
 * - `dumpReplayVerificationReport` is a TYPED DUMP (one stable line per
 *   verdict + case), not pretty-printing: the same report always dumps to
 *   the identical text.
 */

import { stableDigest } from "tradrl-world-sim/world";
import {
  assertFindingsArePlainData,
  findingDigestOf,
  summarizeVerdicts,
  type FidelityFinding,
} from "./findings.js";

/** The report schema identity (one per breaking change — never silently). */
export const REPLAY_VERIFICATION_SCHEMA = "tradrl-evaluation-replay@1";

/** The content-addressed findings report. */
export interface ReplayVerificationReport {
  readonly schemaVersion: typeof REPLAY_VERIFICATION_SCHEMA;
  /** What was verified (the adapter + its catalog identity — never paths). */
  readonly subject: {
    readonly adapter: "tradrl-adapters-nautilus";
    readonly catalogId: string;
    readonly claims: readonly string[];
  };
  readonly findings: readonly FidelityFinding[];
  readonly summary: { readonly pass: number; readonly fail: number; readonly partial: number; readonly total: number };
  /** The per-finding content digests, in findings order (tamper evidence). */
  readonly findingDigests: readonly string[];
  /** The content address of this whole report (A9, the W028 family). */
  readonly contentDigest: string;
}

/**
 * Build the content-addressed report from findings. Pure: freezes, digests
 * every finding, then digests the whole stable core — the same findings
 * always produce the bit-identical report. Fails closed if any finding
 * smuggled non-plain data (evidence must journal cleanly).
 */
export function buildReplayVerificationReport(input: {
  readonly catalogId: string;
  readonly findings: readonly FidelityFinding[];
}): ReplayVerificationReport {
  assertFindingsArePlainData(input.findings);
  const findings = Object.freeze([...input.findings]);
  const summary = summarizeVerdicts(findings);
  const findingDigests = Object.freeze(findings.map((finding) => findingDigestOf(finding)));
  const core: {
    schemaVersion: typeof REPLAY_VERIFICATION_SCHEMA;
    subject: { adapter: "tradrl-adapters-nautilus"; catalogId: string; claims: readonly string[] };
    findings: readonly FidelityFinding[];
    summary: { pass: number; fail: number; partial: number; total: number };
    findingDigests: readonly string[];
  } = {
    schemaVersion: REPLAY_VERIFICATION_SCHEMA,
    subject: {
      adapter: "tradrl-adapters-nautilus" as const,
      catalogId: input.catalogId,
      claims: findings.map((finding) => finding.claimId),
    },
    findings,
    summary,
    findingDigests,
  };
  return Object.freeze<ReplayVerificationReport>({
    ...core,
    contentDigest: stableDigest(core),
  });
}

/**
 * The typed dump: one stable line per verdict, one indented line per case,
 * the summary + content digest at the end. Deterministic — the same report
 * dumps to the identical text (no colors, no boxes, no time).
 */
export function dumpReplayVerificationReport(report: ReplayVerificationReport): string {
  const lines: string[] = [
    `== tradrl-evaluation-replay findings (${report.schemaVersion}) ==`,
    `subject: ${report.subject.adapter} / catalog ${report.subject.catalogId} / ${String(report.subject.claims.length)} claims`,
  ];
  for (const finding of report.findings) {
    lines.push(`${finding.verdict}  ${finding.claimId} — ${finding.claim}`);
    if (finding.limitation !== undefined) {
      lines.push(`  [limitation] ${finding.limitation}`);
    }
    for (const verdict of finding.cases) {
      lines.push(`  [case ${verdict.caseId}] ${verdict.problem === undefined ? "held" : "VIOLATED"} — ${verdict.expected}`);
      if (verdict.problem !== undefined) {
        lines.push(`    problem: ${verdict.problem}`);
        lines.push(`    observed: ${verdict.observed}`);
      }
    }
    if (finding.problem !== undefined) {
      lines.push(`  problem: ${finding.problem}`);
    }
  }
  lines.push(
    `summary: ${String(report.summary.pass)} pass / ${String(report.summary.fail)} fail / ${String(report.summary.partial)} partial (${String(report.summary.total)} claims)`,
  );
  lines.push(`content digest: ${report.contentDigest}`);
  return `${lines.join("\n")}\n`;
}
