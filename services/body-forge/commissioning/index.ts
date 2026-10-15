/**
 * The body-forge commissioning public surface (W043) — the
 * "./commissioning" entry of the body-forge package.json exports map
 * (pre-registered by the TL at 4445ed3; this file is its target). The
 * public modules are exactly: the commissioning contracts (contracts.ts —
 * the CommissionedBody record + the typed error family), the
 * commissioning gate (commission.ts — commissionBody), and the
 * whole-record re-validation (validate.ts — validateCommissionedBody).
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

export * from "./contracts.js";
export * from "./commission.js";
export * from "./validate.js";
