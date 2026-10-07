/**
 * The claim registry (W022): the inventory of fidelity claims the harness
 * verifies, each bound to the adapter's OWN declaration (quoted verbatim at
 * check time — never paraphrased by the harness).
 *
 * Binding law: a claim is verified against the declaration the adapter
 * ACTUALLY carries today. If the adapter rewords or drops a declaration, the
 * check fails loudly with "the claim is no longer declared" — the harness
 * never verifies against a stale copy of the adapter's words (that would be
 * trusting, not verifying).
 */

import { findingOf, type CaseVerdict, type FidelityFinding } from "./findings.js";

/** One registered fidelity claim (the inventory entry; the check owns the cases). */
export interface FidelityClaimDescriptor {
  readonly claimId: string;
  /** Short label (report/README facing). */
  readonly title: string;
  readonly family: "ns" | "dtype" | "honesty" | "e2e";
  /** The owning check module (the surface that verifies it). */
  readonly module: string;
}

/** The claim inventory — every finding must map to exactly one entry here. */
export const FIDELITY_CLAIM_REGISTRY: readonly FidelityClaimDescriptor[] = [
  // --- ns conventions (nsChecks.ts) ---
  { claimId: "ns-to-ms-exact-digit-truncation", title: "ns→ms by exact digit truncation", family: "ns", module: "nsChecks" },
  { claimId: "ns-sanity-window-1990-2100", title: "the loud 1990..2100 ns sanity window", family: "ns", module: "nsChecks" },
  { claimId: "int64-carrier-fidelity", title: "int64 ns carrier fidelity (string/number)", family: "ns", module: "nsChecks" },
  // --- dtype conventions (dtypeChecks.ts: bars + A7; tickChecks.ts: trades/quotes/decimals) ---
  { claimId: "bar-interval-convention", title: "bar ts_event=interval start, close derived", family: "dtype", module: "dtypeChecks" },
  { claimId: "bar-availability-at-close", title: "bar ts_init→availableAt ≥ close (A7)", family: "dtype", module: "dtypeChecks" },
  { claimId: "tick-availability-boundary", title: "tick ts_init→availableAt ≥ ts_event (A7)", family: "dtype", module: "dtypeChecks" },
  { claimId: "aggressor-side-mapping", title: "aggressor_side BUY/SELL → buy/sell", family: "dtype", module: "tickChecks" },
  { claimId: "trade-id-forms", title: "trade_id int64 + legacy string forms", family: "dtype", module: "tickChecks" },
  { claimId: "quote-no-last", title: "QuoteTick maps to a quote record with no `last`", family: "dtype", module: "tickChecks" },
  { claimId: "float64-canonical-decimal", title: "float64 → canonical decimal (shortest round-trip)", family: "dtype", module: "tickChecks" },
  // --- honesty declarations (honestyChecks.ts) ---
  { claimId: "unmappable-dtype-declaration", title: "unmappable dtypes rejected by declaration", family: "honesty", module: "honestyChecks" },
  { claimId: "bar-hole-detection", title: "bar-sequence holes detected and declared", family: "honesty", module: "honestyChecks" },
  { claimId: "ascending-order-never-resorted", title: "ascending order kept, never re-sorted", family: "honesty", module: "honestyChecks" },
  { claimId: "derived-range-never-claimed", title: "dataset range derived, never claimed", family: "honesty", module: "honestyChecks" },
  { claimId: "known-gap-declaration-honesty", title: "every disclosed limitation stays disclosed", family: "honesty", module: "honestyChecks" },
  { claimId: "acquisition-honesty", title: "acquisition stays honestly not-implemented", family: "honesty", module: "honestyChecks" },
  { claimId: "a9-double-map-determinism", title: "double-map determinism (A9)", family: "honesty", module: "honestyChecks" },
  // --- end-to-end replay pipeline (e2eReplay.ts) ---
  { claimId: "e2e-cli-import-parity", title: "CLI import parity with the direct W020 load", family: "e2e", module: "e2eReplay" },
  { claimId: "e2e-a9-twin-runs", title: "twin CLI runs: identical reportDigest (A9)", family: "e2e", module: "e2eReplay" },
  { claimId: "e2e-w016-restore-equivalence", title: "replay-from-journal == continuation (W016)", family: "e2e", module: "e2eReplay" },
  { claimId: "e2e-replay-input-exactness", title: "replay reproduces the recorded inputs exactly", family: "e2e", module: "e2eReplay" },
];

/** The registry's claim ids in registry order (the meta-test inventory). */
export function registeredClaimIds(): readonly string[] {
  return FIDELITY_CLAIM_REGISTRY.map((entry) => entry.claimId);
}

/**
 * Quote the adapter's declaration carrying a claim: the first declaration
 * entry containing EVERY needle (verbatim substring match). Returns the
 * quote + where it was found, or undefined when the adapter no longer
 * declares the claim (the check must then FAIL — see `undeclared`).
 */
export function quoteDeclaration(
  label: string,
  declarations: readonly string[],
  needles: readonly string[],
): { readonly text: string; readonly declaredIn: string } | undefined {
  const found = declarations.find((entry) => needles.every((needle) => entry.includes(needle)));
  if (found === undefined) {
    return undefined;
  }
  return { text: found, declaredIn: label };
}

/**
 * The finding to emit when a claim is no longer declared by the adapter:
 * a FAIL by definition — the verification cannot bind to words that are
 * not there (never verified against a stale quote).
 */
export function undeclaredProblem(claimId: string, declaredIn: string, needles: readonly string[]): string {
  return (
    `the adapter no longer declares this claim: no entry in ${declaredIn} contains ` +
    `${needles.map((needle) => `'${needle}'`).join(" + ")} — the claim '${claimId}' cannot be verified ` +
    `against words the adapter does not carry (the harness never verifies a stale quote)`
  );
}

/**
 * The complete FAIL finding for an undeclared claim (every check emits this
 * when its declaration binding fails — deterministic shape, single case).
 */
export function undeclaredFinding(input: {
  readonly claimId: string;
  readonly title: string;
  readonly declaredIn: string;
  readonly needles: readonly string[];
}): FidelityFinding {
  return findingOf({
    claimId: input.claimId,
    claim: `${input.title} — NOT DECLARED by the adapter at verification time`,
    declaredIn: input.declaredIn,
    cases: [
      {
        caseId: "declaration-binding",
        describe: "the adapter's declaration still carries this claim's words",
        expected: `an entry in ${input.declaredIn} containing ${input.needles.map((n) => `'${n}'`).join(" + ")}`,
        observed: "no such entry (the declaration moved or was reworded)",
        problem: undeclaredProblem(input.claimId, input.declaredIn, input.needles),
      },
    ],
  });
}

/**
 * The limitation-disclosure case: a claim scoped by the adapter's own
 * disclosure is only PARTIAL while the disclosure exists — an undisclosed
 * limitation is a FAIL (the honesty channel must keep declaring it). Returns
 * the pure case verdict plus the quoted limitation (the finding's
 * `limitation` when present).
 */
export function limitationDisclosure(input: {
  readonly claimId: string;
  readonly knownGaps: readonly string[];
  readonly needles: readonly string[];
}): { readonly caseVerdict: CaseVerdict; readonly quote: string | undefined } {
  const found = input.knownGaps.find((gap) => input.needles.every((needle) => gap.includes(needle)));
  return {
    quote: found,
    caseVerdict: {
      caseId: "limitation-disclosed",
      describe: "the scoped claim's limitation stays disclosed in the fidelity declaration",
      expected: `a knownGaps entry containing ${input.needles.map((n) => `'${n}'`).join(" + ")}`,
      observed:
        found === undefined
          ? "no knownGaps entry discloses the limitation (an honestly scoped claim went silent)"
          : `declared: ${found}`,
      ...(found === undefined
        ? { problem: undeclaredProblem(input.claimId, "nautilus.fidelity.knownGaps", input.needles) }
        : {}),
    },
  };
}

/** The registry title of one claim ("" when unknown — never throws). */
export function claimTitleOf(claimId: string): string {
  return FIDELITY_CLAIM_REGISTRY.find((entry) => entry.claimId === claimId)?.title ?? "";
}

/**
 * The fail-closed isolation wrapper: a check whose EXECUTION crashes must
 * never take down its sibling checks — the claim FAILS with the harness
 * error as its evidence (a verification harness reports its own failure, it
 * never hides it behind a crash).
 */
export function guardedFinding(claimId: string, build: () => FidelityFinding): FidelityFinding {
  try {
    return build();
  } catch (error) {
    const message = `${String((error as Error)?.name ?? "Error")}: ${String((error as Error)?.message ?? error)}`;
    return findingOf({
      claimId,
      claim: `${claimTitleOf(claimId)} — the harness could not evaluate this claim (execution failed)`,
      declaredIn: "the harness itself (fail-closed)",
      cases: [
        {
          caseId: "harness-execution",
          describe: "the check executed against the real surfaces without crashing",
          expected: "the check completes and reports its cases",
          observed: message,
          problem: `the harness failed while verifying this claim: ${message}`,
        },
      ],
    });
  }
}
