/**
 * The W064 reference-journey HELPERS — the fail-closed composition spine:
 * every gate outcome is unwrapped LOUDLY (a refused gate stops the journey
 * with the gate's own errors carried verbatim — never swallowed), and the
 * journey's composed summary is content-addressed over the ordered record
 * ids + the CARRIED counts only (A6: no number the cited records do not
 * carry; A9: the same journey ⇒ the same id).
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import { canonicalDigestHex } from "../../packages/trajectory/index.js";
import { JOURNEY_ID_PREFIX } from "./journeyFacts.js";

/** One fail-closed gate outcome (the repo's uniform shape: the success
 * member rides beside `ok`; the errors ride the refusal). */
export interface GateOutcome {
  readonly ok: boolean;
  readonly errors?: readonly unknown[];
}

/** The success member of a gate outcome (the `{ ok: true }` arm). */
export type SuccessOf<O> = O extends { readonly ok: true } ? O : never;

/** Unwrap a gate outcome LOUDLY — a refusal carries the gate's own errors
 * (every code + message, verbatim) and stops the journey. */
export function mustOk<O extends GateOutcome>(outcome: O, stage: string): SuccessOf<O> {
  if (!outcome.ok) {
    const refused = outcome as { readonly errors?: readonly unknown[]; readonly violations?: readonly unknown[] };
    const list = refused.errors ?? refused.violations ?? [];
    const detail = list
      .map((error) => {
        const record = error as { code?: unknown; message?: unknown; kind?: unknown; detail?: unknown };
        const code = record.code ?? record.kind ?? "violation";
        const message = record.message ?? record.detail ?? JSON.stringify(error);
        return `${String(code)}: ${String(message)}`;
      })
      .join("; ");
    throw new Error(`journey stage '${stage}' refused by its own gate — ${detail}`);
  }
  return outcome as SuccessOf<O>;
}

/** One composed stage line: the stage's gate citation, its record id, and
 * the count the RECORD itself carries (A6 — never a re-derived number). */
export interface StageLine {
  readonly stage: string;
  readonly gate: string;
  readonly recordId: string;
  readonly carriedCount: number | null;
}

/** The canonical content a journey id addresses (the ordered stage lines). */
export function journeyCanonicalContent(lines: readonly StageLine[]): unknown {
  return {
    stages: lines.map((line) => ({
      carriedCount: line.carriedCount,
      gate: line.gate,
      recordId: line.recordId,
      stage: line.stage,
    })),
  };
}

/** The journey's content-addressed id: `journey-<digest>` over the ordered
 * stage lines (A9 — the same composed records ⇒ the same id, always). */
export function journeyIdOf(lines: readonly StageLine[]): string {
  return `${JOURNEY_ID_PREFIX}${canonicalDigestHex(journeyCanonicalContent(lines))}`;
}

/** Render one stage line for the journey's printed report. */
export function renderStageLine(line: StageLine): string {
  const count = line.carriedCount === null ? "" : ` · carries ${String(line.carriedCount)}`;
  return `${line.stage} [${line.gate}] → ${line.recordId}${count}`;
}
