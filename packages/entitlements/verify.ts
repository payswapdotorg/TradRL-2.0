/**
 * The entitlement verification (W058) — `verifyEntitlement`, the PURE
 * grant-check: may THIS principal, at THIS declared tick, use THIS
 * listed capability under THESE terms?
 *
 * Four named checks, every mismatch a TYPED reason, never a silent
 * denial (all refusals are collected, none dropped):
 *
 * 1. **scope match** — the use's TENANT must equal the entitlement's
 *    tenant: a cross-tenant use is the LOUD typed `cross-tenant` refusal
 *    naming R056 (the tenant-isolation law of the entitlement family);
 *    a tenant-matching but principal-differing use is
 *    `principal-mismatch`.
 * 2. **capability match** — the use must name the offer the grant covers
 *    (`capability-mismatch`).
 * 3. **period coverage** — the use's declared tick must fall inside the
 *    grant's declared period (inclusive bounds; `period-not-covered`).
 *    A perpetual grant is covered at every declared tick.
 * 4. **terms agreement** — the use's asserted terms must agree with the
 *    grant's (`terms-mismatch` — deep canonical comparison, key order
 *    never matters).
 *
 * The record's own identity is re-proved first (`invalid-entitlement`):
 * the `ent-<digest>` id is a function of the record's carried bytes, so
 * a rewritten record is refused loudly before any grant-check runs.
 *
 * Pure, deterministic, fail-closed: no I/O, no clocks (the use's time is
 * DECLARED data), no execution (A14). License: Apache-2.0 (the
 * repository LICENSE).
 */

import { stableDigest } from "capability-registry";
import { validateEntitlement } from "./validate.js";
import type { Entitlement, EntitlementScope } from "./grant.js";
import { TENANT_ISOLATION_LAW } from "./grant.js";
import type { LicensingTerms } from "marketplace";
import type { OfferId } from "capability-provider";

/** The attempted use: WHO is using, WHICH offer, at WHICH declared tick, under WHICH asserted terms. */
export interface EntitlementUse {
  readonly scope: EntitlementScope;
  readonly offerId: OfferId;
  /** The declared tick of the attempted use (declared data, never a clock read). */
  readonly at: number;
  /** The terms the use asserts the grant carries. */
  readonly terms: LicensingTerms;
}

export type EntitlementRefusalCode =
  | "malformed-use" // the use is not typed data
  | "invalid-entitlement" // the record's own laws fail (id re-derivation)
  | "cross-tenant" // R056: the use's tenant ≠ the entitlement's tenant
  | "principal-mismatch" // same tenant, different principal
  | "capability-mismatch" // the use names an offer the grant does not cover
  | "period-not-covered" // the use's declared tick is outside the period
  | "terms-mismatch"; // the asserted terms disagree with the grant's

/** One typed refusal (fail-closed; the law named in the message). */
export interface EntitlementRefusal {
  readonly code: EntitlementRefusalCode;
  readonly message: string;
  readonly entitlementId?: string;
}

export type EntitlementVerification =
  | { readonly ok: true; readonly entitlement: Entitlement }
  | { readonly ok: false; readonly refusals: readonly EntitlementRefusal[] };

function isRecordLike(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * THE PURE GRANT-CHECK. Deterministic (A9): the same entitlement + the
 * same use always yield the same verdict; no clocks, no randomness, no
 * I/O. Fail-closed: an unknown or malformed anything is a loud typed
 * refusal, never a silent denial, never an accidental grant.
 */
export function verifyEntitlement(
  entitlement: Entitlement,
  use: EntitlementUse,
): EntitlementVerification {
  if (!isRecordLike(entitlement)) {
    return { ok: false, refusals: [{ code: "invalid-entitlement", message: "the entitlement is not typed data — a grant record is required (fail-closed)" }] };
  }
  if (
    !isRecordLike(use) ||
    !isRecordLike(use.scope) ||
    typeof use.at !== "number" ||
    !Number.isSafeInteger(use.at) ||
    use.at < 0
  ) {
    return { ok: false, refusals: [{ code: "malformed-use", message: `the attempted use is not typed data — a principal scope, an offer id, a safe non-negative declared tick, and terms are required (got at '${String(isRecordLike(use) ? use.at : use)}')` }] };
  }

  const refusals: EntitlementRefusal[] = [];
  const label = { entitlementId: String(entitlement.entitlementId) };

  // -- the record's own identity (A9: the id is a function of the bytes) --
  const validation = validateEntitlement(entitlement);
  if (!validation.ok) {
    for (const violation of validation.errors) {
      refusals.push({
        code: "invalid-entitlement",
        message: `the entitlement record fails its own laws (${violation.code}): ${violation.message}`,
        ...label,
      });
    }
  }

  // -- 1. scope match (R056 named loudly on a cross-tenant use) -----------
  if (String(use.scope.tenantId) !== String(entitlement.scope.tenantId)) {
    refusals.push({
      code: "cross-tenant",
      message: `the use's tenant '${String(use.scope.tenantId)}' is not the entitlement's tenant '${String(entitlement.scope.tenantId)}' — entitlements are tenant isolated (${TENANT_ISOLATION_LAW}); a cross-tenant use is a loud typed violation, never a silent denial`,
      ...label,
    });
  } else if (String(use.scope.principalId) !== String(entitlement.scope.principalId)) {
    refusals.push({
      code: "principal-mismatch",
      message: `the use's principal '${String(use.scope.principalId)}' is not the grantee '${String(entitlement.scope.principalId)}' — the grant covers exactly its own principal`,
      ...label,
    });
  }

  // -- 2. capability match --------------------------------------------------
  if (String(use.offerId) !== String(entitlement.offer.offerId)) {
    refusals.push({
      code: "capability-mismatch",
      message: `the use names offer '${String(use.offerId)}' but the entitlement grants offer '${String(entitlement.offer.offerId)}' of listing '${String(entitlement.listingId)}' — the grant covers exactly the offer it cites`,
      ...label,
    });
  }

  // -- 3. period coverage (declared ticks, inclusive bounds) ---------------
  if (
    entitlement.period.kind === "fixed-window" &&
    (use.at < entitlement.period.startAt || use.at > entitlement.period.endAt)
  ) {
    refusals.push({
      code: "period-not-covered",
      message: `the use's declared tick ${String(use.at)} is outside the grant's declared window [${String(entitlement.period.startAt)}, ${String(entitlement.period.endAt)}] — the period is declared data, coverage is exact`,
      ...label,
    });
  }

  // -- 4. terms agreement (canonical deep comparison) -----------------------
  if (stableDigest(use.terms) !== stableDigest(entitlement.terms)) {
    refusals.push({
      code: "terms-mismatch",
      message: `the use's asserted terms disagree with the grant's terms — the grant runs under exactly its own declared terms (model/billing/price), never a re-interpretation`,
      ...label,
    });
  }

  if (refusals.length > 0) {
    return { ok: false, refusals };
  }
  return { ok: true, entitlement };
}
