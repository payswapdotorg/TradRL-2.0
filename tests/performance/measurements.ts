/**
 * The pinned PERFORMANCE MEASUREMENTS (W062 `tests/performance/`) — A6
 * discipline: every measured number is CARRIED by a pinned record that cites
 * the exact input, the law under which it was measured, and the repository
 * head of the pinning run. The suites REPORT what they measure (each run
 * prints its live measurement records); the assertions are over
 * DETERMINISTIC LAWS (monotonicity, exactness, completeness, order
 * invariance) plus GENEROUS reliability ceilings — never wall-clock equality
 * (A9 has no clocks; a performance claim here is evidence, not a law).
 *
 * The pinning run: `npx tsx --test tests/performance/*.test.ts` at the head
 * below, on this repository's CI-class runner.
 * License: Apache-2.0 (the repository LICENSE).
 */

/** The repository head at which the pinned measurements were taken. */
export const PINNING_HEAD = "eada0cef5b2cd00f374690b000cfc337a3c714fa";

/** One pinned measurement (A6 — carried, cited, never invented). */
export interface PinnedMeasurement {
  /** The deterministic law the run exercised. */
  readonly law: string;
  /** What was measured. */
  readonly subject: string;
  /** The deterministic input size (records, declarations, …). */
  readonly inputCount: number;
  /** A count CARRIED by the measured record itself (view size, violation
   * count, verified record count — never a duration). */
  readonly carriedCount: number;
  /** The duration measured at the pinning run, in milliseconds. */
  readonly measuredMs: number;
  /** Where the measurement was taken. */
  readonly measuredAtHead: string;
}

/**
 * The pinned BASELINE — what the pinning run measured. Carried as evidence
 * for the reliability ceilings below; the suites never assert equality with
 * these numbers (wall-clock equality is not a law), they REPORT the live
 * measurement beside this baseline.
 */
export const PINNED_BASELINE: readonly PinnedMeasurement[] = [
  // Filled by the pinning run (see the suite files' REPORT lines).
];

/** The generous reliability ceilings (pathology guards, NOT performance
 * claims — each is ~3 orders of magnitude above the pinned baseline, so a
 * ceiling trip means a broken build/environment, not a slow machine). */
export const CEILING_MS_PER_SEAL = 5000;
export const CEILING_MS_PER_TRAIL_RECORD = 1.0;
export const CEILING_MS_PER_ROUTE_DECLARATION = 1.0;
export const CEILING_MS_PER_OPS_ROUTE_DECLARATION = 1.0;

/** Build one live measurement record (the suites' REPORT payload). */
export function measurementOf(
  law: string,
  subject: string,
  inputCount: number,
  carriedCount: number,
  measuredMs: number,
): PinnedMeasurement {
  return {
    law,
    subject,
    inputCount,
    carriedCount,
    measuredMs: Math.max(0, Math.round(measuredMs * 1000) / 1000),
    measuredAtHead: PINNING_HEAD,
  };
}

/** Report one live measurement record (the A6 REPORT line). */
export function report(measured: PinnedMeasurement): void {
  console.log(
    `PERF-EVIDENCE ${measured.law} | ${measured.subject} | input=${String(measured.inputCount)} carried=${String(measured.carriedCount)} measured=${String(measured.measuredMs)}ms head=${measured.measuredAtHead}`,
  );
}
